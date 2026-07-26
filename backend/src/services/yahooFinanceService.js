import YahooFinance from "yahoo-finance2";
import { redis } from "../config/redis.js";
import { prisma } from "../config/database.js";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const QUOTE_CACHE_TTL = 60;
const CHART_CACHE_TTL = 300;
const INFO_CACHE_TTL = 86400;

const RANGE_CONFIG = {
  "1d":  { interval: "5m",  seconds: 24 * 60 * 60, ttl: 300 },
  "5d":  { interval: "15m", seconds: 5 * 24 * 60 * 60, ttl: 600 },
  "1mo": { interval: "1h",  seconds: 30 * 24 * 60 * 60, ttl: 3600 },
  "3mo": { interval: "1d",  seconds: 90 * 24 * 60 * 60, ttl: 7200 },
  "6mo": { interval: "1d",  seconds: 180 * 24 * 60 * 60, ttl: 14400 },
  "1y":  { interval: "1d",  seconds: 365 * 24 * 60 * 60, ttl: 21600 },
  "5y":  { interval: "1wk", seconds: 5 * 365 * 24 * 60 * 60, ttl: 86400 },
};

// Comprehensive NSE symbols list - extend as needed
const NSE_SYMBOLS = new Set([
  "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","HINDUNILVR","SBIN",
  "BHARTIARTL","ITC","WIPRO","BAJFINANCE","KOTAKBANK","MARUTI",
  "TATAMOTORS","TATASTEEL","AXISBANK","LT","SUNPHARMA","ASIANPAINT",
  "NTPC","POWERGRID","M&M","TITAN","ULTRACEMCO","HCLTECH","ADANIENT",
  "ADANIPORTS","DMART","BAJAJFINSV","NESTLEIND","HAL","BEL","IRCTC",
  "ZOMATO","PAYTM","NYKAA","IRFC","SBICARD","CAMS","CDSL","ROUTE",
  "IDEA","YESBANK","PNB","BANKBARODA","CANBK","UNIONBANK","INDIANB",
  "FEDERALBNK","INDUSINDBK","RBLBANK","IDFCFIRSTB","BANDHANBNK",
  "JIOFIN","TATACONSUM","TATAPOWER","ONGC","COALINDIA","GAIL","OIL",
  "HINDPETRO","BPCL","IOC","GAIL","PETRONET","IGL","MGL","GUJGASLTD",
  "ADANIGREEN","ADANITRANS","ADANIPORTS","ADANIENT","ADANIPOWER",
  "TATAMOTORS","TATAMTRDVR","MARUTI","M&M","BAJAJ-AUTO","EICHERMOT",
  "HEROMOTOCO","TVSMOTOR","ASHOKLEY","MOTHERSON","BHARATFORG",
  "SUNPHARMA","CIPLA","DRREDDY","LUPIN","TORNTPHARM","ALKEM","ZYDUSLIFE",
  "TECHM","LTIM","MPHASIS","PERSISTENT","COFORGE","KPITTECH",
  "SBILIFE","HDFCLIFE","ICICIPRULI","MAXLIFE","BAJAJFINSV",
  "TRENT","TRENTLTD","DMART","AVENUE","ZOMATO","POLICYBZR","NYKAA",
  "IRFC","RVNL","IRCON","RAILTEL","CONCOR","DFCCIL",
  "BHEL","BEL","HAL","MAZAGON","COCHINSHIP","GRSE","HSL",
  "NHPC","SJVN","NLCINDIA","NTPC","POWERGRID","RECLTD","PFC",
]);

function toYahooSymbol(symbol) {
  const s = symbol.toUpperCase();
  // Crypto: BTC -> BTC-USD, ETH -> ETH-USD
  if (s.endsWith("USD") && s.length > 3) {
    const base = s.slice(0, -3);
    return `${base}-USD`;
  }
  // NSE stocks: add .NS suffix
  if (NSE_SYMBOLS.has(s)) return `${s}.NS`;
  // If symbol contains only letters and looks like Indian stock, try .NS
  // This is a fallback - in production you'd want a complete symbol database
  if (/^[A-Z]+$/.test(s) && s.length >= 3 && s.length <= 12) {
    console.log(`[yahooFinance] Symbol ${s} not in NSE list, trying .NS suffix`);
    return `${s}.NS`;
  }
  return s;
}

function cacheKey(...parts) {
  return `yf:${parts.join(":")}`;
}

async function getCached(key) {
  const raw = await redis.get(key);
  if (raw) return JSON.parse(raw);
  return null;
}

async function setCache(key, value, ttl) {
  await redis.setex(key, ttl, JSON.stringify(value));
}

