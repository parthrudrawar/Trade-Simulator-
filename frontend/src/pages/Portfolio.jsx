import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../services/api";
import { usePolling } from "../hooks/usePolling";
import { useLivePrices } from "../context/PriceContext";

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <td key={i} className="px-5 py-3.5"><div className="skeleton h-4 w-16" /></td>
      ))}
    </tr>
  );
}

export default function Portfolio() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.get("/analytics/summary");
      setSummary(data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  usePolling(fetchSummary, 60000);

  const positionSymbols = useMemo(
    () => (summary?.positions || []).map((p) => ({ assetType: p.assetType, symbol: p.symbol })),
    [summary?.positions],
  );
  const livePrices = useLivePrices(positionSymbols);

  const livePositions = useMemo(() => {
    if (!summary?.positions) return [];
    return summary.positions.map((p) => {
      const live = livePrices[`${p.assetType}:${p.symbol}`];
      const cp = live?.price ?? p.currentPrice;
      const value = cp * p.quantity;
      const invested = p.avgBuyPrice * p.quantity;
      const pnl = value - invested;
      const pnlPercent = invested > 0 ? ((pnl / invested) * 100) : 0;
      return { ...p, currentPrice: cp, value, pnl, pnlPercent };
    });
  }, [summary?.positions, livePrices]);

  const liveTotalPnl = useMemo(
    () => livePositions.reduce((sum, p) => sum + p.pnl, 0),
    [livePositions],
  );
  const liveTotalValue = useMemo(
    () => {
      const posVal = livePositions.reduce((sum, p) => sum + p.value, 0);
      const cash = (summary?.portfolio?.totalValue || 0) - (summary?.portfolio?.investedValue || 0);
      return posVal + cash;
    },
    [livePositions, summary?.portfolio],
  );

  const formatInr = (v) => `₹${(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const formatUsd = (v) => `$${(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const totalPnl = (liveTotalPnl ?? summary?.portfolio?.totalPnl) ?? 0;

  if (error) {
    return (
      <div className="bg-red-bg border border-red-900/30 text-red-400 text-sm p-4 rounded-2xl">{error}</div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-32 rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
        </div>
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-5 py-4 border-b border-border"><div className="skeleton h-4 w-32" /></div>
          <table className="w-full"><tbody>{[1, 2, 3].map((i) => <SkeletonRow key={i} />)}</tbody></table>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-6 animate-fadeIn">
      <h1 className="text-2xl font-bold text-white">Portfolio</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="text-gray-500 text-xs font-medium uppercase tracking-wider">Total Value</div>
          <div className="text-2xl font-bold mt-1.5 text-white font-mono">{formatInr(liveTotalValue)}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="text-gray-500 text-xs font-medium uppercase tracking-wider">Cash (INR)</div>
          <div className="text-2xl font-bold mt-1.5 text-white font-mono">{formatInr(summary.cash?.inr)}</div>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <div className="text-gray-500 text-xs font-medium uppercase tracking-wider">Cash (USD)</div>
          <div className="text-2xl font-bold mt-1.5 text-white font-mono">{formatUsd(summary.cash?.usd)}</div>
        </div>
        <div className={`bg-card rounded-2xl border border-border p-5 ${totalPnl >= 0 ? "border-accent/20" : "border-red-900/30"}`}>
          <div className="text-gray-500 text-xs font-medium uppercase tracking-wider">Total P&L</div>
          <div className={`text-2xl font-bold mt-1.5 font-mono ${totalPnl >= 0 ? "text-accent" : "text-red-400"}`}>
            {totalPnl >= 0 ? "+" : ""}{formatInr(totalPnl)}
          </div>
        </div>
      </div>

      {/* Open Positions */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-300">Open Positions ({livePositions.length})</h2>
        </div>
        {livePositions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-border">
                  <th className="text-left px-5 py-3 font-medium">Symbol</th>
                  <th className="text-left px-5 py-3 font-medium">Type</th>
                  <th className="text-right px-5 py-3 font-medium">Qty</th>
                  <th className="text-right px-5 py-3 font-medium">Avg Buy</th>
                  <th className="text-right px-5 py-3 font-medium">Current</th>
                  <th className="text-right px-5 py-3 font-medium">Value</th>
                  <th className="text-right px-5 py-3 font-medium">P&L</th>
                  <th className="text-right px-5 py-3 font-medium">Return</th>
                </tr>
              </thead>
              <tbody>
                {livePositions.map((p, i) => (
                  <tr key={p.symbol} className="border-b border-border/50 hover:bg-card-hover transition-colors animate-fadeIn" style={{ animationDelay: `${i * 50}ms` }}>
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-medium text-white">{p.symbol}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${p.assetType === "crypto" ? "bg-amber-900/40 text-amber-300" : "bg-blue-900/40 text-blue-300"}`}>
                        {p.assetType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono">{p.quantity}</td>
                    <td className="px-5 py-3.5 text-right font-mono">{formatInr(p.avgBuyPrice)}</td>
                    <td className="px-5 py-3.5 text-right font-mono">{formatInr(p.currentPrice)}</td>
                    <td className="px-5 py-3.5 text-right font-mono">{formatInr(p.value)}</td>
                    <td className={`px-5 py-3.5 text-right font-mono ${p.pnl >= 0 ? "text-accent" : "text-red-400"}`}>
                      {p.pnl >= 0 ? "+" : ""}{formatInr(p.pnl)}
                    </td>
                    <td className={`px-5 py-3.5 text-right font-mono ${p.pnlPercent >= 0 ? "text-accent" : "text-red-400"}`}>
                      {p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <p className="text-gray-500 text-sm">No open positions. Start trading!</p>
          </div>
        )}
      </div>

      {/* Reset Portfolio */}
      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-300">Reset Portfolio</h2>
            <p className="text-xs text-gray-500 mt-1">Reset to initial ₹10,00,000 balance. Cooldown: 24 hours.</p>
          </div>
          <button
            onClick={async () => {
              if (!confirm("Reset portfolio? This cannot be undone.")) return;
              try {
                await api.post("/auth/reset-portfolio");
                fetchSummary();
              } catch (err) {
                alert(err.message);
              }
            }}
            className="bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium px-4 py-2 rounded-xl border border-red-900/30 transition-all"
          >
            Reset Portfolio
          </button>
        </div>
      </div>
    </div>
  );
}