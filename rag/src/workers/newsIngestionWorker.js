import Bull from "bull";
import { prisma } from "../config/database.js";
import { redis, USE_MOCK_REDIS, createBullRedis } from "../config/redis.js";
import { generateEmbedding } from "../services/embeddingService.js";

const INGEST_INTERVAL_MS = 1800000;

let newsIngestionQueue = null;
let mockIngestionInterval = null;

async function discoverActiveSymbols() {
  const [watchlistSymbols, positionSymbols, alertSymbols] = await Promise.all([
    prisma.watchlistItem.findMany({
      select: { assetType: true, assetSymbol: true },
      distinct: ["assetType", "assetSymbol"],
    }),
    prisma.position.findMany({
      where: { quantity: { gt: 0 } },
      select: { assetType: true, assetSymbol: true },
      distinct: ["assetType", "assetSymbol"],
    }),
    prisma.priceAlert.findMany({
      where: { triggered: false },
      select: { assetType: true, assetSymbol: true },
      distinct: ["assetType", "assetSymbol"],
    }),
  ]);

  const active = { stock: new Set(), crypto: new Set() };
  for (const row of [...watchlistSymbols, ...positionSymbols, ...alertSymbols]) {
    const type = row.assetType === "crypto" ? "crypto" : "stock";
    active[type].add(row.assetSymbol.toUpperCase());
  }
  return active;
}

async function fetchNewsForSymbol(assetType, symbol) {
  const apiKey = process.env.NEWSAPI_API_KEY;
  if (!apiKey || apiKey.trim() === "") return [];

  const query = assetType === "crypto"
    ? `cryptocurrency ${symbol.replace("USD", "")}`
    : `${symbol} stock OR ${symbol} earnings OR ${symbol} market`;

  try {
    const params = new URLSearchParams({
      q: query, language: "en", sortBy: "publishedAt", pageSize: "15", apiKey,
    });
    const res = await fetch(`https://newsapi.org/v2/everything?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 429) return [];
      console.error(`[RAG:Ingestion] HTTP ${res.status} for ${symbol}`);
      return [];
    }
    const data = await res.json();
    return (data.articles || []).map(a => ({
      source: a.source?.name || "NewsAPI",
      title: a.title || "",
      content: (a.description || "") + "\n" + (a.content || ""),
      publishedAt: a.publishedAt || new Date().toISOString(),
    }));
  } catch (err) {
    if (err.name === "TimeoutError") return [];
    console.error(`[RAG:Ingestion] Fetch error for ${symbol}:`, err.message);
    return [];
  }
}

async function fetchAlphaVantageNews(symbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey || apiKey.trim() === "") return [];

  try {
    const params = new URLSearchParams({
      function: "NEWS_SENTIMENT", tickers: symbol, apikey: apiKey, limit: "10",
    });
    const res = await fetch(`https://www.alphavantage.co/query?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.feed || []).map(a => ({
      source: a.source || "AlphaVantage",
      title: a.title || "",
      content: (a.summary || "") + "\n" + (a.overall_sentiment_label || ""),
      publishedAt: a.time_published || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function chunkArticle(article, maxChars = 2000) {
  if (article.content.length <= maxChars) return [article];
  const chunks = [];
  let start = 0;
  let chunkIdx = 0;
  while (start < article.content.length) {
    const end = Math.min(start + maxChars, article.content.length);
    chunks.push({
      source: article.source,
      title: `${article.title} (part ${chunkIdx + 1})`,
      content: article.content.slice(start, end),
      publishedAt: article.publishedAt,
    });
    start = end;
    chunkIdx++;
  }
  return chunks;
}

async function runIngestion() {
  try {
    if (!(await ensureTable())) return;

    const active = await discoverActiveSymbols();
    const allSymbols = [
      ...[...active.stock].map(s => ({ type: "stock", symbol: s })),
      ...[...active.crypto].map(s => ({ type: "crypto", symbol: s })),
    ];

    if (allSymbols.length === 0) {
      console.log("[RAG:Ingestion] No active symbols to ingest news for");
      return;
    }

    console.log(`[RAG:Ingestion] Fetching news for ${allSymbols.length} active symbols`);

    for (const { type, symbol } of allSymbols) {
      try {
        const recentCount = await checkRecentArticles(symbol);
        if (recentCount >= 3) continue;

        let articles = await fetchNewsForSymbol(type, symbol);
        if (articles.length === 0) articles = await fetchAlphaVantageNews(symbol);
        if (articles.length === 0) continue;

        const existingTitles = await getExistingTitles(symbol);
        for (const article of articles) {
          const normalizedTitle = article.title.trim().toLowerCase().slice(0, 100);
          if (existingTitles.has(normalizedTitle)) continue;
          const chunks = chunkArticle(article);
          for (const chunk of chunks) {
            await storeArticle(symbol, chunk);
          }
        }
      } catch (err) {
        console.warn(`[RAG:Ingestion] Failed for ${symbol}:`, err.message);
      }
    }

    console.log("[RAG:Ingestion] Cycle complete");
  } catch (err) {
    console.error("[RAG:Ingestion] Error:", err.message);
  }
}

let tableExists = false;
let migrationWarned = false;

async function ensureTable() {
  if (tableExists) return true;
  if (migrationWarned) return false;
  try {
    const result = await prisma.$queryRawUnsafe(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'news_articles') AS exists`
    );
    tableExists = result[0]?.exists === true;
  } catch {
    tableExists = false;
  }
  if (!tableExists && !migrationWarned) {
    console.warn('[RAG:Ingestion] news_articles table missing — apply the RAG migration:');
    console.warn('  cd rag && npx prisma migrate dev --name rag_layer');
    migrationWarned = true;
  }
  return tableExists;
}

async function checkRecentArticles(symbol) {
  if (!tableExists) return 3;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM news_articles
       WHERE asset_symbol = $1 AND published_at > NOW() - INTERVAL '1 hour'`,
      symbol.toUpperCase()
    );
    return rows?.[0]?.cnt || 0;
  } catch { return 0; }
}

async function getExistingTitles(symbol) {
  if (!tableExists) return new Set();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT LOWER(LEFT(title, 100)) AS key FROM news_articles WHERE asset_symbol = $1`,
      symbol.toUpperCase()
    );
    return new Set((rows || []).map(r => r.key));
  } catch { return new Set(); }
}

async function storeArticle(symbol, article) {
  if (!tableExists) return;
  try {
    const textToEmbed = `${article.title}\n${article.content}`.slice(0, 8000);
    let embedding = null;
    try { embedding = await generateEmbedding(textToEmbed); } catch {}

    const dim = embedding ? embedding.length : 1536;
    const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;

    if (embeddingStr) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO news_articles (asset_symbol, source, title, content, published_at, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector(${dim})) ON CONFLICT DO NOTHING`,
        symbol.toUpperCase(), article.source, article.title, article.content,
        new Date(article.publishedAt), embeddingStr
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO news_articles (asset_symbol, source, title, content, published_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        symbol.toUpperCase(), article.source, article.title, article.content,
        new Date(article.publishedAt)
      );
    }
  } catch (err) {
    if (err.code === '42P01') tableExists = false;
    else console.warn(`[RAG:Ingestion] Store failed for ${symbol}:`, err.message);
  }
}

