import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../services/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { usePolling } from "../hooks/usePolling";
import { useLivePrices } from "../context/PriceContext";

function SkeletonStatCard() {
  return (
    <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
      <div className="skeleton h-3 w-20" />
      <div className="skeleton h-7 w-28" />
      <div className="skeleton h-3 w-16" />
    </div>
  );
}

function StatCard({ label, value, change, prefix = "" }) {
  const isPositive = change != null && change >= 0;
  return (
    <div className="bg-card rounded-2xl border border-border p-5 hover:border-border-light transition-all duration-200 animate-fadeIn">
      <div className="text-gray-500 text-xs font-medium uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1.5 text-white font-mono">{value}</div>
      {change != null && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${isPositive ? "text-accent" : "text-red-400"}`}>
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d={isPositive ? "M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" : "M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"} clipRule="evenodd" />
          </svg>
          <span>{change >= 0 ? "+" : ""}{change.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
}

function SkeletonChart() {
  return <div className="skeleton h-[300px] rounded-2xl" />;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-xl">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm font-mono font-medium" style={{ color: p.color }}>
          {p.name}: ₹{Number(p.value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.get("/analytics/dashboard");
      setDashboard(data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);
  usePolling(fetchDashboard, 60000);

  // Subscribe to live prices for all positions
  const positionSymbols = useMemo(
    () => (dashboard?.summary?.positions || []).map((p) => ({ assetType: p.assetType, symbol: p.symbol })),
    [dashboard?.summary?.positions],
  );
  const livePrices = useLivePrices(positionSymbols);

  // Compute live positions by overlaying WebSocket prices on dashboard data
  const livePositions = useMemo(() => {
    if (!dashboard?.summary?.positions) return [];
    return dashboard.summary.positions.map((p) => {
      const live = livePrices[`${p.assetType}:${p.symbol}`];
      const cp = live?.price ?? p.currentPrice;
      const value = cp * p.quantity;
      const invested = p.avgBuyPrice * p.quantity;
      const pnl = value - invested;
      const pnlPercent = invested > 0 ? ((pnl / invested) * 100) : 0;
      return { ...p, currentPrice: cp, value, pnl, pnlPercent };
    });
  }, [dashboard?.summary?.positions, livePrices]);

  // Total P&L from live positions
  const liveTotalPnl = useMemo(
    () => livePositions.reduce((sum, p) => sum + p.pnl, 0),
    [livePositions],
  );
  const liveTotalValue = useMemo(
    () => {
      const posVal = livePositions.reduce((sum, p) => sum + p.value, 0);
      const cash = (dashboard?.summary?.cash?.inr || 0) + (dashboard?.summary?.cash?.usd || 0);
      return posVal + cash;
    },
    [livePositions, dashboard?.summary?.cash],
  );

  const formatInr = (v) => `₹${(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const formatUsd = (v) => `$${(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  if (error) {
    return (
      <div className="bg-red-bg border border-red-900/30 text-red-400 text-sm p-4 rounded-2xl">
        Failed to load dashboard: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-40 rounded-lg" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonStatCard key={i} />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonStatCard key={i} />)}
        </div>
        <SkeletonChart />
      </div>
    );
  }

  if (!dashboard) return null;

  const { summary, pnl, winRate, bestWorst, sectorAllocation, averageHoldingPeriod, volatility, sharpeRatio } = dashboard;
  const livePnl = (liveTotalPnl ?? summary?.portfolio?.totalPnl) ?? 0;
  const liveVal = (liveTotalValue ?? summary?.portfolio?.totalValue) ?? 0;
  const totalInvested = summary?.portfolio?.totalInvested || 0;
  const livePnlPct = totalInvested > 0 ? (livePnl / totalInvested) * 100 : summary?.portfolio?.totalPnlPercent;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <div className="text-xs text-gray-500">
          {livePositions.length} open positions
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Value" value={formatInr(liveVal)} change={livePnlPct} />
        <StatCard label="Cash (INR)" value={formatInr(summary?.cash?.inr)} />
        <StatCard label="Cash (USD)" value={formatUsd(summary?.cash?.usd)} />
        <StatCard label="Total P&L" value={formatInr(livePnl)} change={livePnlPct} />
      </div>

      {/* Stats Row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Win Rate" value={winRate != null ? `${winRate.winRate.toFixed(1)}%` : "—"} />
        <StatCard label="Avg Holding" value={averageHoldingPeriod?.averageDays != null ? `${averageHoldingPeriod.averageDays.toFixed(1)}d` : "—"} />
        <StatCard label="Volatility" value={volatility?.annualizedVolatility != null ? `${(volatility.annualizedVolatility * 100).toFixed(2)}%` : "—"} />
        <StatCard label="Sharpe Ratio" value={sharpeRatio?.sharpeRatio != null ? sharpeRatio.sharpeRatio.toFixed(2) : "—"} />
      </div>

      {/* P&L Chart */}
      {pnl?.history?.length > 1 && (
        <div className="bg-card rounded-2xl border border-border p-5 animate-slideUp">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-300">P&L History</h2>
            <span className={`text-xs font-medium ${livePnl >= 0 ? "text-accent" : "text-red-400"}`}>
              {livePnl >= 0 ? "+" : ""}{formatInr(livePnl)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={pnl.history}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="cumulativePnl" stroke="#22C55E" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {bestWorst?.all?.length > 0 && (
          <div className="bg-card rounded-2xl border border-border p-5 animate-slideUp">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Positions P&L</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bestWorst.all}>
                <XAxis dataKey="symbol" tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="pnl" fill="#22C55E" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {sectorAllocation?.byType?.length > 0 && (
          <div className="bg-card rounded-2xl border border-border p-5 animate-slideUp">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Allocation by Type</h2>
            <div className="space-y-3">
              {sectorAllocation.byType.map((s) => (
                <div key={s.type}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400 capitalize">{s.type}</span>
                    <span className="font-mono text-white font-medium">{formatInr(s.value)}</span>
                  </div>
                  <div className="h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all duration-500"
                      style={{ width: `${s.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Open Positions Table */}
      {livePositions.length > 0 && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden animate-slideUp">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-gray-300">Open Positions ({livePositions.length})</h2>
          </div>
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
                      <div className={`text-[10px] ${p.pnlPercent >= 0 ? "text-accent/70" : "text-red-400/70"}`}>
                        ({p.pnlPercent >= 0 ? "+" : ""}{p.pnlPercent.toFixed(2)}%)
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}