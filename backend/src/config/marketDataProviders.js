import { redis } from "./redis.js";

// ── Interval Mapper ─────────────────────────────────────────────────────────
const INTERVAL_MAP = {
  "1m": "1min", "5m": "5min", "15m": "15min",
  "1h": "1h", "1d": "1day", "1w": "1week",
};

const INTERVAL_TTL = {
  "1m": 60, "5m": 300, "15m": 900,
  "1h": 3600, "1d": 21600, "1w": 86400,
};

const INTERVAL_OUTPUTSIZE = {
  "1m": 120, "5m": 72, "15m": 96,
  "1h": 120, "1d": 60, "1w": 52,
};

function toTwelveDataInterval(interval) {
  return INTERVAL_MAP[interval] || "1day";
}

// ── Rate Limit Tracking ─────────────────────────────────────────────────────
// Each provider class tracks its API usage via a Redis counter with a 60-second
// TTL. The pattern is:
//   INCR ratelimit:{providerName}:{currentMinuteEpoch}
//   EXPIRE ratelimit:{providerName}:{currentMinuteEpoch} 60
// If the counter exceeds the provider's limit, we stop calling the API and
// return fallback data until the counter resets.
//
// Why Redis for rate limit tracking (not in-memory)?
// - If we scale to multiple Node processes, the counter must be shared.
// - In-memory counters would let each process exhaust the API quota independently.
// - Redis INCR is atomic — no race conditions between concurrent requests.

function getMinuteEpoch() {
  return Math.floor(Date.now() / 60000);
}

async function incrementRateLimitCounter(providerName) {
  const key = `ratelimit:${providerName}:${getMinuteEpoch()}`;
  const count = await redis.incr(key);
  if (count === 1) {
    // First request in this minute window — set TTL so the key auto-clears
    await redis.expire(key, 60);
  }
  return count;
}

export class RateLimitError extends Error {
  constructor(providerName, retryAfterSeconds) {
    super(`${providerName} rate limit exceeded`);
    this.name = "RateLimitError";
    this.providerName = providerName;
    this.retryAfterSeconds = retryAfterSeconds;
    this.statusCode = 429;
  }
}

// ── Abstract Base ───────────────────────────────────────────────────────────
// All providers follow the same interface:
//   fetchPrice(symbol)    -> { price, change, changePercent, timestamp }
//   fetchPrices(symbols)  -> Map<symbol, { price, ... }>

class MarketDataProvider {
  constructor(config) {
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.maxPerMinute = config.maxPerMinute || 30;
    this.timeoutMs = config.timeoutMs || 5000;
  }

  buildSingleUrl(symbol) { throw new Error("subclass must implement"); }
  buildBatchUrl(symbols) { throw new Error("subclass must implement"); }
  parseSingleResponse(data) { throw new Error("subclass must implement"); }
  parseBatchResponse(data, symbols) { throw new Error("subclass must implement"); }
  buildHistoryUrl(symbol, interval) { throw new Error("subclass must implement"); }
  parseHistoryResponse(data) { throw new Error("subclass must implement"); }
  buildStatsUrl(symbol) { throw new Error("subclass must implement"); }
  parseStatsResponse(data) { throw new Error("subclass must implement"); }

  async fetchPrice(symbol) {
    await this._checkRateLimit();
    const url = this.buildSingleUrl(symbol);
    const data = await this._fetch(url);
    return this.parseSingleResponse(data);
  }

  async fetchPrices(symbols) {
    if (symbols.length === 0) return new Map();
    await this._checkRateLimit();
    const url = this.buildBatchUrl(symbols);
    const data = await this._fetch(url);
    return this.parseBatchResponse(data, symbols);
  }

  async fetchHistory(symbol, interval = "1day") {
    await this._checkRateLimit();
    const url = this.buildHistoryUrl(symbol, interval);
    const data = await this._fetch(url);
    return this.parseHistoryResponse(data);
  }

  async fetchStats(symbol) {
    await this._checkRateLimit();
    const url = this.buildStatsUrl(symbol);
    const data = await this._fetch(url);
    return this.parseStatsResponse(data);
  }

  async _checkRateLimit() {
    const count = await incrementRateLimitCounter(this.name);
    if (count > this.maxPerMinute) {
      // When we hit the limit, compute seconds until the minute window resets
      const now = Date.now();
      const nextMinute = (Math.floor(now / 60000) + 1) * 60000;
      const retryAfter = Math.ceil((nextMinute - now) / 1000);
      throw new RateLimitError(this.name, retryAfter);
    }
  }

