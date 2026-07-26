import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
} from "lightweight-charts";
import { INDICATOR_DEFS, calcIndicator } from "../indicators/engine";
import { detectPatterns } from "../indicators/patterns";
import IndicatorPanel from "./IndicatorPanel";
import DrawingTools from "./DrawingTools";

const RANGES = [
  { key: "1d", label: "1 Min", interval: "1m" },
  { key: "5d", label: "5 Min", interval: "5m" },
  { key: "1mo", label: "15 Min", interval: "15m" },
  { key: "3mo", label: "1 Hour", interval: "1h" },
  { key: "6mo", label: "1 Day", interval: "1d" },
  { key: "1y", label: "1 Week", interval: "1w" },
];

const FIXED_SUBCHART_HEIGHT = 120;

let drawingIdCounter = 0;

function formatTime(time) {
  if (typeof time === "number") {
    const d = new Date(time * 1000);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }
  return String(time);
}

function formatPrice(v) {
  if (v == null) return "-";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

const DEFAULT_INDICATOR_COLORS = {
  SMA: "#F59E0B",
  EMA: "#22C55E",
  BB: "#F472B6",
  SuperTrend: "#22C55E",
  PSAR: "#F59E0B",
  VWAP: "#A78BFA",
};

export default function AdvancedChart({ history, range, onRangeChange, normalizedSymbol, loading }) {
  const chartRef = useRef(null);
  const chartContainerRef = useRef(null);
  const subChartRefs = useRef([]);
  const subChartContainersRef = useRef([]);
  const chartInstance = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const overlaySeriesRef = useRef({});
  const drawingSeriesRef = useRef({});
  const tooltipRef = useRef(null);

  const [indicators, setIndicators] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [activeTool, setActiveTool] = useState(null);
  const [drawState, setDrawState] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null });
  const crosshairDataRef = useRef(null);

  const currentRanges = useRef({ history: [], patterns: [] });
  const indicatorsRef = useRef(indicators);
  indicatorsRef.current = indicators;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const activeToolRef = useRef(null);
  activeToolRef.current = activeTool;
  const drawStateRef = useRef(null);
  drawStateRef.current = drawState;

  // --- Detect patterns when history changes ---
  useEffect(() => {
    if (history.length > 0) {
      const detected = detectPatterns(history);
      setPatterns(detected);
    } else {
      setPatterns([]);
    }
  }, [history]);

  // --- Main chart creation ---
  useEffect(() => {
    if (!chartContainerRef.current || history.length === 0) return;
    const container = chartContainerRef.current;
    cleanupChart();

    try {
      const isIntraday = ["1d", "5d"].includes(range);
      const chart = createChart(container, {
        width: container.clientWidth || 800,
        height: 420,
        layout: { background: { color: "#111827" }, textColor: "#9CA3AF" },
        grid: { vertLines: { color: "#1F2937" }, horzLines: { color: "#1F2937" } },
        crosshair: { mode: 0 },
        timeScale: {
          borderColor: "#374151",
          timeVisible: true,
          secondsVisible: isIntraday,
        },
        rightPriceScale: {
          borderColor: "#374151",
          scaleMargins: { top: 0.05, bottom: 0.15 },
        },
      });

      const candles = chart.addSeries(CandlestickSeries, {
        upColor: "#34D399",
        downColor: "#EF4444",
        borderUpColor: "#34D399",
        borderDownColor: "#EF4444",
        wickUpColor: "#34D399",
        wickDownColor: "#EF4444",
      });

      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      chart.priceScale("volume").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      const volumeData = history.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)",
      }));
      volume.setData(volumeData);

      chartInstance.current = chart;
      candleSeriesRef.current = candles;
      volumeSeriesRef.current = volume;

      candles.setData(history);
      chart.timeScale().fitContent();

      // Crosshair tooltip
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.point) {
          setTooltip((t) => ({ ...t, visible: false }));
          return;
        }
        crosshairDataRef.current = param;
        const data = param.seriesData.get(candles);
        if (data) {
          setTooltip({
            visible: true,
            x: param.point.x,
            y: param.point.y,
            data: {
              time: data.time,
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
            },
          });
        }
      });

      // Drawing tool interaction using refs to avoid stale closures
      chart.subscribeClick((param) => {
        const tool = activeToolRef.current;
        const state = drawStateRef.current;
        const cSeries = candleSeriesRef.current;
        if (!tool || !param.time || !param.point || !cSeries) return;

        const priceData = param.seriesData?.get(cSeries);
        const price = priceData?.close ?? priceData?.value;
        if (!price) return;

        const time = param.time;

        if (tool === "horizontal") {
          setDrawings((prev) => [
            ...prev,
            { id: ++drawingIdCounter, type: "horizontal", time, price, color: "#A78BFA" },
          ]);
        } else if (tool === "vertical") {
          setDrawings((prev) => [
            ...prev,
            { id: ++drawingIdCounter, type: "vertical", time, color: "#A78BFA" },
          ]);
        } else if (tool === "trend" || tool === "ray" || tool === "fib") {
          if (!state) {
            setDrawState({ type: tool, point1: { time, price } });
          } else {
            const point1 = state.point1;
            const point2 = { time, price };
            if (tool === "trend") {
              setDrawings((prev) => [
                ...prev,
                { id: ++drawingIdCounter, type: "trend", point1, point2, color: "#A78BFA" },
              ]);
            } else if (tool === "ray") {
              setDrawings((prev) => [
                ...prev,
                { id: ++drawingIdCounter, type: "ray", point1, point2, color: "#A78BFA" },
              ]);
            } else if (tool === "fib") {
              const high = Math.max(point1.price, point2.price);
              const low = Math.min(point1.price, point2.price);
              const diff = high - low;
              const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((level) => ({
                level,
                price: high - diff * level,
                color: level === 0 || level === 1 ? "#EF4444" : "#F59E0B",
              }));
              setDrawings((prev) => [
                ...prev,
                { id: ++drawingIdCounter, type: "fib", point1, point2, levels: fibLevels, color: "#F59E0B" },
              ]);
            }
            setDrawState(null);
          }
        }
      });

      const observer = new ResizeObserver(([entry]) => {
        chart.applyOptions({ width: entry.contentRect.width });
      });
      observer.observe(container);
      chartRef.current = observer;
    } catch (err) {
      console.error("[Chart] creation error:", err);
    }

    return () => cleanupChart();
  }, [history, range]);

  // --- Overlay indicators ---
  useEffect(() => {
    if (!chartInstance.current || history.length === 0) return;
    const chart = chartInstance.current;

    Object.values(overlaySeriesRef.current).forEach((s) => {
      try { chart.removeSeries(s); } catch {}
    });
    overlaySeriesRef.current = {};

    indicators.forEach((ind) => {
      const def = INDICATOR_DEFS[ind.type];
      if (!def || !def.overlay) return;
      try {
        const result = calcIndicator(ind.type, history, ind.opts);
        if (!result || (Array.isArray(result) && result.length === 0)) return;

        if (ind.type === "BB") {
          overlaySeriesRef.current[`${ind.id}_upper`] = chart.addSeries(LineSeries, {
            color: ind.opts.color || "#F472B6",
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          overlaySeriesRef.current[`${ind.id}_middle`] = chart.addSeries(LineSeries, {
            color: ind.opts.color || "#F472B6",
            lineWidth: 1,
            lineStyle: 2,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          overlaySeriesRef.current[`${ind.id}_lower`] = chart.addSeries(LineSeries, {
            color: ind.opts.color || "#F472B6",
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          result.upper && overlaySeriesRef.current[`${ind.id}_upper`].setData(result.upper);
          result.middle && overlaySeriesRef.current[`${ind.id}_middle`].setData(result.middle);
          result.lower && overlaySeriesRef.current[`${ind.id}_lower`].setData(result.lower);
        } else if (ind.type === "SuperTrend") {
          const upData = result.filter((d) => d.direction === "up").map((d) => ({ time: d.time, value: d.value }));
          const downData = result.filter((d) => d.direction === "down").map((d) => ({ time: d.time, value: d.value }));
          overlaySeriesRef.current[`${ind.id}_up`] = chart.addSeries(LineSeries, {
            color: ind.opts.upColor || "#22C55E",
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          overlaySeriesRef.current[`${ind.id}_down`] = chart.addSeries(LineSeries, {
            color: ind.opts.downColor || "#EF4444",
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          upData.length && overlaySeriesRef.current[`${ind.id}_up`].setData(upData);
          downData.length && overlaySeriesRef.current[`${ind.id}_down`].setData(downData);
        } else {
          overlaySeriesRef.current[ind.id] = chart.addSeries(LineSeries, {
            color: ind.opts.color || DEFAULT_INDICATOR_COLORS[ind.type] || "#A78BFA",
            lineWidth: ind.opts.lineWidth || 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          overlaySeriesRef.current[ind.id].setData(result);
        }
      } catch (err) {
        console.warn(`[Chart] indicator ${ind.type} render error:`, err.message);
      }
    });
  }, [indicators, history]);

  // --- Sub-charts for non-overlay indicators ---
  useEffect(() => {
    const subIndicators = indicators.filter((ind) => {
      const def = INDICATOR_DEFS[ind.type];
      return def && !def.overlay;
    });

    // Clean up old sub-charts
    subChartRefs.current.forEach(({ chart, observer }) => {
      observer?.disconnect();
      try { chart.remove(); } catch {}
    });
    subChartRefs.current = [];

    if (subIndicators.length === 0) {
      subChartContainersRef.current.forEach((el) => el?.remove());
      subChartContainersRef.current = [];
      return;
    }

    const parent = chartContainerRef.current?.parentElement;
    if (!parent) return;

    // Remove old sub-chart containers
    subChartContainersRef.current.forEach((el) => el?.remove());
    subChartContainersRef.current = [];

    subIndicators.forEach((ind) => {
      const def = INDICATOR_DEFS[ind.type];
      if (!def) return;

      const paneDiv = document.createElement("div");
      paneDiv.className = "mt-0.5";
      paneDiv.style.height = `${def.pane?.height || FIXED_SUBCHART_HEIGHT}px`;
      parent.appendChild(paneDiv);
      subChartContainersRef.current.push(paneDiv);

      try {
        const subChart = createChart(paneDiv, {
          width: paneDiv.clientWidth || 800,
          height: def.pane?.height || FIXED_SUBCHART_HEIGHT,
          layout: { background: { color: "#111827" }, textColor: "#9CA3AF" },
          grid: { vertLines: { color: "#1F2937" }, horzLines: { color: "#1F2937" } },
          crosshair: { mode: 0 },
          timeScale: {
            borderColor: "#374151",
            timeVisible: true,
            visible: subIndicators.indexOf(ind) === subIndicators.length - 1,
          },
          rightPriceScale: { borderColor: "#374151" },
        });

        // Link time scale to main chart
        if (chartInstance.current) {
          subChart.timeScale().link(chartInstance.current.timeScale());
        }

        const result = calcIndicator(ind.type, history, ind.opts);
        if (!result) { subChart.remove(); return; }

        if (ind.type === "MACD" && result.macd) {
          const macdLine = subChart.addSeries(LineSeries, {
            color: ind.opts.color || "#22C55E",
            lineWidth: 1.5,
          });
          const signalLine = subChart.addSeries(LineSeries, {
            color: ind.opts.signalColor || "#F59E0B",
            lineWidth: 1,
          });
          const histSeries = subChart.addSeries(HistogramSeries, {
            color: ind.opts.histogramColor || "#6B7280",
            priceFormat: { type: "volume" },
            priceScaleId: "",
          });
          macdLine.setData(result.macd);
          signalLine.setData(result.signal);
          const histData = result.histogram.map((d) => ({
            time: d.time,
            value: d.value,
            color: d.value >= 0 ? "rgba(52,211,153,0.4)" : "rgba(239,68,68,0.4)",
          }));
          histSeries.setData(histData);
        } else if (ind.type === "Stochastic" && result.k) {
          const kLine = subChart.addSeries(LineSeries, {
            color: ind.opts.color || "#A78BFA",
            lineWidth: 1.5,
          });
          const dLine = subChart.addSeries(LineSeries, {
            color: ind.opts.signalColor || "#F59E0B",
            lineWidth: 1,
          });
          kLine.setData(result.k);
          dLine.setData(result.d);
        } else if (Array.isArray(result) && result.length > 0) {
          const line = subChart.addSeries(LineSeries, {
            color: ind.opts.color || "#A78BFA",
            lineWidth: 1.5,
          });
          line.setData(result);
        }

        subChart.timeScale().fitContent();

        const observer = new ResizeObserver(([entry]) => {
          subChart.applyOptions({ width: entry.contentRect.width });
        });
        observer.observe(paneDiv);

        subChartRefs.current.push({ chart: subChart, observer });
      } catch (err) {
        console.warn(`[Chart] sub-chart ${ind.type} error:`, err.message);
      }
    });
  }, [indicators, history]);

  // --- Drawing tools ---
  // For simplicity, drawings are rendered as LineSeries on the main chart
  useEffect(() => {
    if (!chartInstance.current) return;
    const chart = chartInstance.current;

    Object.values(drawingSeriesRef.current).forEach((s) => {
      try { chart.removeSeries(s); } catch {}
    });
    drawingSeriesRef.current = {};

    drawings.forEach((d) => {
      try {
        const color = d.color || "#A78BFA";
        if (d.type === "horizontal") {
          const s = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            lineStyle: 2,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          const times = history.map((h) => h.time);
          s.setData([
            { time: times[0], value: d.price },
            { time: times[times.length - 1], value: d.price },
          ]);
          drawingSeriesRef.current[d.id] = s;
        } else if (d.type === "trend" || d.type === "ray") {
          const s = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          s.setData([
            { time: d.point1.time, value: d.point1.price },
            { time: d.point2.time, value: d.point2.price },
          ]);
          drawingSeriesRef.current[d.id] = s;
        } else if (d.type === "fib") {
          if (d.levels) {
            d.levels.forEach((level, i) => {
              const s = chart.addSeries(LineSeries, {
                color: level.color || "#F59E0B",
                lineWidth: 1,
                lineStyle: 2,
                lastValueVisible: false,
                priceLineVisible: false,
              });
              const times = history.map((h) => h.time);
              s.setData([
                { time: times[0], value: level.price },
                { time: times[times.length - 1], value: level.price },
              ]);
              drawingSeriesRef.current[`${d.id}_${i}`] = s;
            });
          }
        }
      } catch (err) {
        console.warn(`[Chart] drawing ${d.id} error:`, err.message);
      }
    });
  }, [drawings, history]);

  const cleanupChart = useCallback(() => {
    overlaySeriesRef.current = {};
    drawingSeriesRef.current = {};
    volumeSeriesRef.current = null;
    candleSeriesRef.current = null;
    if (chartInstance.current) {
      try { chartInstance.current.remove(); } catch {}
      chartInstance.current = null;
    }
    subChartRefs.current.forEach(({ chart, observer }) => {
      observer?.disconnect();
      try { chart.remove(); } catch {}
    });
    subChartRefs.current = [];
    subChartContainersRef.current.forEach((el) => el?.remove());
    subChartContainersRef.current = [];
  }, []);

  const handleClearDrawings = useCallback(() => {
    setDrawings([]);
    setDrawState(null);
  }, []);

  // --- Indicator management ---
  const handleAddIndicator = useCallback(
    (type) => {
      const def = INDICATOR_DEFS[type];
      if (!def) return;
      setIndicators((prev) => [
        ...prev,
        { id: `${type}_${Date.now()}`, type, opts: { ...def.defaults } },
      ]);
    },
    [],
  );

  const handleRemoveIndicator = useCallback((id) => {
    setIndicators((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const handleUpdateIndicator = useCallback((id, newOpts) => {
    setIndicators((prev) =>
      prev.map((i) => (i.id === id ? { ...i, opts: newOpts } : i)),
    );
  }, []);

  const handleToolSelect = useCallback(
    (tool) => {
      setActiveTool(tool);
      setDrawState(null);
    },
    [],
  );

  // --- Pattern markers on candles ---
  useEffect(() => {
    if (!candleSeriesRef.current || patterns.length === 0) return;
    const markers = patterns.map((p) => ({
      time: p.time,
      position: p.color === "#22C55E" ? "belowBar" : "aboveBar",
      color: p.color,
      shape: p.color === "#22C55E" ? "arrowUp" : "arrowDown",
      text: p.label,
      size: 1,
    }));
    try {
      candleSeriesRef.current.setMarkers(markers);
    } catch {}
  }, [patterns]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanupChart();
  }, []);

  const indicatorCount = indicators.filter((i) => {
    const d = INDICATOR_DEFS[i.type];
    return d && !d.overlay;
  }).length;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {RANGES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onRangeChange(key)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors whitespace-nowrap ${
                  range === key
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DrawingTools
            activeTool={activeTool}
            onToolSelect={handleToolSelect}
            onClear={handleClearDrawings}
            disabled={history.length === 0}
          />
          {patterns.length > 0 && (
            <span className="text-xs text-gray-500" title={`${patterns.length} patterns detected`}>
              {patterns.length} patterns
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4">
        <div className="lg:col-span-3">
          {loading ? (
            <div className="flex items-center justify-center h-[420px] text-gray-500">Loading chart...</div>
          ) : history.length === 0 ? (
            <div className="flex items-center justify-center h-[420px] text-gray-500">No data for this timeframe</div>
          ) : (
            <div ref={chartContainerRef} style={{ height: 420, position: "relative" }}>
              <div
                ref={tooltipRef}
                style={{
                  display: tooltip.visible ? "block" : "none",
                  position: "absolute",
                  left: Math.min(tooltip.x + 15, (chartContainerRef.current?.clientWidth || 800) - 200),
                  top: Math.max(tooltip.y - 80, 0),
                  zIndex: 50,
                  pointerEvents: "none",
                  background: "rgba(17,24,39,0.95)",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              >
                {tooltip.data && (
                  <div className="space-y-1">
                    <div className="text-gray-400 text-xs mb-1">
                      {formatTime(tooltip.data.time)}
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500">O</span>
                      <span className="text-gray-200">{formatPrice(tooltip.data.open)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500">H</span>
                      <span className="text-emerald-400">{formatPrice(tooltip.data.high)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500">L</span>
                      <span className="text-red-400">{formatPrice(tooltip.data.low)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-500">C</span>
                      <span className="text-gray-200">{formatPrice(tooltip.data.close)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-gray-800">
          <IndicatorPanel
            indicators={indicators}
            onAdd={handleAddIndicator}
            onRemove={handleRemoveIndicator}
            onUpdate={handleUpdateIndicator}
            disabled={history.length === 0}
          />
        </div>
      </div>
    </div>
  );
}
