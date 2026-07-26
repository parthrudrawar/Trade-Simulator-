import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  executeMarketOrder,
  createLimitOrder,
  createStopLossOrder,
  createBracketOrder,
  cancelOrder,
  listOrders,
  exportOrdersCSV,
} from "../services/orderExecutionService.js";

const router = Router();

// All order endpoints require authentication
router.use(authenticate);

// POST /orders — generic handler that routes by orderType in body
router.post("/", async (req, res) => {
  const { side, assetType, assetSymbol, quantity, orderType, limitPrice, stopPrice, targetPrice } = req.body;

  if (!["buy", "sell"].includes(side)) {
    return res.status(400).json({ error: "side must be 'buy' or 'sell'" });
  }
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  if (!assetSymbol || !quantity || quantity <= 0) {
    return res.status(400).json({ error: "assetSymbol and positive quantity required" });
  }

  try {
    let order;
    switch (orderType) {
      case "market":
        order = await executeMarketOrder(req.user.id, { side, assetType, assetSymbol, quantity });
        break;
      case "limit":
        if (!limitPrice || limitPrice <= 0) return res.status(400).json({ error: "positive limitPrice required" });
        order = await createLimitOrder(req.user.id, { side, assetType, assetSymbol, quantity, price: limitPrice });
        break;
      case "stop_loss":
        if (!stopPrice || stopPrice <= 0) return res.status(400).json({ error: "positive stopPrice required" });
        order = await createStopLossOrder(req.user.id, { side, assetType, assetSymbol, quantity, stopPrice });
        break;
      case "bracket":
        if (!limitPrice || limitPrice <= 0) return res.status(400).json({ error: "positive entryPrice required" });
        if (!targetPrice || targetPrice <= 0) return res.status(400).json({ error: "positive targetPrice required" });
        if (!stopPrice || stopPrice <= 0) return res.status(400).json({ error: "positive stopPrice required" });
        order = await createBracketOrder(req.user.id, { side, assetType, assetSymbol, quantity, entryPrice: limitPrice, targetPrice, stopPrice });
        break;
      default:
        return res.status(400).json({ error: `unknown orderType: ${orderType}` });
    }
    res.status(201).json(order);
  } catch (err) {
    const status = err.message.includes("Insufficient") ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
});

// POST /orders/market
// Executes synchronously at current cached price.
// Body: { side, assetType, assetSymbol, quantity }
router.post("/market", async (req, res) => {
  const { side, assetType, assetSymbol, quantity } = req.body;

  if (!["buy", "sell"].includes(side)) {
    return res.status(400).json({ error: "side must be 'buy' or 'sell'" });
  }
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  if (!assetSymbol || !quantity || quantity <= 0) {
    return res.status(400).json({ error: "assetSymbol and positive quantity required" });
  }

  try {
    const order = await executeMarketOrder(req.user.id, {
      side, assetType, assetSymbol, quantity,
    });
    res.status(201).json(order);
  } catch (err) {
    const status = err.message.includes("Insufficient") ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
});

// POST /orders/limit
// Creates a pending limit order. Matched asynchronously when market price
// reaches the limit price.
// Body: { side, assetType, assetSymbol, quantity, price }
router.post("/limit", async (req, res) => {
  const { side, assetType, assetSymbol, quantity, price } = req.body;

  if (!price || price <= 0) {
    return res.status(400).json({ error: "positive price required" });
  }

  try {
    const order = await createLimitOrder(req.user.id, {
      side, assetType, assetSymbol, quantity, price,
    });
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /orders/stop-loss
// Creates a pending stop-loss order. Triggers when market price crosses
// the stop price.
// Body: { side, assetType, assetSymbol, quantity, stopPrice }
router.post("/stop-loss", async (req, res) => {
  const { side, assetType, assetSymbol, quantity, stopPrice } = req.body;

  if (!stopPrice || stopPrice <= 0) {
    return res.status(400).json({ error: "positive stopPrice required" });
  }

  try {
    const order = await createStopLossOrder(req.user.id, {
      side, assetType, assetSymbol, quantity, stopPrice,
    });
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /orders/bracket
// Creates a bracket order: entry (limit) + target (limit) + stop-loss.
// Body: { side, assetType, assetSymbol, quantity, entryPrice, targetPrice, stopPrice }
router.post("/bracket", async (req, res) => {
  const { side, assetType, assetSymbol, quantity, entryPrice, targetPrice, stopPrice } = req.body;

  if (!entryPrice || entryPrice <= 0) {
    return res.status(400).json({ error: "positive entryPrice required" });
  }
  if (!targetPrice || targetPrice <= 0) {
    return res.status(400).json({ error: "positive targetPrice required" });
  }
  if (!stopPrice || stopPrice <= 0) {
    return res.status(400).json({ error: "positive stopPrice required" });
  }

  // Validation: target must be above entry for buys (sell target), below for sells
  if (side === "buy" && targetPrice <= entryPrice) {
    return res.status(400).json({ error: "targetPrice must be above entryPrice for buy" });
  }
  if (side === "buy" && stopPrice >= entryPrice) {
    return res.status(400).json({ error: "stopPrice must be below entryPrice for buy" });
  }
  if (side === "sell" && targetPrice >= entryPrice) {
    return res.status(400).json({ error: "targetPrice must be below entryPrice for sell" });
  }
  if (side === "sell" && stopPrice <= entryPrice) {
    return res.status(400).json({ error: "stopPrice must be above entryPrice for sell" });
  }

  try {
    const order = await createBracketOrder(req.user.id, {
      side, assetType, assetSymbol, quantity, entryPrice, targetPrice, stopPrice,
    });
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /orders/:id/cancel
// Cancels a pending/open order. If cancelling a bracket parent, also
// cancels its children.
router.post("/:id/cancel", async (req, res) => {
  try {
    const order = await cancelOrder(req.user.id, req.params.id);
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /orders
// List user's orders with optional filters.
// Query: status, assetType, assetSymbol, orderType, side, from, to, page, limit
router.get("/", async (req, res) => {
  try {
    const result = await listOrders(req.user.id, req.query);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /orders/export/csv
// Download trade history as CSV.
// Same filters as GET /orders (status, assetType, etc.)
router.get("/export/csv", async (req, res) => {
  try {
    const csv = await exportOrdersCSV(req.user.id, req.query);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="trade-history-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
