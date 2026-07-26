import { redis } from "../config/redis.js";
import { prisma } from "../config/database.js";
import { getProvider, RateLimitError } from "../config/marketDataProviders.js";
import * as yahoo from "./yahooFinanceService.js";

const USE_MOCK = process.env.REDIS_MOCK === "true" || process.env.REDIS_MOCK === "1";
const CACHE_TTL_SECONDS = 60;
const PRICE_PREFIX = "price";
const STALE_SUFFIX = "stale";

function priceKey(assetType, symbol) {
  return `${PRICE_PREFIX}:${assetType}:${symbol}`;
}

function staleKey(assetType, symbol) {
  return `${PRICE_PREFIX}:${STALE_SUFFIX}:${assetType}:${symbol}`;
}

export async function getPrice(assetType, symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = priceKey(assetType, normalizedSymbol);

  const cached = await redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    const isStale = await redis.get(staleKey(assetType, normalizedSymbol));
    return { ...parsed, stale: !!isStale, cachedAt: parsed.timestamp };
  }

  // Try provider and Yahoo in parallel — whichever responds first wins.
  // Yahoo is often rate-limited (429), so provider should respond faster.
  try {
    const provider = getProvider(assetType);
    const [providerResult, yahooResult] = await Promise.allSettled([
      provider.fetchPrice(normalizedSymbol).catch(() => null),
      yahoo.getQuote(normalizedSymbol),
    ]);

    const providerData = providerResult.status === "fulfilled" ? providerResult.value : null;
    const yahooData = yahooResult.status === "fulfilled" ? yahooResult.value : null;

    // Prefer provider data over Yahoo
    const data = (providerData && providerData.price > 0) ? providerData : yahooData;

    if (data && data.price > 0) {
      const result = {
        price: data.price, change: data.change || 0, changePercent: data.changePercent || 0,
        timestamp: data.timestamp || new Date().toISOString(), provider: data.provider || "unknown",
      };
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
      await redis.set(`${cacheKey}:fallback`, JSON.stringify(result));
      return { ...result, stale: false };
    }

    // Both failed — return fallback
    const fallback = await redis.get(`${cacheKey}:fallback`);
    if (fallback) return { ...JSON.parse(fallback), stale: true, rateLimited: true };
    return {
      price: 0, change: 0, changePercent: 0,
      timestamp: new Date().toISOString(), provider: "fallback",
      stale: true, rateLimited: true, error: "No data available",
    };
  } catch (err) {
    const fallback = await redis.get(`${cacheKey}:fallback`);
    if (fallback) return { ...JSON.parse(fallback), stale: true, rateLimited: true };
    return {
      price: 0, change: 0, changePercent: 0,
      timestamp: new Date().toISOString(), provider: "fallback",
      stale: true, rateLimited: true, error: err.message,
    };
  }
}

export async function getPricesBulk(assetType, symbols) {
  const normalized = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const results = new Map();

  const pipeline = redis.pipeline();
  for (const sym of normalized) pipeline.get(priceKey(assetType, sym));
  const cacheResponses = await pipeline.exec();

  const missSymbols = [];
  cacheResponses.forEach(([err, val], idx) => {
    const sym = normalized[idx];
    if (!err && val) {
      results.set(sym, { ...JSON.parse(val), stale: false });
    } else {
      missSymbols.push(sym);
    }
  });

  if (missSymbols.length > 0) {
    try {
      const fetched = await yahoo.getQuotes(missSymbols);
      const writePipeline = redis.pipeline();
      for (const [sym, data] of fetched) {
        const entry = {
          price: data.price, change: data.change, changePercent: data.changePercent,
          timestamp: data.timestamp, provider: data.provider || "yahoo",
        };
        writePipeline.setex(priceKey(assetType, sym), CACHE_TTL_SECONDS, JSON.stringify(entry));
        results.set(sym, { ...entry, stale: false });
      }
      await writePipeline.exec();
    } catch {
      for (const sym of missSymbols) {
        if (!results.has(sym)) {
          results.set(sym, {
            price: 0, change: 0, changePercent: 0, timestamp: new Date().toISOString(),
            provider: "fallback", stale: true, rateLimited: true,
          });
        }
      }
    }
  }
  return results;
}

export async function discoverActiveSymbols() {
  const [watchlistSymbols, positionSymbols, alertSymbols] = await Promise.all([
    prisma.watchlistItem.findMany({ select: { assetType: true, assetSymbol: true }, distinct: ["assetType", "assetSymbol"] }),
    prisma.position.findMany({ where: { quantity: { gt: 0 } }, select: { assetType: true, assetSymbol: true }, distinct: ["assetType", "assetSymbol"] }),
    prisma.priceAlert.findMany({ where: { triggered: false }, select: { assetType: true, assetSymbol: true }, distinct: ["assetType", "assetSymbol"] }),
  ]);
  const active = { stock: new Set(), crypto: new Set() };
  for (const row of [...watchlistSymbols, ...positionSymbols, ...alertSymbols]) {
    const type = row.assetType === "crypto" ? "crypto" : "stock";
    active[type].add(row.assetSymbol.toUpperCase());
  }
  return active;
}

export async function updatePriceCache(assetType, symbol, data) {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = priceKey(assetType, normalizedSymbol);
  const entry = {
    price: data.price, change: data.change, changePercent: data.changePercent,
    timestamp: data.timestamp, provider: data.provider,
  };
  await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(entry));
  await redis.set(`${cacheKey}:fallback`, JSON.stringify(entry));
  await redis.del(staleKey(assetType, normalizedSymbol));
  await redis.publish("price:updates", JSON.stringify({ assetType, symbol: normalizedSymbol, ...entry }));
}

