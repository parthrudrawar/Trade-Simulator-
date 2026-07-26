import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getDashboard,
  getPortfolioSummary,
  getPnLHistory,
  getWinRate,
  getBestWorstAssets,
  getSectorAllocation,
  getAvgHoldingPeriod,
  getVolatility,
  getSharpeRatio,
} from "../services/analyticsService.js";

const router = Router();
router.use(authenticate);

// GET /analytics/dashboard — all metrics in one response
router.get("/dashboard", async (req, res) => {
  try {
    const data = await getDashboard(req.user.id);
    res.json(data);
  } catch (err) {
    console.error("[Analytics] Dashboard error:", err.message);
    res.status(500).json({ error: "Failed to compute analytics" });
  }
});

// Individual metric endpoints (useful for lazy-loading UIs)

// GET /analytics/summary — portfolio cash, positions, total P&L
router.get("/summary", async (req, res) => {
  try {
    const data = await getPortfolioSummary(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/pnl?period=all|1d|1w|1m|3m|1y
router.get("/pnl", async (req, res) => {
  try {
    const period = req.query.period || "all";
    const data = await getPnLHistory(req.user.id, period);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/win-rate
router.get("/win-rate", async (req, res) => {
  try {
    const data = await getWinRate(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/best-worst
router.get("/best-worst", async (req, res) => {
  try {
    const data = await getBestWorstAssets(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/sectors
router.get("/sectors", async (req, res) => {
  try {
    const data = await getSectorAllocation(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/holding-period
router.get("/holding-period", async (req, res) => {
  try {
    const data = await getAvgHoldingPeriod(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/volatility
router.get("/volatility", async (req, res) => {
  try {
    const data = await getVolatility(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/sharpe
router.get("/sharpe", async (req, res) => {
  try {
    const data = await getSharpeRatio(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