  async _fetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        // 429 Too Many Requests — provider's own rate limiter kicked in
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("retry-after") || "60", 10);
          throw new RateLimitError(this.name, retryAfter);
        }
        throw new Error(`${this.name} HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Yahoo Finance Provider (Stocks - Free, No API Key) ──────────────────────
// Uses yahoo-finance2 library via the existing yahooFinanceService
import * as yahoo from "../services/yahooFinanceService.js";

export class YahooFinanceProvider extends MarketDataProvider {
  constructor() {
    super({
      name: "yahoo",
      baseUrl: "",
      apiKey: "",
      maxPerMinute: 60,
    });
  }

  buildSingleUrl(symbol) {
    return `yahoo://${symbol}`;
  }

  buildBatchUrl(symbols) {
    return `yahoo://${symbols.join(",")}`;
  }

  async fetchPrices(symbols) {
    const results = new Map();
    try {
      const quotes = await yahoo.getQuotes(symbols);
      for (const [symbol, data] of quotes) {
        results.set(symbol, {
          price: data.price,
          change: data.change,
          changePercent: data.changePercent,
          timestamp: data.timestamp,
          provider: "yahoo",
        });
      }
    } catch (err) {
      console.error("[YahooFinanceProvider] fetchPrices failed:", err.message);
    }
    return results;
  }

  parseSingleResponse(data) { throw new Error("not used"); }
  parseBatchResponse(data, symbols) { throw new Error("not used"); }
  buildHistoryUrl(symbol, interval) { throw new Error("not used"); }
  parseHistoryResponse(data) { throw new Error("not used"); }
  buildStatsUrl(symbol) { throw new Error("not used"); }
  parseStatsResponse(data) { throw new Error("not used"); }
}

// ── Twelve Data (Stocks) ───────────────────────────────────────────────────
// Free tier: 800 requests/day, ~8 per minute sustained.
// Endpoint: GET /price?symbol=RELIANCE&apikey=KEY
// Batch:    GET /price?symbol=RELIANCE,TCS,INFY&apikey=KEY
// Response: { price: "2500.00", change: "12.50", percent_change: "0.50", ... }

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

export class TwelveDataProvider extends MarketDataProvider {
  constructor(apiKey) {
    super({
      name: "twelvedata",
      baseUrl: TWELVE_DATA_BASE,
      apiKey: apiKey || process.env.TWELVEDATA_API_KEY || "",
      maxPerMinute: 8,
    });
  }

  buildSingleUrl(symbol) {
    const params = new URLSearchParams({ symbol, apikey: this.apiKey });
    return `${this.baseUrl}/price?${params}`;
  }

  buildBatchUrl(symbols) {
    const params = new URLSearchParams({
      symbol: symbols.join(","),
      apikey: this.apiKey,
    });
    return `${this.baseUrl}/price?${params}`;
  }

  parseSingleResponse(data) {
    if (data.status === "error") {
      throw new Error(`Twelve Data: ${data.message}`);
    }
    return {
      price: parseFloat(data.price),
      change: data.change ? parseFloat(data.change) : 0,
      changePercent: data.percent_change ? parseFloat(data.percent_change) : 0,
      timestamp: new Date().toISOString(),
      provider: "twelvedata",
    };
  }

  parseBatchResponse(data, symbols) {
    const results = new Map();
    for (const symbol of symbols) {
      const entry = data[symbol];
      if (entry && entry.price) {
        results.set(symbol, {
          price: parseFloat(entry.price),
          change: entry.change ? parseFloat(entry.change) : 0,
          changePercent: entry.percent_change ? parseFloat(entry.percent_change) : 0,
          timestamp: new Date().toISOString(),
          provider: "twelvedata",
        });
      }
    }
    return results;
  }

  buildHistoryUrl(symbol, interval = "1d") {
    const tdInterval = toTwelveDataInterval(interval);
    const outputsize = INTERVAL_OUTPUTSIZE[interval] || 60;
    const params = new URLSearchParams({
      symbol,
      interval: tdInterval,
      outputsize: String(outputsize),
      apikey: this.apiKey,
    });
    return `${this.baseUrl}/time_series?${params}`;
  }

