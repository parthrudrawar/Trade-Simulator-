import { useState } from "react";

const TOOLS = [
  { id: null, label: "Pointer", icon: "⊜" },
  { id: "trend", label: "Trend Line", icon: "╱" },
  { id: "horizontal", label: "Horizontal Line", icon: "—" },
  { id: "vertical", label: "Vertical Line", icon: "|" },
  { id: "ray", label: "Ray", icon: "→" },
  { id: "fib", label: "Fibonacci", icon: "Fib" },
  { id: "clear", label: "Clear All", icon: "✕", danger: true },
];

export default function DrawingTools({ activeTool, onToolSelect, onClear, disabled }) {
  return (
    <div className="flex items-center gap-0.5 bg-gray-800/50 rounded-lg px-1 py-1">
      {TOOLS.map((tool) => (
        <button
          key={tool.id ?? "none"}
          onClick={() => {
            if (tool.id === "clear") { onClear?.(); return; }
            onToolSelect(activeTool === tool.id ? null : tool.id);
          }}
          disabled={disabled && tool.id !== "clear"}
          title={tool.label}
          className={`px-2 py-1 text-xs rounded font-mono transition-colors ${
            activeTool === tool.id
              ? "bg-emerald-600 text-white"
              : tool.danger
                ? "text-red-400 hover:bg-red-900/30"
                : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          } disabled:opacity-30`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
