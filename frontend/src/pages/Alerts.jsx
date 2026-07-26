import { useState, useEffect, useCallback } from "react";
import { api } from "../services/api";

const DIRECTIONS = [
  { value: "above", label: "Price Above" },
  { value: "below", label: "Price Below" },
];

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [includeTriggered, setIncludeTriggered] = useState(false);
  const [form, setForm] = useState({ assetType: "stock", assetSymbol: "", direction: "above", targetPrice: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await api.get("/alerts", { params: { includeTriggered: includeTriggered || undefined } });
      setAlerts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [includeTriggered]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/alerts", { ...form, targetPrice: Number(form.targetPrice), assetSymbol: form.assetSymbol.toUpperCase() });
      setForm({ assetType: "stock", assetSymbol: "", direction: "above", targetPrice: "" });
      fetchAlerts();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = async (id) => {
    await api.put(`/alerts/${id}/dismiss`);
    fetchAlerts();
  };

  const handleDelete = async (id) => {
    await api.delete(`/alerts/${id}`);
    fetchAlerts();
  };

  if (loading) return <div className="text-gray-400">Loading alerts...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Price Alerts</h1>

      <form onSubmit={handleCreate} className="bg-gray-900 rounded-lg p-4 border border-gray-800 space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">Create Alert</h2>
        {error && <div className="bg-red-900/50 text-red-300 text-sm p-3 rounded">{error}</div>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
            <option value="stock">Stock</option>
            <option value="crypto">Crypto</option>
          </select>
          <input type="text" value={form.assetSymbol} onChange={(e) => setForm({ ...form, assetSymbol: e.target.value })} required placeholder="RELIANCE" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-emerald-500" />
          <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
            {DIRECTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <input type="number" value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: e.target.value })} required step="0.01" placeholder="Price" className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
          <button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded transition-colors">
            {submitting ? "Creating..." : "Create Alert"}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input type="checkbox" checked={includeTriggered} onChange={(e) => setIncludeTriggered(e.target.checked)} className="rounded border-gray-600 bg-gray-800" />
          Include triggered
        </label>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-800">
        {alerts.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No alerts. Create one above.</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {alerts.map((alert) => (
              <div key={alert.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{alert.assetSymbol}</span>
                    <span className="text-xs text-gray-500">{alert.assetType}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${alert.direction === "above" ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
                      {alert.direction === "above" ? "↑ Above" : "↓ Below"} ₹{alert.targetPrice}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Created {new Date(alert.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {alert.triggeredAt && <> · Triggered {new Date(alert.triggeredAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {alert.triggered && (
                    <button onClick={() => handleDismiss(alert.id)} className="text-emerald-400 hover:text-emerald-300 text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors">
                      Dismiss
                    </button>
                  )}
                  <button onClick={() => handleDelete(alert.id)} className="text-red-400 hover:text-red-300 text-xs px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
