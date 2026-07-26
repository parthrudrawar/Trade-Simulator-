import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "../services/socket";

const PriceContext = createContext(null);

export function PriceProvider({ children }) {
  const [prices, setPrices] = useState({});
  const subscriptionsRef = useRef(new Set());
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const handlePriceUpdate = (data) => {
      if (!data || !data.symbol) return;
      setPrices((prev) => ({
        ...prev,
        [`${data.assetType}:${data.symbol}`]: {
          price: data.price,
          change: data.change || 0,
          changePercent: data.changePercent || 0,
          timestamp: data.timestamp || new Date().toISOString(),
          provider: data.provider || "ws",
        },
      }));
    };

    const handleReconnect = () => {
      const subs = [...subscriptionsRef.current];
      if (subs.length > 0) {
        socket.emit("subscribe", subs);
      }
    };

    socket.on("price:update", handlePriceUpdate);
    socket.on("connect", handleReconnect);

    // Resubscribe on reconnect
    if (subscriptionsRef.current.size > 0) {
      socket.emit("subscribe", [...subscriptionsRef.current]);
    }

    return () => {
      socket.off("price:update", handlePriceUpdate);
      socket.off("connect", handleReconnect);
    };
  }, []);

  const subscribe = useCallback((symbols) => {
    const socket = socketRef.current;
    const newSubs = [];
    for (const s of symbols) {
      const key = `${s.assetType}:${s.symbol}`;
      if (!subscriptionsRef.current.has(key)) {
        subscriptionsRef.current.add(key);
        newSubs.push(s);
      }
    }
    if (newSubs.length > 0 && socket?.connected) {
      socket.emit("subscribe", newSubs);
    }
  }, []);

  const unsubscribe = useCallback((symbols) => {
    const socket = socketRef.current;
    const removeSubs = [];
    for (const s of symbols) {
      const key = `${s.assetType}:${s.symbol}`;
      if (subscriptionsRef.current.has(key)) {
        subscriptionsRef.current.delete(key);
        removeSubs.push(s);
      }
    }
    if (removeSubs.length > 0 && socket?.connected) {
      socket.emit("unsubscribe", removeSubs);
    }
  }, []);

  return (
    <PriceContext.Provider value={{ prices, subscribe, unsubscribe }}>
      {children}
    </PriceContext.Provider>
  );
}

export function useLivePrices(symbols = []) {
  const ctx = useContext(PriceContext);
  if (!ctx) throw new Error("useLivePrices must be inside PriceProvider");

  const { prices, subscribe, unsubscribe } = ctx;

  useEffect(() => {
    if (symbols.length === 0) return;
    subscribe(symbols);
    return () => unsubscribe(symbols);
  }, [symbols, subscribe, unsubscribe]);

  return prices;
}

export function useLivePrice(assetType, symbol) {
  const prices = useLivePrices(
    assetType && symbol ? [{ assetType, symbol }] : []
  );
  if (!assetType || !symbol) return null;
  return prices[`${assetType}:${symbol.toUpperCase()}`] || null;
}