  parseHistoryResponse(data) {
    if (data.status === "error") throw new Error(`Twelve Data history: ${data.message}`);
    if (!data.values) return [];
    return data.values.reverse().map((v) => ({
      time: Math.floor(new Date(v.datetime).getTime() / 1000),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume, 10) || 0,
    }));
  }

  buildStatsUrl(symbol) {
    const params = new URLSearchParams({ symbol, apikey: this.apiKey });
    return `${this.baseUrl}/quote?${params}`;
  }

  parseStatsResponse(data) {
    if (data.status === "error") throw new Error(`Twelve Data quote: ${data.message}`);
    const fiftyTwoWeek = data.fifty_two_week || {};
    return {
      marketCap: data.market_cap ? parseFloat(data.market_cap) : null,
      peRatio: data.pe_ratio ? parseFloat(data.pe_ratio) : null,
      eps: data.eps ? parseFloat(data.eps) : null,
      volume: data.volume ? parseInt(data.volume, 10) : null,
      avgVolume: data.average_volume ? parseInt(data.average_volume, 10) : null,
      high52w: fiftyTwoWeek.high ? parseFloat(fiftyTwoWeek.high) : null,
      low52w: fiftyTwoWeek.low ? parseFloat(fiftyTwoWeek.low) : null,
      open: data.open ? parseFloat(data.open) : null,
      high: data.high ? parseFloat(data.high) : null,
      low: data.low ? parseFloat(data.low) : null,
      previousClose: data.previous_close ? parseFloat(data.previous_close) : null,
      name: data.name || null,
      exchange: data.exchange || null,
      currency: data.currency || "INR",
    };
  }
}

// ── CoinGecko (Crypto) ────────────────────────────────────────────────────
// Free tier: 10-30 calls/min, no API key needed for basic endpoint.
// Endpoint: GET /api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true
// Batch:    ids=bitcoin,ethereum,cardano
// Response: { bitcoin: { usd: 50000, usd_24h_change: 1.23 } }
//
// Symbol mapping: CoinGecko uses lowercase IDs (e.g. "bitcoin"), not tickers.
// For MVP, we maintain a small hardcoded map. In production, call /api/v3/coins/list.

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// Common crypto ticker -> CoinGecko ID mapping
const SYMBOL_TO_COINGECKO_ID = {
  BTCUSD: "bitcoin",
  ETHUSD: "ethereum",
  SOLUSD: "solana",
  XRPUSD: "ripple",
  ADAUSD: "cardano",
  DOTUSD: "polkadot",
  DOGEUSD: "dogecoin",
  AVAXUSD: "avalanche-2",
  MATICUSD: "matic-network",
  LINKUSD: "chainlink",
  UNIUSD: "uniswap",
  ATOMUSD: "cosmos",
  LTCUSD: "litecoin",
  BCHUSD: "bitcoin-cash",
  TRXUSD: "tron",
};

const COINGECKO_ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COINGECKO_ID).map(([k, v]) => [v, k])
);

export class CoinGeckoProvider extends MarketDataProvider {
  constructor() {
    super({
      name: "coingecko",
      baseUrl: COINGECKO_BASE,
      apiKey: "",
      maxPerMinute: 30,
    });
  }

  buildSingleUrl(symbol) {
    const id = SYMBOL_TO_COINGECKO_ID[symbol];
    if (!id) throw new Error(`Unknown crypto symbol: ${symbol}`);
    const params = new URLSearchParams({
      ids: id,
      vs_currencies: "usd",
      include_24hr_change: "true",
    });
    return `${this.baseUrl}/simple/price?${params}`;
  }

  buildBatchUrl(symbols) {
    const ids = symbols
      .map((s) => SYMBOL_TO_COINGECKO_ID[s])
      .filter(Boolean)
      .join(",");
    if (!ids) throw new Error("No known crypto symbols in batch");
    const params = new URLSearchParams({
      ids,
      vs_currencies: "usd",
      include_24hr_change: "true",
    });
    return `${this.baseUrl}/simple/price?${params}`;
  }

  parseSingleResponse(data) {
    const id = Object.keys(data)[0];
    const entry = data[id];
    if (!entry || entry.usd === undefined) {
      throw new Error(`CoinGecko: unexpected response for ${id}`);
    }
    return {
      price: entry.usd,
      change: entry.usd_24h_change || 0,
      changePercent: entry.usd_24h_change || 0,
      timestamp: new Date().toISOString(),
      provider: "coingecko",
    };
  }

