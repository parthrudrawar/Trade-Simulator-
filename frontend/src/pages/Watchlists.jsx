import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useSocketPrice } from "../hooks/useSocketPrice";
import { usePolling } from "../hooks/usePolling";
import SymbolSearchInput from "../components/SymbolSearchInput";

function WatchlistCard({ list, onRename, onDelete, onRemoveItem }) {
  const navigate = useNavigate();
  const symbols = useMemo(
    () => (list.items || []).map((i) => ({ assetType: i.assetType, symbol: i.assetSymbol })),
    [list.items],
  );
  const prices = useSocketPrice(symbols);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(list.name);
  const [statsMap, setStatsMap] = useState({});

  useEffect(() => {
    if (!list.items || list.items.length === 0) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const item of list.items) {
        try {
          const data = await api.get(`/market/stats/${item.assetType}/${item.assetSymbol}`);
          if (!cancelled) map[`${item.assetType}:${item.assetSymbol}`] = data.stats || {};
        } catch {}
      }
      if (!cancelled) setStatsMap(map);
    })();
    return () => { cancelled = true; };
  }, [list.items]);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <div className="p-3 border-b border-gray-800 flex items-center justify-between">
        {renaming ? (
          <form onSubmit={(e) => { e.preventDefault(); onRename(list.id, newName); setRenaming(false); }} className="flex gap-2">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm" autoFocus />
            <button type="submit" className="text-emerald-400 text-sm">Save</button>
            <button type="button" onClick={() => setRenaming(false)} className="text-gray-500 text-sm">Cancel</button>
          </form>
        ) : (
          <h3 className="font-semibold text-sm">{list.name} <span className="text-gray-500 font-normal text-xs">({(list.items || []).length})</span></h3>
        )}
        <div className="flex gap-2">
          <button onClick={() => setRenaming(true)} className="text-gray-500 hover:text-white text-xs">Rename</button>
          <button onClick={() => onDelete(list.id)} className="text-red-500 hover:text-red-400 text-xs">Delete</button>
        </div>
      </div>

      <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
        {(list.items || []).length === 0 && (
          <div className="text-center text-gray-600 text-xs py-4">Empty watchlist</div>
        )}
        {(list.items || []).map((item) => {
          const key = `${item.assetType}:${item.assetSymbol}`;
          const priceData = prices[key];
          const stats = statsMap[key];
          const isCrypto = item.assetType === "crypto";
          const change = priceData?.change;
          const changePercent = priceData?.changePercent;
          const isPositive = change != null && change >= 0;

          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/asset/${item.assetType}/${item.assetSymbol}`)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/asset/${item.assetType}/${item.assetSymbol}`); } }}
              className="w-full text-left bg-gray-800/50 hover:bg-gray-800 rounded-lg p-3 transition-colors border border-transparent hover:border-gray-700 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                {/* Logo placeholder */}
                <div className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-xs font-bold ${
                  isCrypto ? "bg-amber-900/50 text-amber-300" : "bg-blue-900/50 text-blue-300"
                }`}>
                  {(stats?.name || item.assetSymbol).slice(0, 2).toUpperCase()}
                </div>

                {/* Name + Symbol */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm">{item.assetSymbol}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isCrypto ? "bg-amber-900/40 text-amber-300" : "bg-blue-900/40 text-blue-300"
                    }`}>
                      {stats?.exchange || (isCrypto ? "CRYPTO" : "NSE")}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">
                    {stats?.name || "Loading..."}
                  </div>
                </div>

                {/* Price + Change */}
                <div className="text-right shrink-0">
                  {priceData ? (
                    <>
                      <div className="font-mono text-sm font-medium">
                        {isCrypto ? "$" : "₹"}{priceData.price?.toFixed(2)}
                      </div>
                      <div className={`text-xs font-medium mt-0.5 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                        {isPositive ? "+" : ""}{change?.toFixed(2)} ({isPositive ? "+" : ""}{changePercent?.toFixed(2)}%)
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-600">Waiting...</div>
                  )}
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemoveItem(list.id, item.id); }}
                  className="text-gray-600 hover:text-red-400 text-xs shrink-0"
                >✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Watchlists() {
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newListName, setNewListName] = useState("");
  const [addSymbol, setAddSymbol] = useState("");
  const [addType, setAddType] = useState("stock");
  const [selectedListId, setSelectedListId] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);

  const fetchLists = useCallback(async () => {
    try {
      const data = await api.get("/watchlists");
      setLists(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLists(); }, [fetchLists]);
  usePolling(fetchLists, 60000);

  useEffect(() => {
    if (lists.length > 0 && !selectedListId) {
      setSelectedListId(lists[0].id);
    }
  }, [lists, selectedListId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    await api.post("/watchlists", { name: newListName.trim() });
    setNewListName("");
    fetchLists();
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!addSymbol.trim() || !selectedListId) return;
    await api.post(`/watchlists/${selectedListId}/items`, {
      assetType: selectedItem?.assetType || addType,
      assetSymbol: addSymbol.toUpperCase(),
    });
    setAddSymbol("");
    setSelectedItem(null);
    fetchLists();
  };

  const handleSymbolSelect = (item) => {
    setAddSymbol(item.symbol);
    setAddType(item.assetType);
    setSelectedItem(item);
  };

  const handleRename = async (id, name) => {
    await api.put(`/watchlists/${id}`, { name });
    fetchLists();
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this watchlist?")) return;
    await api.delete(`/watchlists/${id}`);
    fetchLists();
  };

  const handleRemoveItem = async (listId, itemId) => {
    await api.delete(`/watchlists/${listId}/items/${itemId}`);
    fetchLists();
  };

  if (loading) return <div className="text-gray-400">Loading watchlists...</div>;

  return (
    <div className="flex flex-col h-full">
      {/* ── Fixed Top Section ── */}
      <div className="shrink-0 space-y-3 pb-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Watchlists</h1>
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="New watchlist name..."
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
            />
            <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-3 py-1.5 rounded">Create</button>
          </form>
        </div>

        <form onSubmit={handleAddItem} className="flex items-center gap-2">
          <select
            value={selectedListId}
            onChange={(e) => setSelectedListId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            {lists.length === 0 && <option value="">No watchlists</option>}
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="flex-1 max-w-xs">
            <SymbolSearchInput
              assetType={addType}
              onSelect={handleSymbolSelect}
              placeholder="Search symbol or company..."
            />
          </div>
          <button
            type="submit"
            disabled={!selectedListId || !addSymbol.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm px-4 py-1.5 rounded shrink-0"
          >
            Add to Watchlist
          </button>
        </form>
      </div>

      {/* ── Scrollable Cards Section ── */}
      <div className="flex-1 overflow-y-auto pt-4">
        {lists.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No watchlists yet. Create one to track your favorite assets.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {lists.map((list) => (
              <WatchlistCard
                key={list.id}
                list={list}
                onRename={handleRename}
                onDelete={handleDelete}
                onRemoveItem={handleRemoveItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}