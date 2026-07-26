import { redis } from "../config/redis.js";

const NEWSAPI_BASE = "https://newsapi.org/v2";
const CACHE_TTL = 1800;

export async function getNews(assetType, symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `news:${assetType}:${normalizedSymbol}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const apiKey = process.env.NEWSAPI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    console.log("[NewsService] No API key configured, skipping news fetch");
    return [];
  }

  const query = assetType === "crypto"
    ? `cryptocurrency ${normalizedSymbol.replace("USD", "")}`
    : `${normalizedSymbol} stock`;

  try {
    const params = new URLSearchParams({
      q: query,
      language: "en",
      sortBy: "publishedAt",
      pageSize: "10",
      apiKey,
    });

    const res = await fetch(`${NEWSAPI_BASE}/everything?${params}`, {
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      if (res.status === 429) return [];
      console.error(`[NewsService] HTTP ${res.status} for ${query}`);
      return [];
    }

    const data = await res.json();
    const articles = (data.articles || []).map((a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      source: a.source?.name || "News",
      publishedAt: a.publishedAt,
      imageUrl: a.urlToImage,
    }));

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(articles));
    return articles;
  } catch (err) {
    if (err.name === "TimeoutError") return [];
    console.error("[NewsService]", err.message);
    return [];
  }
}