  parseBatchResponse(data, symbols) {
    const results = new Map();
    for (const [id, entry] of Object.entries(data)) {
      const symbol = COINGECKO_ID_TO_SYMBOL[id];
      if (symbol && entry && entry.usd !== undefined) {
        results.set(symbol, {
          price: entry.usd,
          change: entry.usd_24h_change || 0,
          changePercent: entry.usd_24h_change || 0,
          timestamp: new Date().toISOString(),
          provider: "coingecko",
        });
      }
    }
    return results;
  }

  buildHistoryUrl(symbol, interval = "1d") {
    const id = SYMBOL_TO_COINGECKO_ID[symbol];
    if (!id) throw new Error(`Unknown crypto symbol: ${symbol}`);
    const days = interval === "1w" ? "365" : interval === "1d" ? "90" : "7";
    const params = new URLSearchParams({
      vs_currency: "usd",
      days,
    });
    return `${this.baseUrl}/coins/${id}/market_chart?${params}`;
  }

  parseHistoryResponse(data) {
    if (!data.prices) return [];
    return data.prices.map(([timestamp, price]) => ({
      time: Math.floor(timestamp / 1000),
      open: price, high: price, low: price, close: price,
      volume: 0,
    }));
  }

  buildStatsUrl(symbol) {
    const id = SYMBOL_TO_COINGECKO_ID[symbol];
    if (!id) throw new Error(`Unknown crypto symbol: ${symbol}`);
    const params = new URLSearchParams({
      localization: "false",
      tickers: "false",
      market_data: "true",
    });
    return `${this.baseUrl}/coins/${id}?${params}`;
  }

  parseStatsResponse(data) {
    const m = data.market_data || {};
    return {
      marketCap: m.market_cap?.usd || null,
      volume: m.total_volume?.usd || null,
      high24h: m.high_24h?.usd || null,
      low24h: m.low_24h?.usd || null,
      circulatingSupply: m.circulating_supply || null,
      totalSupply: m.total_supply || null,
      maxSupply: m.max_supply || null,
      ath: m.ath?.usd || null,
      athDate: m.ath_date?.usd || null,
      atl: m.atl?.usd || null,
      atlDate: m.atl_date?.usd || null,
      priceChange24h: m.price_change_percentage_24h || null,
      name: data.name || null,
    };
  }

