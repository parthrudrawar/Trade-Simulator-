import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../services/api";

export default function SymbolSearchInput({ assetType, onSelect, placeholder, autoFocus }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get(`/market/search/${encodeURIComponent(q.trim())}`);
      setResults(data.results || []);
      setOpen(true);
      setHighlightIdx(-1);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value.toUpperCase();
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 250);
  };

  const selectItem = (item) => {
    setQuery(item.symbol);
    setOpen(false);
    onSelect(item);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      selectItem(results[highlightIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 200);
  };

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        required
        placeholder={placeholder || (assetType === "stock" ? "RELIANCE" : "BTCUSD")}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono uppercase focus:outline-none focus:border-emerald-500"
      />
      {loading && (
        <div className="absolute right-3 top-2">
          <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-64 overflow-y-auto">
          {results.map((item, i) => (
            <button
              key={`${item.assetType}:${item.symbol}`}
              type="button"
              className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800 transition-colors ${i === highlightIdx ? "bg-gray-800" : ""}`}
              onMouseDown={() => selectItem(item)}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm">{item.symbol}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.assetType === "crypto" ? "bg-amber-900/50 text-amber-300" : "bg-blue-900/50 text-blue-300"}`}>
                    {item.exchange}
                  </span>
                </div>
                <div className="text-xs text-gray-400 truncate">{item.name}</div>
              </div>
              <div className="text-right ml-3 shrink-0">
                {item.currentPrice != null ? (
                  <span className="font-mono text-sm font-medium">
                    {item.assetType === "crypto" ? "$" : "₹"}{item.currentPrice.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">—</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}