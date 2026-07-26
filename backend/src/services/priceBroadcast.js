import { redisSubscriber } from "../config/redis.js";
import { queueOrderCheck } from "../workers/orderMatcher.js";
import { queueAlertCheck } from "../workers/alertMatcher.js";

// ── Redis PUB/SUB → Socket.io Bridge + Order Matching + Alert Checks ──────
//
// This module subscribes to the Redis `price:updates` channel and does THREE
// things with each message:
//   1. Forward to Socket.io (real-time price push to clients)
//   2. Push a Bull job to the order matcher (check pending orders for this
//      symbol — event-driven execution, not polling)
//   3. Push a Bull job to the alert matcher (check price alerts for this
//      symbol — same event-driven pattern as orders)
//
// Redis decouples the price fetcher (which writes to Redis) from the
// WebSocket server (which reads from Redis). This means:
//   - Price fetcher and WS server can scale independently
//   - Multiple WS server instances all receive the same price stream
//   - If the WS server restarts, it doesn't miss price updates (they're
//     cached in Redis for new connections to catch up via REST)
//
// ioredis SUBSCRIBE limitation: a connection in subscriber mode cannot
// execute regular commands. `redisSubscriber` is a dedicated connection
// (see config/redis.js).

export async function startPriceBroadcast(io) {
  await redisSubscriber.subscribe("price:updates", (err, count) => {
    if (err) {
      console.error("[PriceBroadcast] Subscribe failed:", err.message);
      return;
    }
    console.log(`[PriceBroadcast] Listening on price:updates (${count} channel)`);
  });

  redisSubscriber.on("message", (channel, message) => {
    if (channel !== "price:updates") return;

    try {
      const data = JSON.parse(message);
      const room = `price:${data.assetType}:${data.symbol}`;

      // 1. Forward to WebSocket clients
      io.to(room).emit("price:update", data);

      // 2. Trigger order matching for this symbol (event-driven async execution)
      //    Fire-and-forget: if the queue is down, the 60s fallback scan catches it.
      queueOrderCheck(data.assetType, data.symbol).catch(() => {});

      // 3. Trigger price alert checking for this symbol (same event-driven pattern)
      queueAlertCheck(data.assetType, data.symbol).catch(() => {});
    } catch (err) {
      console.error("[PriceBroadcast] Failed to parse message:", err.message);
    }
  });

  // Handle subscriber reconnection
  redisSubscriber.on("reconnecting", () => {
    console.log("[PriceBroadcast] Reconnecting to Redis...");
  });

  redisSubscriber.on("connect", () => {
    console.log("[PriceBroadcast] Reconnected. Resubscribing to price:updates...");
    // After reconnect, ioredis does NOT auto-resubscribe (autoResubscribe: false),
    // so we must subscribe again manually.
    redisSubscriber.subscribe("price:updates").catch((err) => {
      console.error("[PriceBroadcast] Resubscribe failed:", err.message);
    });
  });
}

export async function stopPriceBroadcast() {
  await redisSubscriber.unsubscribe("price:updates");
  redisSubscriber.disconnect();
}
