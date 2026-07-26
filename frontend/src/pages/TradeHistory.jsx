import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";

const STATUSES = ["all", "filled", "pending", "cancelled", "rejected"];
const PAGE_SIZE = 20;

export default function TradeHistory() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState({ status: "all", symbol: "" });

  const fetchOrders = useCallback(async (pageNum = 1) => {
    setLoading(true);
    try {
      const params = { limit: PAGE_SIZE, offset: (pageNum - 1) * PAGE_SIZE };
      if (filters.status !== "all") params.status = filters.status;
      if (filters.symbol) params.assetSymbol = filters.symbol.toUpperCase();
      const data = await api.get("/orders", { params });
      setOrders(data.orders || data);
      setHasMore((data.orders || data).length === PAGE_SIZE);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { setPage(1); fetchOrders(1); }, [fetchOrders]);

  const handleExport = async () => {
    try {
      const res = await api.get("/orders/export/csv", { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "trade-history.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + err.message);
    }
  };

  const statusColor = (s) => {
    switch (s) {
      case "filled": return "text-emerald-400";
      case "pending": return "text-yellow-400";
      case "cancelled": return "text-gray-500";
      case "rejected": return "text-red-400";
      default: return "text-gray-400";
    }
  };

  const formatInr = (v) => `₹${(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trade History</h1>
        <button onClick={handleExport} className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded border border-gray-700 transition-colors">
          Export CSV
        </button>
      </div>

      <div className="flex gap-3 items-center">
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === "all" ? "All Status" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <input
          type="text"
          value={filters.symbol}
          onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
          placeholder="Filter by symbol..."
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
        />
      </div>

      {error && <div className="text-red-400 text-sm">{error}</div>}

      <div className="bg-gray-900 rounded-lg border border-gray-800">
        {loading && orders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No orders found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  <th className="p-3">Date</th>
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Side</th>
                  <th className="p-3">Qty</th>
                  <th className="p-3">Price</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="p-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(o.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="p-3 font-mono">{o.assetSymbol}</td>
                    <td className="p-3 text-gray-400">{o.orderType.replace("_", " ")}</td>
                    <td className={`p-3 font-medium ${o.side === "buy" ? "text-emerald-400" : "text-red-400"}`}>{o.side.toUpperCase()}</td>
                    <td className="p-3">{o.quantity}</td>
                    <td className="p-3">{o.filledPrice ? formatInr(o.filledPrice) : o.limitPrice ? formatInr(o.limitPrice) : "-"}</td>
                    <td className={`p-3 ${statusColor(o.status)}`}>{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-3 flex justify-between items-center border-t border-gray-800">
          <button
            onClick={() => { const p = page - 1; setPage(p); fetchOrders(p); }}
            disabled={page === 1}
            className="text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="text-xs text-gray-600">Page {page}</span>
          <button
            onClick={() => { const p = page + 1; setPage(p); fetchOrders(p); }}
            disabled={!hasMore}
            className="text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
