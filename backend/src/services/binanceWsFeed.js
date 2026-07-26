import WebSocket from "ws";
import { redis } from "../config/redis.js";

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws";

const SYMBOL_MAP = {
  BTCUSD: "btcusdt",
  ETHUSD: "ethusdt",
  SOLUSD: "solusdt",
  XRPUSD: "xrpusdt",
  ADAUSD: "adausdt",
  DOTUSD: "dotusdt",
  DOGEUSD: "dogeusdt",
  AVAXUSD: "avaxusdt",
  LINKUSD: "linkusdt",
  MATICUSD: "maticusdt",
  UNIUSD: "uniusdt",
  ATOMUSD: "atomusdt",
  LTCUSD: "ltcusdt",
  BCHUSD: "bchusdt",
  TRXUSD: "trxusdt",
};

const REVERSE_MAP = Object.fromEntries(
  Object.entries(SYMBOL_MAP).map(([k, v]) => [v.toUpperCase(), k])
);

let ws = null;
let reconnectTimer = null;
let subscribedStreams = new Set();

function getStreams() {
  return Object.values(SYMBOL_MAP).map((s) => `${s}@ticker`);
}

async function handleTicker(data) {
  const binanceSymbol = data.s.toUpperCase();
  const ourSymbol = REVERSE_MAP[binanceSymbol];
  if (!ourSymbol) return;

  const entry = {
    price: parseFloat(data.c),
    change: parseFloat(data.p),
    changePercent: parseFloat(data.P),
    high24h: parseFloat(data.h),
    low24h: parseFloat(data.l),
    volume: parseFloat(data.v),
    timestamp: new Date().toISOString(),
    provider: "binance_ws",
  };

  const cacheKey = `price:crypto:${ourSymbol}`;
  await redis.setex(cacheKey, 60, JSON.stringify(entry));
  await redis.publish("price:updates", JSON.stringify({
    assetType: "crypto",
    symbol: ourSymbol,
    price: entry.price,
    change: entry.change,
    changePercent: entry.changePercent,
    timestamp: entry.timestamp,
    provider: "binance_ws",
  }));
}

function connect() {
  if (ws) return;

  const streams = getStreams();
  const url = `${BINANCE_WS_BASE}/${streams.join("/")}`;

  ws = new WebSocket(url);

  ws.on("open", () => {
    console.log("[BinanceWS] Connected to real-time price feed");
    subscribedStreams = new Set(streams);
  });

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.e === "24hrTicker") {
        handleTicker(data).catch(() => {});
      }
    } catch {}
  });

  ws.on("close", (code) => {
    console.log(`[BinanceWS] Disconnected (code: ${code}). Reconnecting in 5s...`);
    ws = null;
    reconnectTimer = setTimeout(connect, 5000);
  });

  ws.on("error", (err) => {
    console.error("[BinanceWS] Error:", err.message);
    ws?.close();
  });
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscribedStreams.clear();
}

export function startBinanceWsFeed() {
  connect();
}

export function stopBinanceWsFeed() {
  disconnect();
}