  // Override to handle CoinGecko's rate limit response (plain text, not JSON)
  async _fetch(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("retry-after") || "60", 10);
          throw new RateLimitError(this.name, retryAfter);
        }
        const text = await response.text();
        throw new Error(`${this.name} HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Binance (Crypto OHLCV) ────────────────────────────────────────────────
// Free, no API key required for public klines endpoint.
// Maps our interval names to Binance kline intervals.
// Symbol mapping: BTCUSD -> BTCUSDT (Binance uses USDT pairs)

const BINANCE_BASE = "https://api.binance.com/api/v3";
const SYMBOL_TO_BINANCE = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
  XRPUSD: "XRPUSDT",
  ADAUSD: "ADAUSDT",
  DOTUSD: "DOTUSDT",
  DOGEUSD: "DOGEUSDT",
  AVAXUSD: "AVAXUSDT",
  MATICUSD: "MATICUSDT",
  LINKUSD: "LINKUSDT",
  UNIUSD: "UNIUSDT",
  ATOMUSD: "ATOMUSDT",
  LTCUSD: "LTCUSDT",
  BCHUSD: "BCHUSDT",
  TRXUSD: "TRXUSDT",
};

const INTERVAL_TO_BINANCE = {
  "1m": "1m", "5m": "5m", "15m": "15m",
  "1h": "1h", "1d": "1d", "1w": "1w",
};

export class BinanceProvider {
  constructor() {
    this.name = "binance";
    this.maxPerMinute = 1200;
  }

  async fetchHistory(symbol, interval = "1d") {
    const binanceSymbol = SYMBOL_TO_BINANCE[symbol.toUpperCase()];
    if (!binanceSymbol) throw new Error(`Unknown Binance symbol: ${symbol}`);
    const klineInterval = INTERVAL_TO_BINANCE[interval];
    if (!klineInterval) throw new Error(`Unsupported interval: ${interval}`);

    const limit = interval === "1w" ? 52 : interval === "1d" ? 60 : 120;
    const params = new URLSearchParams({
      symbol: binanceSymbol,
      interval: klineInterval,
      limit: String(limit),
    });

    const res = await fetch(`${BINANCE_BASE}/klines?${params}`);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const data = await res.json();

    return data.map((k) => ({
      time: Math.floor(k[0] / 1000),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }
}

// ── Upstox (Indian Stocks & F&O) ───────────────────────────────────────────
// Free developer tier: 1000 API calls/day, real-time WebSocket feed.
// Requires UPSTOX_API_KEY and UPSTOX_API_SECRET in .env.
// Endpoint: GET /v2/market-quote/quotes?symbol=NSE_EQ%7CRELIANCE
// Response: { ... last_price, net_change, change_percent, ohlc, volume, ... }
//
// Note: Upstox uses instrument keys like "NSE_EQ|RELIANCE" or "BSE_EQ|TCS".

const UPSTOX_BASE = "https://api.upstox.com/v2";

export class UpstoxProvider extends MarketDataProvider {
  constructor() {
    super({
      name: "upstox",
      baseUrl: UPSTOX_BASE,
      apiKey: process.env.UPSTOX_API_KEY || "",
      maxPerMinute: 15,
    });
    this.apiSecret = process.env.UPSTOX_API_SECRET || "";
    this.accessToken = null;
  }

  // Upstox requires OAuth2 token — for MVP we use a simple API key header
  _headers() {
    return {
      Accept: "application/json",
      "Api-Version": "2.0",
    };
  }

  _toInstrumentKey(assetType, symbol) {
    // NSE stocks: "NSE_EQ|RELIANCE"
    // BSE stocks: "BSE_EQ|TCS"
    // For MVP we default to NSE
    return `NSE_EQ|${symbol}`;
  }

  buildSingleUrl(symbol) {
    const key = this._toInstrumentKey("stock", symbol);
    const params = new URLSearchParams({ symbol: key, api_secret: this.apiSecret });
    return `${this.baseUrl}/market-quote/quotes?${params}`;
  }

  parseSingleResponse(data) {
    const entry = Object.values(data)[0];
    if (!entry) throw new Error(`Upstox: no data for symbol`);
    return {
      price: parseFloat(entry.last_price),
      change: parseFloat(entry.net_change || 0),
      changePercent: parseFloat(entry.change_percent || 0),
      timestamp: new Date().toISOString(),
      provider: "upstox",
    };
  }

  parseBatchResponse(data, symbols) {
    const results = new Map();
    for (const [key, entry] of Object.entries(data)) {
      const symbol = key.split("|").pop();
      if (symbol && entry?.last_price) {
        results.set(symbol, {
          price: parseFloat(entry.last_price),
          change: parseFloat(entry.net_change || 0),
          changePercent: parseFloat(entry.change_percent || 0),
          timestamp: new Date().toISOString(),
          provider: "upstox",
        });
      }
    }
    return results;
  }

  buildHistoryUrl(symbol, interval = "1day") {
    const key = this._toInstrumentKey("stock", symbol);
    const params = new URLSearchParams({
      instrument_key: key,
      interval: interval === "1d" ? "day" : interval,
      api_secret: this.apiSecret,
    });
    return `${this.baseUrl}/historical-candle/intraday?${params}`;
  }

  parseHistoryResponse(data) {
    if (!data?.data?.candles) return [];
    return data.data.candles.map((c) => ({
      time: Math.floor(new Date(c[0]).getTime() / 1000),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseInt(c[5], 10) || 0,
    }));
  }

  buildStatsUrl(symbol) {
    const key = this._toInstrumentKey("stock", symbol);
    const params = new URLSearchParams({ symbol: key, api_secret: this.apiSecret });
    return `${this.baseUrl}/market-quote/ohlc?${params}`;
  }

  parseStatsResponse(data) {
    const entry = Object.values(data)[0];
    if (!entry) return {};
    return {
      name: entry.company_name || null,
      exchange: entry.exchange || "NSE",
      open: parseFloat(entry.ohlc?.open || 0),
      high: parseFloat(entry.ohlc?.high || 0),
      low: parseFloat(entry.ohlc?.low || 0),
      close: parseFloat(entry.ohlc?.close || 0),
      volume: parseInt(entry.volume, 10) || 0,
      previousClose: parseFloat(entry.prev_close || 0),
      high52w: parseFloat(entry.week_high_52 || 0),
      low52w: parseFloat(entry.week_low_52 || 0),
      marketCap: parseFloat(entry.market_cap || 0),
      peRatio: parseFloat(entry.pe_ratio || 0),
    };
  }
}

// ── Fallback / Mock Stock Provider ───────────────────────────────────────────
// Generates realistic simulated prices when no real API is available.
// Uses deterministic seeding based on symbol so the same symbol gets consistent
// base prices, with random walk fluctuations for realism.

const BASE_PRICES = {
  RELIANCE: 2510, TCS: 3810, INFY: 1455, HDFCBANK: 1652, ICICIBANK: 1120,
  SBIN: 812, BHARTIARTL: 1230, ITC: 430, WIPRO: 440, TATAMOTORS: 980,
  BAJFINANCE: 6850, MARUTI: 10450, LT: 3520, SUNPHARMA: 1360, HCLTECH: 1420,
  NTPC: 340, POWERGRID: 310, M_M: 2820, TITAN: 3480, ULTRACEMCO: 9980,
  ADANIENT: 2890, ADANIPORTS: 1280, DMART: 4210, BAJAJFINSV: 1700,
  NESTLEIND: 25200, HAL: 4250, BEL: 1820, IRCTC: 1030, ZOMATO: 192,
  PAYTM: 810, NYKAA: 185, IRFC: 160, SBICARD: 780, CAMS: 2980, CDSL: 1620,
  IDEA: 14, YESBANK: 24, PNB: 92, BANKBARODA: 245, CANBK: 480,
  FEDERALBNK: 162, INDUSINDBK: 1420, RBLBANK: 225, IDFCFIRSTB: 82,
  BANDHANBNK: 205, JIOFIN: 265, TATACONSUM: 1120, TATAPOWER: 410,
  ONGC: 265, COALINDIA: 460, GAIL: 185, OIL: 435, HINDPETRO: 460,
  BPCL: 610, IOC: 155, ADANIGREEN: 1680, ADANITRANS: 1520, ADANIPOWER: 540,
  TATAMTRDVR: 650, BAJAJ_AUTO: 8520, EICHERMOT: 4680, HEROMOTOCO: 4980,
  CIPLA: 1420, DRREDDY: 6250, LUPIN: 1610, TORNTPHARM: 2680, ZYDUSLIFE: 820,
  TECHM: 1280, LTIM: 5320, MPHASIS: 2580, PERSISTENT: 4850, COFORGE: 5200,
  SBILIFE: 1620, HDFCLIFE: 680, ICICIPRULI: 650, MAXLIFE: 1080,
  TRENT: 4200, AVENUE: 1850, POLICYBZR: 1250,
  RVNL: 380, IRCON: 265, RAILTEL: 410, CONCOR: 1020, DFCCIL: 185,
  BHEL: 280, MAZAGON: 385, COCHINSHIP: 210, GRSE: 295, HSL: 185,
  NHPC: 105, SJVN: 125, NLCINDIA: 180, RECLTD: 510, PFC: 480,
  AAPL: 248, MSFT: 425, GOOGL: 183, AMZN: 198, TSLA: 350, NVDA: 950,
  META: 525, JPM: 205, V: 290, WMT: 72, JNJ: 155, PG: 172,
  KO: 68, PEP: 180, DIS: 108, NFLX: 680, ADBE: 490, CRM: 285,
  INTC: 32, AMD: 185, ORCL: 142, CSCO: 52, BA: 178, CAT: 365,
  GE: 178, IBM: 218, QCOM: 215, TXN: 208, AVGO: 1680, AMAT: 235,
  BABA: 82, TCEHY: 58, RIVN: 12, PLTR: 35, SNAP: 12, UBER: 72,
  SQ: 82, PYPL: 72, SHOP: 82, SPOT: 325, SONY: 92, TM: 170,
};

export class FallbackStockProvider {
  constructor() {
    this.name = "fallback";
    this.maxPerMinute = 9999;
  }

  _seed(symbol) {
    const s = symbol.toUpperCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  _getBasePrice(symbol) {
    const s = symbol.toUpperCase();
    if (BASE_PRICES[s]) return BASE_PRICES[s];
    const seed = this._seed(s);
    return 100 + (seed % 9900); // 100–10000 range
  }

  _generatePrice(symbol) {
    const base = this._getBasePrice(symbol);
    const seed = this._seed(symbol);
    const now = Date.now();
    // Use time-based jitter to simulate price movement
    const minutePhase = Math.floor(now / 60000) % 100;
    const wave = Math.sin(minutePhase * 0.3 + seed * 0.7) * (base * 0.02);
    const noise = ((seed * 13 + minutePhase * 7) % 21 - 10) * (base * 0.005);
    const price = Math.round((base + wave + noise) * 100) / 100;
    const prevPrice = Math.round((base + wave - noise * 0.5) * 100) / 100;
    const change = Math.round((price - prevPrice) * 100) / 100;
    const changePercent = prevPrice > 0 ? Math.round((change / prevPrice) * 10000) / 100 : 0;

    return {
      price: Math.max(price, 1),
      change,
      changePercent,
      timestamp: new Date().toISOString(),
      provider: "fallback",
    };
  }

  async fetchPrice(symbol) {
    return this._generatePrice(symbol);
  }

  async fetchPrices(symbols) {
    const results = new Map();
    for (const s of symbols) {
      results.set(s.toUpperCase(), this._generatePrice(s));
    }
    return results;
  }

  async fetchHistory(symbol, _interval = "1d") {
    const base = this._getBasePrice(symbol);
    const seed = this._seed(symbol);
    const candles = [];
    const now = Math.floor(Date.now() / 1000);
    for (let i = 100; i >= 0; i--) {
      const t = now - i * 86400;
      const wave = Math.sin(i * 0.1 + seed * 0.5) * (base * 0.05);
      const noise = ((seed * 3 + i * 7) % 15 - 7) * (base * 0.01);
      const close = Math.round((base + wave + noise) * 100) / 100;
      const open = Math.round((close * (1 + (i % 5 - 2) * 0.005)) * 100) / 100;
      candles.push({
        time: t,
        open, high: Math.round(Math.max(open, close) * 1.02 * 100) / 100,
        low: Math.round(Math.min(open, close) * 0.98 * 100) / 100,
        close,
        volume: Math.floor(100000 + Math.sin(i * 0.3 + seed) * 50000 + 50000),
      });
    }
    return candles;
  }

  async fetchStats(symbol) {
    const s = symbol.toUpperCase();
    const { price, change, changePercent } = this._generatePrice(s);
    const base = this._getBasePrice(s);
    return {
      name: s,
      exchange: BASE_PRICES[s] ? "NSE" : "NASDAQ",
      marketCap: base * 100000000,
      volume: Math.floor(1000000 + this._seed(s) % 9000000),
      avgVolume: Math.floor(800000 + this._seed(s) % 5000000),
      high52w: Math.round(base * 1.2 * 100) / 100,
      low52w: Math.round(base * 0.8 * 100) / 100,
      open: price - change + (change * 0.1),
      high: Math.round(price * 1.03 * 100) / 100,
      low: Math.round(price * 0.97 * 100) / 100,
      previousClose: price - change,
      peRatio: Math.round((15 + this._seed(s) % 25) * 100) / 100,
      eps: Math.round(base / (15 + this._seed(s) % 25) * 100) / 100,
      currency: BASE_PRICES[s] ? "INR" : "USD",
      sector: "Technology",
      industry: "Software",
      description: `${s} is a publicly traded company.`,
    };
  }
}

// ── Twelve Data Provider (Stock Prices) ────────────────────────────────────
// Reuses the existing TwelveDataProvider for price fetching too when key is set.

export function createStockProvider() {
  const twelveKey = process.env.TWELVEDATA_API_KEY;
  if (twelveKey && twelveKey.length > 10) {
    return new TwelveDataProvider(twelveKey);
  }
  return new FallbackStockProvider();
}

// ── Provider Registry ──────────────────────────────────────────────────────

const providers = {
  stock: createStockProvider(),
  crypto: new CoinGeckoProvider(),
};

const historyProviders = {
  stock: new TwelveDataProvider(),
  crypto: new BinanceProvider(),
};

export function getProvider(assetType) {
  const provider = providers[assetType];
  if (!provider) throw new Error(`No market data provider for asset type: ${assetType}`);
  return provider;
}

export function getHistoryProvider(assetType) {
  const provider = historyProviders[assetType];
  if (!provider) throw new Error(`No history provider for asset type: ${assetType}`);
  return provider;
}