function generateMockArticles(symbol) {
  const sources = ["Financial Times", "Bloomberg", "Reuters", "CNBC", "MarketWatch"];
  const mockArticles = [];

  const templates = [
    { title: `${symbol} Reports Strong Quarterly Earnings`, content: `${symbol} announced quarterly earnings that surpassed analyst expectations, with revenue growing 18% year-over-year. The company cited strong demand across all segments and raised its full-year guidance.` },
    { title: `Analyst Upgrades ${symbol} Citing Growth Potential`, content: `A leading investment bank upgraded ${symbol} from "neutral" to "buy," setting a new price target 25% above current levels. The analyst highlighted the company's expanding market share and innovative product pipeline.` },
    { title: `${symbol} Announces Strategic Partnership`, content: `${symbol} entered into a strategic partnership with a major technology firm to develop next-generation AI solutions. The collaboration is expected to generate significant revenue starting next quarter.` },
    { title: `Market Rally Boosts ${symbol} Along with Tech Sector`, content: `${symbol} shares rose along with the broader tech sector as positive macroeconomic data eased recession fears. The Nasdaq composite gained 2.3% in today's trading session.` },
    { title: `Regulatory Approval Expected for ${symbol}'s New Product`, content: `${symbol} is expected to receive regulatory approval for its upcoming product launch, which analysts believe could open a new multi-billion dollar market opportunity for the company.` },
  ];

  for (let i = 0; i < templates.length; i++) {
    const daysAgo = i * 2;
    const date = new Date(Date.now() - daysAgo * 86400000);
    mockArticles.push({
      source: sources[i % sources.length],
      title: templates[i].title,
      content: templates[i].content,
      publishedAt: date.toISOString(),
    });
  }

  return mockArticles;
}

export async function startNewsIngestion() {
  if (USE_MOCK_REDIS) {
    console.log("[RAG:Ingestion] Starting mock mode (setInterval every 30min)");
    runIngestion().catch(() => {});
    mockIngestionInterval = setInterval(() => {
      runIngestion().catch(err => console.error("[RAG:Ingestion] Cycle error:", err.message));
    }, INGEST_INTERVAL_MS);
    console.log("[RAG:Ingestion] Started (mock).");
    return;
  }

  newsIngestionQueue = new Bull("news-ingestion", {
    createClient: () => createBullRedis(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
  });

  newsIngestionQueue.process(async () => { await runIngestion(); });

  const repeatJobs = await newsIngestionQueue.getRepeatableJobs();
  for (const job of repeatJobs) {
    await newsIngestionQueue.removeRepeatableByKey(job.key);
  }

  await newsIngestionQueue.add(
    {},
    { repeat: { every: INGEST_INTERVAL_MS }, jobId: "news-ingestion-repeat" }
  );

  console.log("[RAG:Ingestion] Started: every 30 minutes");
}

export async function stopNewsIngestion() {
  if (mockIngestionInterval) {
    clearInterval(mockIngestionInterval);
    mockIngestionInterval = null;
  }
  if (newsIngestionQueue) await newsIngestionQueue.close();
}

export async function triggerImmediateIngestion() {
  if (USE_MOCK_REDIS) { await runIngestion(); return; }
  if (newsIngestionQueue) {
    await newsIngestionQueue.add({}, { jobId: `manual-ingestion-${Date.now()}` });
  }
}

export { generateMockArticles };