async function dedupFetch(key, fetcher, ttl) {
  const cached = await getCached(key);
  if (cached) return cached;
  const result = await fetcher();
  if (result) await setCache(key, result, ttl);
  return result;
}

async function safeYahooFetch(fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[safeYahooFetch] ${err.message}`);
    return null;
  }
}

export async function searchSymbols(query) {
  const q = query.trim();
  if (!q || q.length < 1) return [];

  const cacheK = cacheKey("search", q.toUpperCase());
  const cached = await getCached(cacheK);
  if (cached) return cached;

  const results = await safeYahooFetch(() => yahooFinance.search(q, {
    quotesCount: 10, newsCount: 0, enableEnhancedTrivialQuery: false,
  }));

  if (!results?.quotes?.length) return [];

  const mapped = [];
  for (const q of results.quotes) {
    if (!q.symbol) continue;
    if (q.quoteType === "CRYPTOCURRENCY" || q.quoteType === "EQUITY" || q.quoteType === "ETF") {
      const symbol = q.symbol.replace(".NS", "").replace("-USD", "USD");
      const assetType = q.quoteType === "CRYPTOCURRENCY" ? "crypto" : "stock";
      mapped.push({
        symbol: symbol.toUpperCase(),
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange || q.market || "-",
        assetType,
        currentPrice: q.regularMarketPrice ?? null,
      });
    }
  }

  if (mapped.length > 0) await setCache(cacheK, mapped, 3600);
  return mapped;
}

export async function getQuote(symbol) {
  const yahooSym = toYahooSymbol(symbol);
  console.log(`[yahooFinance] getQuote: original=${symbol}, mapped=${yahooSym}`);
  const cacheK = cacheKey("quote", yahooSym);

  return dedupFetch(cacheK, async () => {
    const data = await safeYahooFetch(() => yahooFinance.quote(yahooSym));
    if (!data) {
      console.log(`[yahooFinance] getQuote: No data for ${yahooSym}`);
      return null;
    }
    console.log(`[yahooFinance] getQuote: Got data for ${yahooSym}, price=${data.regularMarketPrice}`);
    return {
      price: data.regularMarketPrice ?? 0,
      change: data.regularMarketChange ?? 0,
      changePercent: data.regularMarketChangePercent ?? 0,
      timestamp: new Date().toISOString(),
      provider: "yahoo",
    };
  }, QUOTE_CACHE_TTL);
}

export async function getQuotes(symbols) {
  if (!symbols.length) return new Map();
  const results = new Map();
  const missSymbols = [];

  for (const sym of symbols) {
    const yahooSym = toYahooSymbol(sym);
    const cached = await getCached(cacheKey("quote", yahooSym));
    if (cached) {
      results.set(sym.toUpperCase(), cached);
    } else {
      missSymbols.push(sym);
    }
  }

  if (missSymbols.length > 0) {
    const yahooSymbols = missSymbols.map((s) => toYahooSymbol(s));
    console.log(`[yahooFinance] getQuotes: Fetching batch for ${yahooSymbols.join(", ")}`);
    const batchResult = await safeYahooFetch(() => yahooFinance.quote(yahooSymbols));

    if (batchResult) {
      const arr = Array.isArray(batchResult) ? batchResult : [batchResult];
      for (const data of arr) {
        if (!data?.symbol) continue;
        let originalSym = missSymbols.find(
          (s) => toYahooSymbol(s).toUpperCase() === data.symbol.toUpperCase()
        );
        if (!originalSym) originalSym = data.symbol;
        const entry = {
          price: data.regularMarketPrice ?? 0,
          change: data.regularMarketChange ?? 0,
          changePercent: data.regularMarketChangePercent ?? 0,
          timestamp: new Date().toISOString(),
          provider: "yahoo",
        };
        const key = originalSym.toUpperCase();
        results.set(key, entry);
        await setCache(cacheKey("quote", data.symbol), entry, QUOTE_CACHE_TTL);
      }
    }
  }

  return results;
}

export async function getChart(symbol, range = "1mo") {
  const yahooSym = toYahooSymbol(symbol);
  console.log(`[yahooFinance] getChart: original=${symbol}, mapped=${yahooSym}, range=${range}`);
  const config = RANGE_CONFIG[range] || RANGE_CONFIG["1mo"];
  const cacheK = cacheKey("chart", yahooSym, range);

  const cached = await getCached(cacheK);
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const period1 = now - config.seconds;

  const data = await safeYahooFetch(() =>
    yahooFinance.chart(yahooSym, {
      interval: config.interval,
      period1,
      period2: now,
    })
  );

  if (!data?.quotes?.length) {
    console.log(`[yahooFinance] getChart: No quotes for ${yahooSym}`);
    return [];
  }

  const history = data.quotes
    .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null)
    .map((q) => ({
      time: Math.floor(q.date.getTime() / 1000),
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume || 0,
    }));

  if (history.length > 0) await setCache(cacheK, history, config.ttl);
  console.log(`[yahooFinance] getChart: Returning ${history.length} candles for ${yahooSym}`);
  return history;
}

export async function getInfo(symbol) {
  const yahooSym = toYahooSymbol(symbol);
  console.log(`[yahooFinance] getInfo: original=${symbol}, mapped=${yahooSym}`);
  const cacheK = cacheKey("info", yahooSym);

  const cached = await getCached(cacheK);
  if (cached) return cached;

  const data = await safeYahooFetch(() =>
    yahooFinance.quoteSummary(yahooSym, {
      modules: ["price", "summaryProfile", "financialData", "defaultKeyStatistics", "summaryDetail"],
    })
  );

  if (!data) {
    console.log(`[yahooFinance] getInfo: No data for ${yahooSym}`);
    return null;
  }

  const price = data.price || {};
  const profile = data.summaryProfile || {};
  const finData = data.financialData || {};
  const stats = data.defaultKeyStatistics || {};
  const summaryDetail = data.summaryDetail || {};

  const getRaw = (obj, key) => obj?.[key]?.raw ?? obj?.[key] ?? null;

  const info = {
    name: price.longName || price.shortName || price.symbol || symbol,
    exchange: price.exchangeName || profile.exchange || "-",
    marketCap: getRaw(price, "marketCap") ?? getRaw(finData, "marketCap") ?? getRaw(stats, "marketCap") ?? getRaw(summaryDetail, "marketCap") ?? null,
    volume: getRaw(price, "regularMarketVolume") ?? getRaw(summaryDetail, "volume") ?? null,
    avgVolume: getRaw(summaryDetail, "averageDailyVolume10Day") ?? getRaw(finData, "averageVolume") ?? null,
    peRatio: getRaw(stats, "peRatio") ?? getRaw(finData, "peRatio") ?? getRaw(summaryDetail, "peRatio") ?? null,
    eps: getRaw(stats, "earningsPerShare") ?? getRaw(finData, "earningsPerShare") ?? getRaw(summaryDetail, "epsTrailingTwelveMonths") ?? null,
    high52w: getRaw(summaryDetail, "fiftyTwoWeekHigh") ?? getRaw(stats, "fiftyTwoWeekHigh") ?? getRaw(price, "fiftyTwoWeekHigh") ?? null,
    low52w: getRaw(summaryDetail, "fiftyTwoWeekLow") ?? getRaw(stats, "fiftyTwoWeekLow") ?? getRaw(price, "fiftyTwoWeekLow") ?? null,
    high: getRaw(price, "regularMarketDayHigh") ?? null,
    low: getRaw(price, "regularMarketDayLow") ?? null,
    open: getRaw(price, "regularMarketOpen") ?? null,
    previousClose: getRaw(price, "regularMarketPreviousClose") ?? null,
    dividendYield: getRaw(stats, "dividendYield") ?? getRaw(summaryDetail, "dividendYield") ?? null,
    beta: getRaw(stats, "beta") ?? getRaw(summaryDetail, "beta") ?? null,
    currency: price.currency || "USD",
    sector: profile.sector || null,
    industry: profile.industry || null,
    website: profile.website || null,
    description: profile.longBusinessSummary || null,
    fullTimeEmployees: profile.fullTimeEmployees || null,
  };

  await setCache(cacheK, info, INFO_CACHE_TTL);
  console.log(`[yahooFinance] getInfo: Returning info for ${yahooSym}`);
  return info;
}

export async function getPortfolioPrices(userId) {
  const positions = await prisma.position.findMany({
    where: { userId, quantity: { gt: 0 } },
    select: { assetType: true, assetSymbol: true, quantity: true, avgBuyPrice: true },
  });

  const watchlistItems = await prisma.watchlistItem.findMany({
    where: { watchlist: { userId } },
    select: { assetType: true, assetSymbol: true },
  });

  const symbolSet = new Map();
  for (const p of positions) symbolSet.set(p.assetSymbol.toUpperCase(), p.assetType);
  for (const w of watchlistItems) symbolSet.set(w.assetSymbol.toUpperCase(), w.assetType);

  const { getPrice } = await import("./marketDataService.js");
  const prices = {};
  for (const [sym, type] of symbolSet) {
    try {
      const quote = await getPrice(type, sym);
      prices[sym] = { ...quote, assetType: type };
    } catch {
      prices[sym] = { price: 0, change: 0, changePercent: 0, timestamp: new Date().toISOString(), provider: "error", assetType: type };
    }
  }

  return prices;
}
