import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { generateEmbedding, getEmbeddingDim } from "./embeddingService.js";
import { generateExplanation } from "./llmService.js";

const TOP_K = 10;
const RRF_K = 60;
const CACHE_TTL_BUCKET = 7200;

function getTimeBucket() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
}

function cacheKey(symbol) {
  return `explain:${symbol.toUpperCase()}:${getTimeBucket()}`;
}

export async function retrieveArticles(assetType, symbol, limit = TOP_K) {
  const normalizedSymbol = symbol.toUpperCase();
  const queryText = `why is ${normalizedSymbol} stock price moving`;

  let denseResults = [];
  try {
    const embedding = await generateEmbedding(queryText);
    const dim = getEmbeddingDim();
    const vectorStr = `[${embedding.join(',')}]`;

    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, asset_symbol, source, title, content, published_at,
              1 - (embedding <=> $1::vector(${dim})) AS dense_score
       FROM news_articles
       WHERE asset_symbol = $2
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector(${dim})
       LIMIT $3`,
      vectorStr,
      normalizedSymbol,
      limit
    );
    denseResults = (rows || []).map(r => ({
      ...r,
      dense_score: Number(r.dense_score || 0),
      sparse_score: 0,
    }));
  } catch (err) {
    console.warn('[RAG] Dense retrieval unavailable, using sparse only:', err.message);
  }

  let sparseResults = [];
  try {
    const tsQuery = normalizedSymbol.replace(/[^a-zA-Z0-9]/g, '');
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, asset_symbol, source, title, content, published_at,
              ts_rank(search_vector, plainto_tsquery('english', $1)) AS sparse_score
       FROM news_articles
       WHERE asset_symbol = $2
         AND search_vector @@ plainto_tsquery('english', $1)
       ORDER BY sparse_score DESC
       LIMIT $3`,
      tsQuery,
      normalizedSymbol,
      limit
    );
    sparseResults = (rows || []).map(r => ({
      ...r,
      dense_score: 0,
      sparse_score: Number(r.sparse_score || 0),
    }));
  } catch (err) {
    console.warn('[RAG] Sparse retrieval unavailable:', err.message);
  }

  const scoreMap = new Map();

  denseResults.forEach((r, i) => {
    const rank = i + 1;
    const key = r.id;
    if (!scoreMap.has(key)) {
      scoreMap.set(key, { ...r, rrf_score: 0, source: 'dense' });
    }
    scoreMap.get(key).rrf_score += 1 / (RRF_K + rank);
  });

  sparseResults.forEach((r, i) => {
    const rank = i + 1;
    const key = r.id;
    if (!scoreMap.has(key)) {
      scoreMap.set(key, { ...r, rrf_score: 0, source: 'sparse' });
    }
    const entry = scoreMap.get(key);
    entry.rrf_score += 1 / (RRF_K + rank);
    if (!entry.source.includes('sparse')) {
      entry.source = entry.source + '+sparse';
    }
    entry.dense_score = Math.max(entry.dense_score, r.dense_score);
    entry.sparse_score = Math.max(entry.sparse_score, r.sparse_score);
  });

  const merged = [...scoreMap.values()]
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .slice(0, limit);

  return { articles: merged, denseCount: denseResults.length, sparseCount: sparseResults.length };
}

export async function explainPriceMove(assetType, symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const cKey = cacheKey(normalizedSymbol);

  const cached = await redis.get(cKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed.bucket === getTimeBucket()) {
      console.log(`[RAG] Cache hit for ${normalizedSymbol}`);
      return { ...parsed, cached: true };
    }
  }

  const { articles } = await retrieveArticles(assetType, normalizedSymbol);
  const bullets = await generateExplanation(articles, normalizedSymbol);

  const result = {
    symbol: normalizedSymbol,
    articles: articles.map(a => ({
      id: a.id, title: a.title, source: a.source,
      publishedAt: a.publishedAt,
    })),
    bullets,
    generatedAt: new Date().toISOString(),
    bucket: getTimeBucket(),
  };

  await redis.setex(cKey, CACHE_TTL_BUCKET, JSON.stringify(result));
  console.log(`[RAG] Generated explanation for ${normalizedSymbol}, cached for bucket ${result.bucket}`);

  return result;
}
