import { Server } from "socket.io";
import { verifyAccessToken } from "./jwt.js";

// ── Room Naming Convention ─────────────────────────────────────────────────
// Rooms follow the pattern: `price:{assetType}:{SYMBOL}`
// Examples: "price:stock:RELIANCE", "price:crypto:BTCUSD"
//
// WHY PER-SYMBOL ROOMS (NOT ONE GLOBAL CHANNEL)?
//
// With a global broadcast, every client receives EVERY price update for EVERY
// symbol — whether they care about it or not. The client must then filter
// 14,000+ updates/sec to find the 5 symbols it actually displays. This wastes:
//
//   Client CPU: JS thread processes 14,000 irrelevant messages/sec
//   Network bandwidth: 10,000 clients x 14,000 updates = 140M messages/sec
//   Server memory: Socket.io must track who got what for backpressure
//
// With per-symbol rooms:
//   Client A watching RELIANCE joins room "price:stock:RELIANCE"
//   Client B watching BTCUSD joins room "price:crypto:BTCUSD"
//   When RELIANCE price updates: server emits to room "price:stock:RELIANCE"
//   Client A receives 1 message. Client B receives 0 messages.
//
// Each client receives EXACTLY N messages per tick, where N = number of
// symbols they're watching. O(N) per client instead of O(market).

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
    },
    // Heartbeat: 25s interval, 20s timeout before disconnect
    // Balances: frequent enough to detect dead connections quickly, rare enough
    // to avoid wasting bandwidth on 10,000 concurrent connections.
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // ── JWT Auth Middleware ────────────────────────────────────────────────
  // Every WebSocket connection must provide a valid access token in the
  // handshake: `io(url, { auth: { token } })`.
  //
  // Why auth on WebSocket? Without it, anyone could subscribe to price updates
  // without being a registered user. For a paper trading platform this is
  // acceptable for MVP (price data is public), but the infrastructure is in
  // place for future user-specific events (order fills, alerts).

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
      // For MVP: allow unauthenticated connections for public price data
      // In production: reject with next(new Error("Authentication required"))
      socket.userId = null;
      return next();
    }

    try {
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.sub;
      socket.userEmail = decoded.email;
      next();
    } catch {
      // Token expired or invalid — allow connection but mark as guest
      socket.userId = null;
      next();
    }
  });

  // ── Connection Handler ─────────────────────────────────────────────────

  io.on("connection", (socket) => {
    // Subscribe client to one or more symbol rooms
    // Payload: [{ assetType: "stock", symbol: "RELIANCE" }, ...]
    socket.on("subscribe", (symbols) => {
      if (!Array.isArray(symbols)) return;

      for (const { assetType, symbol } of symbols) {
        if (!assetType || !symbol) continue;
        const room = `price:${assetType}:${symbol.toUpperCase()}`;
        socket.join(room);
      }
    });

    // Unsubscribe client from one or more symbol rooms
    // Payload: same format as subscribe
    socket.on("unsubscribe", (symbols) => {
      if (!Array.isArray(symbols)) return;

      for (const { assetType, symbol } of symbols) {
        if (!assetType || !symbol) continue;
        const room = `price:${assetType}:${symbol.toUpperCase()}`;
        socket.leave(room);
      }
    });

    // On disconnect, Socket.io automatically removes the client from ALL rooms.
    // No manual cleanup needed. When the client reconnects, it must re-subscribe
    // (handled by the React hook).
  });

  return io;
}
