import { useState, useRef, useEffect } from "react";
import { INDICATOR_DEFS } from "../indicators/engine";

const GROUPS = ["Trend", "Momentum", "Volatility", "Volume", "Trend Strength"];

export default function IndicatorPanel({ indicators, onAdd, onRemove, onUpdate, disabled }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [groupFilter, setGroupFilter] = useState("All");
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const available = Object.entries(INDICATOR_DEFS).filter(
    ([key, def]) =>
      !indicators.some((i) => i.type === key) &&
      (groupFilter === "All" || def.group === groupFilter) &&
      (search === "" || def.label.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Indicators</h3>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(!open)}
            disabled={disabled}
            className="text-xs px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-30"
          >
            + Add
          </button>
          {open && (
            <div className="absolute right-0 top-8 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
              <div className="p-2 space-y-2">
                <input
                  type="text"
                  placeholder="Search indicators..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  autoFocus
                />
                <div className="flex gap-1 flex-wrap">
                  {["All", ...GROUPS].map((g) => (
                    <button
                      key={g}
                      onClick={() => setGroupFilter(g)}
                      className={`px-2 py-0.5 rounded text-xs ${
                        groupFilter === g
                          ? "bg-emerald-600 text-white"
                          : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              {available.length === 0 ? (
                <div className="px-3 py-4 text-gray-500 text-xs text-center">No indicators available</div>
              ) : (
                available.map(([key, def]) => (
                  <button
                    key={key}
                    onClick={() => {
                      onAdd(key);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center justify-between"
                  >
                    <span>{def.label}</span>
                    <span className="text-xs text-gray-500">{def.group}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {indicators.length === 0 && (
        <div className="px-3 py-4 text-gray-500 text-xs text-center">No indicators added</div>
      )}

      <div className="max-h-64 overflow-y-auto">
        {indicators.map((ind) => {
          const def = INDICATOR_DEFS[ind.type];
          if (!def) return null;
          return (
            <div
              key={ind.id}
              className="px-3 py-2 border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ind.opts.color || def.defaults.color }}
                  />
                  <span className="text-sm text-gray-200 truncate">{def.label}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditing(editing === ind.id ? null : ind.id)}
                    className="text-gray-500 hover:text-gray-300 p-0.5 text-xs"
                    title="Settings"
                  >
                    ⚙
                  </button>
                  <button
                    onClick={() => onRemove(ind.id)}
                    className="text-gray-500 hover:text-red-400 p-0.5 text-xs"
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {editing === ind.id && (
                <div className="mt-2 pl-4 space-y-2 border-l-2 border-gray-700">
                  {def.fields.map((field) => (
                    <label key={field.key} className="flex items-center justify-between text-xs text-gray-400">
                      <span>{field.label}</span>
                      {field.type === "color" ? (
                        <input
                          type="color"
                          value={ind.opts[field.key] || def.defaults[field.key]}
                          onChange={(e) => onUpdate(ind.id, { ...ind.opts, [field.key]: e.target.value })}
                          className="w-14 h-6 rounded cursor-pointer bg-gray-700 border border-gray-600"
                        />
                      ) : field.type === "select" ? (
                        <select
                          value={ind.opts[field.key] ?? def.defaults[field.key]}
                          onChange={(e) => onUpdate(ind.id, { ...ind.opts, [field.key]: Number(e.target.value) })}
                          className="bg-gray-700 border border-gray-600 rounded text-xs px-1 py-0.5 text-gray-200"
                        >
                          {field.options.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step ?? 1}
                          value={ind.opts[field.key] ?? def.defaults[field.key]}
                          onChange={(e) => onUpdate(ind.id, { ...ind.opts, [field.key]: Number(e.target.value) })}
                          className="w-16 bg-gray-700 border border-gray-600 rounded text-xs px-1 py-0.5 text-gray-200 text-right"
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
