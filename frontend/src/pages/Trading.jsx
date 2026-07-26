import { useState, useMemo } from "react";
import { api } from "../services/api";
import { useSocketPrice } from "../hooks/useSocketPrice";
import SymbolSearchInput from "../components/SymbolSearchInput";

const ASSET_TYPES = ["stock", "crypto"];
const ORDER_TYPES = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop_loss", label: "Stop Loss" },
  { value: "bracket", label: "Bracket" },
];

function orderTypeNeedsPrice(type) {
  return ["limit", "stop_loss", "bracket"].includes(type);
}

export default function Trading() {
  const [assetType, setAssetType] = useState("stock");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("buy");
  const [quantity, setQuantity] = useState("");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const watchSymbols = useMemo(
    () => (symbol ? [{ assetType, symbol }] : []),
    [assetType, symbol],
  );
  const prices = useSocketPrice(watchSymbols);
  const socketPrice = prices[`${assetType}:${symbol}`]?.price;
  const [livePrice, setLivePrice] = useState(null);
  const currentPrice = livePrice || socketPrice;

  const handleSymbolSelect = async (item) => {
    setSymbol(item.symbol);
    setAssetType(item.assetType);
    setLivePrice(null);
    try {
      const data = await api.get(`/market/price/${item.assetType}/${item.symbol}`);
      setLivePrice(data.price);
    } catch {}
  };

  const totalValue = currentPrice && quantity ? currentPrice * Number(quantity) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setSubmitting(true);
    try {
      let body;
      if (orderType === "market") {
        body = { assetType, assetSymbol: symbol, side, quantity: Number(quantity), orderType: "market" };
      } else if (orderType === "limit") {
        body = { assetType, assetSymbol: symbol, side, quantity: Number(quantity), orderType: "limit", limitPrice: Number(limitPrice) };
      } else if (orderType === "stop_loss") {
        body = { assetType, assetSymbol: symbol, side, quantity: Number(quantity), orderType: "stop_loss", stopPrice: Number(stopPrice) };
      } else if (orderType === "bracket") {
        body = { assetType, assetSymbol: symbol, side, quantity: Number(quantity), orderType: "bracket", limitPrice: Number(limitPrice), stopPrice: Number(stopPrice), targetPrice: Number(targetPrice) };
      }
      const res = await api.post("/orders", body);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Place Order</h1>

      {currentPrice != null && symbol && (
        <div className="bg-gray-900 rounded-lg p-3 mb-4 border border-gray-800 flex items-center justify-between">
          <span className="font-mono text-lg font-bold">{symbol}</span>
          <span className="font-mono text-lg">{assetType === "crypto" ? "$" : "₹"}{currentPrice.toFixed(2)}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-gray-900 rounded-lg p-6 border border-gray-800 space-y-4">
        {error && <div className="bg-red-900/50 text-red-300 text-sm p-3 rounded">{error}</div>}
        {result && (
          <div className="bg-emerald-900/50 text-emerald-300 text-sm p-3 rounded">
            Order placed: {result.status} (ID: {result.id})
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Asset Type</label>
            <select value={assetType} onChange={(e) => { setAssetType(e.target.value); setSymbol(""); }} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Symbol</label>
            <SymbolSearchInput assetType={assetType} onSelect={handleSymbolSelect} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">Side</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSide("buy")} className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${side === "buy" ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Buy</button>
              <button type="button" onClick={() => setSide("sell")} className={`flex-1 py-2 rounded text-sm font-medium transition-colors ${side === "sell" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Sell</button>
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Order Type</label>
            <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
              {ORDER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-400 block mb-1">Quantity</label>
          <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} required min="1" step="1" placeholder="0" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
          {totalValue != null && (
            <div className="mt-1.5 text-xs text-gray-400">
              Total Value: <span className="font-mono text-emerald-400 font-medium">{assetType === "crypto" ? "$" : "₹"}{totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>

        {orderTypeNeedsPrice(orderType) && (
          <div>
            <label className="text-sm text-gray-400 block mb-1">Limit Price</label>
            <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} required={orderType === "limit" || orderType === "bracket"} step="0.01" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
        )}

        {["stop_loss", "bracket"].includes(orderType) && (
          <div>
            <label className="text-sm text-gray-400 block mb-1">Stop Price</label>
            <input type="number" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} required step="0.01" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
        )}

        {orderType === "bracket" && (
          <div>
            <label className="text-sm text-gray-400 block mb-1">Target Price</label>
            <input type="number" value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} required step="0.01" className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
          </div>
        )}

        <button type="submit" disabled={submitting || !symbol} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-2.5 rounded transition-colors">
          {submitting ? "Placing..." : `${side === "buy" ? "Buy" : "Sell"} ${symbol || "Asset"}`}
        </button>
      </form>
    </div>
  );
}