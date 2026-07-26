import { Router } from "express";
import { getPrice, getPricesBulk, discoverActiveSymbols, getHistory, getStats, searchSymbols } from "../services/marketDataService.js";
import * as yahoo from "../services/yahooFinanceService.js";
import { getNews } from "../services/newsService.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /market/search?q=rel
// Also supports legacy /market/search/:query
router.get("/search", async (req, res) => {
  try {
    const query = req.query.q || "";
    const results = await searchSymbols(query);
    res.json({ results });
  } catch (err) {
    console.error("[MarketData] Search error:", err.message);
    res.status(502).json({ error: "Search failed" });
  }
});

// GET /market/quote/:symbol
// Single quote fetch. Uses provider chain with cache (not just Yahoo).
// Tries cache first, then real provider, then fallback.
router.get("/quote/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    // Try stock first, then crypto
    let result = await getPrice("stock", symbol).catch(() => null);
    if (!result || result.price === 0) {
      result = await getPrice("crypto", symbol).catch(() => null);
    }
    if (!result || result.price === 0) {
      const quote = await yahoo.getQuote(symbol);
      if (!quote) return res.status(404).json({ error: "Symbol not found" });
      return res.json(quote);
    }
    if (result.rateLimited) res.set("X-Data-Stale", "true");
    res.json(result);
  } catch (err) {
    console.error("[MarketData] Quote error:", err.message);
    res.status(502).json({ error: "Failed to fetch quote" });
  }
});

// GET /market/chart/:symbol
// Historical OHLC data for candlestick charts.
// Query params: range = 1d | 5d | 1mo | 3mo | 6mo | 1y | 5y (default: 1mo)
// Tries stock then crypto asset type.
router.get("/chart/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const range = req.query.range || "1mo";
    const interval = req.query.interval || "1d";
    // Try stock first, then crypto
    let history = await getHistory("stock", symbol, interval).catch(() => []);
    if (!history || history.length === 0) {
      history = await getHistory("crypto", symbol, interval).catch(() => []);
    }
    // Last resort: try Yahoo directly
    if (!history || history.length === 0) {
      history = await yahoo.getChart(symbol, range).catch(() => []);
    }
    res.json({ history, symbol, range });
  } catch (err) {
    console.error("[MarketData] Chart error:", err.message);
    res.status(502).json({ error: "Failed to fetch chart data" });
  }
});

// GET /market/info/:symbol
// Company info: name, exchange, market cap, 52w high/low, P/E, etc.
router.get("/info/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    // Try stock first, then crypto
    let info = await getStats("stock", symbol).catch(() => null);
    if (!info || !info.marketCap) {
      info = await getStats("crypto", symbol).catch(() => null);
    }
    if (!info) {
      info = await yahoo.getInfo(symbol).catch(() => null);
    }
    if (!info) return res.status(404).json({ error: "Info not found" });
    res.json({ info, symbol });
  } catch (err) {
    console.error("[MarketData] Info error:", err.message);
    res.status(502).json({ error: "Failed to fetch info" });
  }
});

// GET /market/watchlist/prices
// Fetch latest prices for all symbols in the user's watchlists.
router.get("/watchlist/prices", authenticate, async (req, res) => {
  try {
    const prices = await yahoo.getPortfolioPrices(req.user.id);
    res.json(prices);
  } catch (err) {
    console.error("[MarketData] Watchlist prices error:", err.message);
    res.status(502).json({ error: "Failed to fetch watchlist prices" });
  }
});

// GET /market/portfolio/prices
// Fetch latest prices for all symbols in the user's portfolio positions.
router.get("/portfolio/prices", authenticate, async (req, res) => {
  try {
    const prices = await yahoo.getPortfolioPrices(req.user.id);
    res.json(prices);
  } catch (err) {
    console.error("[MarketData] Portfolio prices error:", err.message);
    res.status(502).json({ error: "Failed to fetch portfolio prices" });
  }
});

// ── Legacy Endpoints (backward compatible) ─────────────────────────────────
// GET /market/search/:query
router.get("/search/:query", async (req, res) => {
  try {
    const results = await searchSymbols(req.params.query);
    res.json({ results });
  } catch (err) {
    console.error("[MarketData] Search error:", err.message);
    res.status(502).json({ error: "Search failed" });
  }
});

// GET /market/price/:assetType/:symbol
router.get("/price/:assetType/:symbol", async (req, res) => {
  const { assetType, symbol } = req.params;
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  try {
    const result = await getPrice(assetType, symbol.toUpperCase());
    if (result.rateLimited) {
      res.set("X-Data-Stale", "true");
      res.set("X-RateLimit-Provider", result.provider);
    }
    res.json(result);
  } catch (err) {
    console.error(`[MarketData] Error fetching ${assetType}:${symbol}:`, err.message);
    res.status(502).json({ error: "Failed to fetch price data" });
  }
});

// POST /market/prices
router.post("/prices", async (req, res) => {
  const { assetType, symbols } = req.body;
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: "symbols must be a non-empty array" });
  }
  try {
    const results = await getPricesBulk(assetType, symbols);
    const output = {};
    for (const [sym, data] of results) output[sym] = data;
    res.json(output);
  } catch (err) {
    console.error("[MarketData] Batch error:", err.message);
    res.status(502).json({ error: "Failed to fetch batch prices" });
  }
});

// GET /market/history/:assetType/:symbol
router.get("/history/:assetType/:symbol", async (req, res) => {
  const { assetType, symbol } = req.params;
  const interval = req.query.interval || "1d";
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  try {
    const history = await getHistory(assetType, symbol.toUpperCase(), interval);
    res.json({ history, symbol: symbol.toUpperCase(), assetType });
  } catch (err) {
    console.error(`[MarketData] History error for ${assetType}:${symbol}:`, err.message);
    res.status(502).json({ error: "Failed to fetch historical data" });
  }
});

// GET /market/stats/:assetType/:symbol
router.get("/stats/:assetType/:symbol", async (req, res) => {
  const { assetType, symbol } = req.params;
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  try {
    const stats = await getStats(assetType, symbol.toUpperCase());
    res.json({ stats, symbol: symbol.toUpperCase(), assetType });
  } catch (err) {
    console.error(`[MarketData] Stats error for ${assetType}:${symbol}:`, err.message);
    res.status(502).json({ error: "Failed to fetch stats" });
  }
});

// GET /market/news/:assetType/:symbol
router.get("/news/:assetType/:symbol", async (req, res) => {
  const { assetType, symbol } = req.params;
  try {
    const news = await getNews(assetType, symbol.toUpperCase());
    res.json({ news, symbol: symbol.toUpperCase(), assetType });
  } catch (err) {
    console.error(`[MarketData] News error:`, err.message);
    res.json({ news: [], symbol: symbol.toUpperCase(), assetType });
  }
});

// GET /market/active-symbols
router.get("/active-symbols", authenticate, async (_req, res) => {
  try {
    const active = await discoverActiveSymbols();
    res.json({ stock: [...active.stock], crypto: [...active.crypto], total: active.stock.size + active.crypto.size });
  } catch (err) {
    res.status(500).json({ error: "Failed to discover active symbols" });
  }
});

export default router;
