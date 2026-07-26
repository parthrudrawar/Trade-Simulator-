import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "../services/socket.js";

// ── useSocketPrice ─────────────────────────────────────────────────────────
//
// Subscribes to real-time price updates for a set of symbols and returns the
// latest prices as a Map-like object keyed by "assetType:symbol".
//
// USAGE:
//   const prices = useSocketPrice([
//     { assetType: "stock", symbol: "RELIANCE" },
//     { assetType: "crypto", symbol: "BTCUSD" },
//   ]);
//   // prices["stock:RELIANCE"] → { price: 2500, change: 12.5, ... }
//
// SUBSCRIBE/UNSUBSCRIBE LIFECYCLE:
//   1. Component mounts → hook calls socket.emit("subscribe", subscriptions)
//   2. Server adds client to rooms: "price:stock:RELIANCE", "price:crypto:BTCUSD"
//   3. Price updates arrive → server emits "price:update" to those rooms
//   4. Component unmounts → hook calls socket.emit("unsubscribe", subscriptions)
//   5. Server removes client from rooms
//
// NAVIGATION (e.g., moving from watchlist → asset detail):
//   1. Component re-renders with new subscriptions
//   2. Cleanup of previous effect: unsubscribe OLD symbols
//   3. New effect runs: subscribe NEW symbols
//   4. Server updates room membership atomically
//
// Why this matters: if we didn't unsubscribe on navigation, a user browsing
// 10 pages would accumulate subscriptions for every asset they've ever viewed.
// The server would push 10x the updates, and the client would process them all.
//
// RECONNECTION:
//   Socket.io reconnects automatically with exponential backoff (1s → 30s cap).
//   On reconnect, the server's rooms were cleared (disconnect = leave all rooms).
//   The hook listens for the "connect" event and re-emits all current subscriptions.
//   This ensures the user never misses updates after a brief network interruption.

export function useSocketPrice(subscriptions = []) {
  const [prices, setPrices] = useState({});

  // Ref to always have the latest subscriptions available in event handlers.
  // We use this in the reconnect handler to re-subscribe to whatever the
  // current subscriptions are (not what they were when the effect mounted).
  const subsRef = useRef(subscriptions);
  subsRef.current = subscriptions;

  // Stable callback for price updates — avoids re-attaching on every render
  const handlePriceUpdate = useCallback((data) => {
    setPrices((prev) => ({
      ...prev,
      [`${data.assetType}:${data.symbol}`]: data,
    }));
  }, []);

  useEffect(() => {
    const socket = getSocket();

    // Capture the subscriptions at the time this effect RUNS (not when the
    // ref might be updated by a later render). This is the set we'll
    // unsubscribe in the cleanup.
    const currentSubs = subscriptions;

    // ── Subscribe on mount / change ──────────────────────────────────────
    if (currentSubs.length > 0) {
      socket.emit("subscribe", currentSubs);
    }

    // ── Re-subscribe on reconnect ────────────────────────────────────────
    // When the socket reconnects after a drop, all rooms were cleared.
    // We re-subscribe to whatever the CURRENT subscriptions are.
    const handleReconnect = () => {
      const latest = subsRef.current;
      if (latest.length > 0) {
        socket.emit("subscribe", latest);
      }
    };
    socket.on("connect", handleReconnect);

    // ── Listen for price updates ─────────────────────────────────────────
    socket.on("price:update", handlePriceUpdate);

    // ── Cleanup on unmount / subscription change ─────────────────────────
    return () => {
      // Unsubscribe only the symbols this particular effect subscribed to
      if (currentSubs.length > 0) {
        socket.emit("unsubscribe", currentSubs);
      }

      socket.off("connect", handleReconnect);
      socket.off("price:update", handlePriceUpdate);
    };
  }, [subscriptions, handlePriceUpdate]);

  return prices;
}