const INTERVAL_TTL = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 21600, "1w": 86400 };
const RANGE_MAP = { "1m": "1d", "5m": "5d", "15m": "1mo", "1h": "3mo", "1d": "1y", "1w": "5y" };

export { INTERVAL_TTL };

export async function getHistory(assetType, symbol, interval = "1d") {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `history:${assetType}:${normalizedSymbol}:${interval}`;
  const ttl = INTERVAL_TTL[interval] || 300;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Try provider first (fallback generates synthetic candles), then Yahoo
  const provider = getProvider(assetType);
  try {
    if (typeof provider.fetchHistory === "function") {
      const history = await provider.fetchHistory(normalizedSymbol, interval);
      if (history && history.length > 0) {
        await redis.setex(cacheKey, ttl, JSON.stringify(history));
        return history;
      }
    }
  } catch { /* fall through */ }

  const range = RANGE_MAP[interval] || "1y";
  const history = await yahoo.getChart(normalizedSymbol, range);
  if (history.length > 0) await redis.setex(cacheKey, ttl, JSON.stringify(history));
  return history;
}

const STATS_CACHE_TTL = 3600;

export async function getStats(assetType, symbol) {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `stats:${assetType}:${normalizedSymbol}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Try provider first (works without API key), fall back to Yahoo
  const provider = getProvider(assetType);
  try {
    const stats = await provider.fetchStats(normalizedSymbol);
    if (stats && stats.marketCap) {
      await redis.setex(cacheKey, STATS_CACHE_TTL, JSON.stringify(stats));
      return stats;
    }
  } catch { /* fall through to Yahoo */ }

  const info = await yahoo.getInfo(normalizedSymbol);
  if (info) {
    await redis.setex(cacheKey, STATS_CACHE_TTL, JSON.stringify(info));
    return info;
  }
  return null;
}

export async function searchSymbols(query) {
  const yahooResults = await yahoo.searchSymbols(query);
  if (yahooResults.length > 0) {
    const enriched = await Promise.all(
      yahooResults.map(async (item) => {
        let currentPrice = item.currentPrice;
        if (currentPrice == null) {
          const cacheKey = priceKey(item.assetType, item.symbol);
          const cached = await redis.get(cacheKey);
          if (cached) currentPrice = JSON.parse(cached).price;
        }
        return { ...item, currentPrice };
      })
    );
    enriched.sort((a, b) => {
      const q = query.toUpperCase();
      const aExact = a.symbol === q ? 0 : a.symbol.startsWith(q) ? 1 : 2;
      const bExact = b.symbol === q ? 0 : b.symbol.startsWith(q) ? 1 : 2;
      return aExact - bExact;
    });
    return enriched;
  }

  const SYMBOL_DATABASE = [
    { symbol: "RELIANCE", name: "Reliance Industries Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "TCS", name: "Tata Consultancy Services Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "INFY", name: "Infosys Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "HDFCBANK", name: "HDFC Bank Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "ICICIBANK", name: "ICICI Bank Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "SBIN", name: "State Bank of India", exchange: "NSE", assetType: "stock" },
    { symbol: "BHARTIARTL", name: "Bharti Airtel Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "ITC", name: "ITC Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "WIPRO", name: "Wipro Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "TATAMOTORS", name: "Tata Motors Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "BAJFINANCE", name: "Bajaj Finance Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "MARUTI", name: "Maruti Suzuki India Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "LT", name: "Larsen & Toubro Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "HCLTECH", name: "HCL Technologies Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "ZOMATO", name: "Zomato Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "PAYTM", name: "One 97 Communications Ltd", exchange: "NSE", assetType: "stock" },
    { symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "MSFT", name: "Microsoft Corp", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "GOOGL", name: "Alphabet Inc", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "AMZN", name: "Amazon.com Inc", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "TSLA", name: "Tesla Inc", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "NVDA", name: "NVIDIA Corp", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "META", name: "Meta Platforms Inc", exchange: "NASDAQ", assetType: "stock" },
    { symbol: "BTCUSD", name: "Bitcoin", exchange: "CRYPTO", assetType: "crypto" },
    { symbol: "ETHUSD", name: "Ethereum", exchange: "CRYPTO", assetType: "crypto" },
    { symbol: "SOLUSD", name: "Solana", exchange: "CRYPTO", assetType: "crypto" },
    { symbol: "XRPUSD", name: "Ripple", exchange: "CRYPTO", assetType: "crypto" },
    { symbol: "ADAUSD", name: "Cardano", exchange: "CRYPTO", assetType: "crypto" },
    { symbol: "DOGEUSD", name: "Dogecoin", exchange: "CRYPTO", assetType: "crypto" },
  ];

  const q = query.toUpperCase().trim();
  if (!q || q.length < 1) return [];
  let results = SYMBOL_DATABASE.filter((s) => s.symbol.includes(q) || s.name.toUpperCase().includes(q));
  results = results.slice(0, 10);

  const enriched = await Promise.all(
    results.map(async (item) => {
      let currentPrice = null;
      const ck = priceKey(item.assetType, item.symbol);
      const cached = await redis.get(ck);
      if (cached) currentPrice = JSON.parse(cached).price;
      return { symbol: item.symbol, name: item.name, exchange: item.exchange, assetType: item.assetType, currentPrice };
    })
  );

  enriched.sort((a, b) => {
    const aExact = a.symbol === q ? 0 : a.symbol.startsWith(q) ? 1 : 2;
    const bExact = b.symbol === q ? 0 : b.symbol.startsWith(q) ? 1 : 2;
    return aExact - bExact;
  });
  return enriched;
}
