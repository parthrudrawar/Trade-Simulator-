import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { redis, redisSubscriber, USE_MOCK_REDIS } from "./config/redis.js";
import { prisma } from "./config/database.js";
import { createSocketServer } from "./config/socket.js";
import { startPriceBroadcast, stopPriceBroadcast } from "./services/priceBroadcast.js";
import authRoutes from "./routes/auth.js";
import marketDataRoutes from "./routes/marketData.js";
import { startOrderMatcher, stopOrderMatcher } from "./workers/orderMatcher.js";
import { startAlertMatcher, stopAlertMatcher } from "./workers/alertMatcher.js";
import { startPricePoller, stopPricePoller } from "./workers/pricePoller.js";
import { startBinanceWsFeed, stopBinanceWsFeed } from "./services/binanceWsFeed.js";
import orderRoutes from "./routes/orders.js";
import watchlistRoutes from "./routes/watchlists.js";
import alertRoutes from "./routes/alerts.js";
import analyticsRoutes from "./routes/analytics.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────────────────

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Routes ─────────────────────────────────────────────────────────────────

app.use("/auth", authRoutes);
app.use("/market", marketDataRoutes);
app.use("/orders", orderRoutes);
app.use("/watchlists", watchlistRoutes);
app.use("/alerts", alertRoutes);
app.use("/analytics", analyticsRoutes);

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: "ok", db: "connected", redis: "connected" });
  } catch (err) {
    res.status(503).json({ status: "degraded", error: err.message });
  }
});

async function seedFallbackPrices() {
  const symbols = [
    { assetType: "stock", symbol: "RELIANCE" }, { assetType: "stock", symbol: "TCS" },
    { assetType: "stock", symbol: "INFY" }, { assetType: "stock", symbol: "HDFCBANK" },
    { assetType: "stock", symbol: "AAPL" }, { assetType: "stock", symbol: "MSFT" },
    { assetType: "stock", symbol: "NVDA" }, { assetType: "stock", symbol: "TSLA" },
    { assetType: "crypto", symbol: "BTCUSD" }, { assetType: "crypto", symbol: "ETHUSD" },
  ];

  const fallback = {
    RELIANCE: 2510, TCS: 3810, INFY: 1455, HDFCBANK: 1652,
    AAPL: 248, MSFT: 425, NVDA: 950, TSLA: 350,
    BTCUSD: 65000, ETHUSD: 3200,
  };

  for (const { assetType, symbol } of symbols) {
    const price = fallback[symbol] || 100;
    const cacheKey = `price:${assetType}:${symbol}`;
    const entry = {
      price, change: 0, changePercent: 0,
      timestamp: new Date().toISOString(), provider: "preload",
    };
    await redis.set(`${cacheKey}:fallback`, JSON.stringify(entry));
  }
  console.log("Fallback prices seeded for common symbols");
}

// ── Start ──────────────────────────────────────────────────────────────────

async function start() {
  try {
    console.log("1. Connecting Redis...");
    await redis.connect();
    console.log("2. Redis connected");

    console.log("3. Connecting Redis Subscriber...");
    await redisSubscriber.connect();
    console.log("4. Redis subscriber connected");

    console.log("5. Connecting PostgreSQL...");
    console.log("DATABASE_URL =", process.env.DATABASE_URL);
    await prisma.$connect();
    console.log("6. PostgreSQL connected");

    if (USE_MOCK_REDIS) {
      console.log("7. Starting Price Poller (mock mode)...");
      await startPricePoller();
      console.log("8. Price Poller started");

      console.log("9. Starting Order Matcher...");
      await startOrderMatcher();
      console.log("10. Order Matcher started");

      console.log("11. Starting Alert Matcher...");
      await startAlertMatcher();
      console.log("12. Alert Matcher started");
    } else {
      console.log("7. Starting Price Poller...");
      await startPricePoller();
      console.log("8. Price Poller started");

      console.log("9. Starting Order Matcher...");
      await startOrderMatcher();
      console.log("10. Order Matcher started");

      console.log("11. Starting Alert Matcher...");
      await startAlertMatcher();
      console.log("12. Alert Matcher started");
    }

    // Start Binance WebSocket feed for real-time crypto prices (free, no key needed)
    console.log("Starting Binance WebSocket feed...");
    startBinanceWsFeed();
    console.log("Binance WebSocket feed started");

    const server = createServer(app);
    const io = createSocketServer(server);

    console.log("Starting Price Broadcast...");
    await startPriceBroadcast(io);
    console.log("Price Broadcast started");

    console.log("Starting Express server...");
    server.listen(PORT, () => {
      console.log(`🚀 TradeSimulator API running on http://localhost:${PORT}`);
    });

  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  stopBinanceWsFeed();
  if (!USE_MOCK_REDIS) {
    await stopPricePoller();
    await stopOrderMatcher();
    await stopAlertMatcher();
    await stopPriceBroadcast();
  }
  await prisma.$disconnect();
  redis.disconnect();
  redisSubscriber.disconnect();
  process.exit(0);
});

start();