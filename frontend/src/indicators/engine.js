import {
  sma, ema, rsi, macd, bollingerbands, atr, adx, cci,
  stochastic, williamsr, roc, obv,
  adl, psar,
  vwap as tiVwap,
} from "technicalindicators";

export const INDICATOR_DEFS = {
  SMA: {
    label: "Simple Moving Average",
    group: "Trend",
    overlay: true,
    defaults: { period: 20, color: "#F59E0B", lineWidth: 1 },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 500 },
      { key: "color", label: "Color", type: "color" },
      { key: "lineWidth", label: "Width", type: "select", options: [1, 2, 3, 4] },
    ],
  },
  EMA: {
    label: "Exponential Moving Average",
    group: "Trend",
    overlay: true,
    defaults: { period: 20, color: "#22C55E", lineWidth: 1 },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 500 },
      { key: "color", label: "Color", type: "color" },
      { key: "lineWidth", label: "Width", type: "select", options: [1, 2, 3, 4] },
    ],
  },
  RSI: {
    label: "Relative Strength Index",
    group: "Momentum",
    overlay: false,
    pane: { height: 120, top: 0.7 },
    defaults: { period: 14, color: "#A78BFA", overbought: 70, oversold: 30 },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "color", label: "Color", type: "color" },
      { key: "overbought", label: "Overbought", type: "number", min: 50, max: 100 },
      { key: "oversold", label: "Oversold", type: "number", min: 0, max: 50 },
    ],
  },
  MACD: {
    label: "MACD",
    group: "Momentum",
    overlay: false,
    pane: { height: 120, top: 0.7 },
    defaults: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, color: "#22C55E", signalColor: "#F59E0B", histogramColor: "#6B7280" },
    fields: [
      { key: "fastPeriod", label: "Fast", type: "number", min: 1, max: 100 },
      { key: "slowPeriod", label: "Slow", type: "number", min: 1, max: 200 },
      { key: "signalPeriod", label: "Signal", type: "number", min: 1, max: 100 },
      { key: "color", label: "MACD Color", type: "color" },
      { key: "signalColor", label: "Signal Color", type: "color" },
    ],
  },
  BB: {
    label: "Bollinger Bands",
    group: "Volatility",
    overlay: true,
    defaults: { period: 20, stdDev: 2, color: "#F472B6", fillColor: "rgba(244,114,182,0.08)" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "stdDev", label: "Std Dev", type: "number", min: 0.5, max: 5, step: 0.5 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
  ATR: {
    label: "Average True Range",
    group: "Volatility",
    overlay: false,
    pane: { height: 100, top: 0.8 },
    defaults: { period: 14, color: "#F59E0B" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
  SuperTrend: {
    label: "SuperTrend",
    group: "Trend",
    overlay: true,
    defaults: { period: 10, multiplier: 3, upColor: "#22C55E", downColor: "#EF4444" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "multiplier", label: "Multiplier", type: "number", min: 1, max: 10, step: 0.5 },
      { key: "upColor", label: "Up Color", type: "color" },
      { key: "downColor", label: "Down Color", type: "color" },
    ],
  },
  PSAR: {
    label: "Parabolic SAR",
    group: "Trend",
    overlay: true,
    defaults: { step: 0.02, max: 0.2, color: "#F59E0B" },
    fields: [
      { key: "step", label: "Step", type: "number", min: 0.001, max: 0.5, step: 0.001 },
      { key: "max", label: "Max", type: "number", min: 0.01, max: 1, step: 0.01 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
  Stochastic: {
    label: "Stochastic Oscillator",
    group: "Momentum",
    overlay: false,
    pane: { height: 120, top: 0.7 },
    defaults: { period: 14, signalPeriod: 3, color: "#A78BFA", signalColor: "#F59E0B" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "signalPeriod", label: "Signal", type: "number", min: 1, max: 50 },
      { key: "color", label: "K Color", type: "color" },
      { key: "signalColor", label: "D Color", type: "color" },
    ],
  },
  CCI: {
    label: "Commodity Channel Index",
    group: "Momentum",
    overlay: false,
    pane: { height: 120, top: 0.7 },
    defaults: { period: 20, color: "#22C55E" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
  OBV: {
    label: "On-Balance Volume",
    group: "Volume",
    overlay: false,
    pane: { height: 100, top: 0.8 },
    defaults: { color: "#22C55E" },
    fields: [
      { key: "color", label: "Color", type: "color" },
    ],
  },
  ADX: {
    label: "ADX",
    group: "Trend Strength",
    overlay: false,
    pane: { height: 120, top: 0.7 },
    defaults: { period: 14, color: "#F472B6" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
  VWAP: {
    label: "VWAP",
    group: "Volume",
    overlay: true,
    defaults: { color: "#A78BFA", lineWidth: 1 },
    fields: [
      { key: "color", label: "Color", type: "color" },
      { key: "lineWidth", label: "Width", type: "select", options: [1, 2, 3, 4] },
    ],
  },
  WilliamsR: {
    label: "Williams %R",
    group: "Momentum",
    overlay: false,
    pane: { height: 120, top: 0.7 },
    defaults: { period: 14, color: "#F59E0B" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
  ROC: {
    label: "Rate of Change",
    group: "Momentum",
    overlay: false,
    pane: { height: 100, top: 0.8 },
    defaults: { period: 12, color: "#A78BFA" },
    fields: [
      { key: "period", label: "Period", type: "number", min: 1, max: 100 },
      { key: "color", label: "Color", type: "color" },
    ],
  },
};

function toOhlc(candles) {
  return {
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    volume: candles.map((c) => c.volume),
    timestamp: candles.map((c) => c.time),
  };
}

function align(candles, result) {
  const offset = candles.length - result.length;
  return result.map((v, i) => ({
    time: candles[offset + i].time,
    value: v,
  }));
}

function alignMulti(candles, result) {
  const offset = candles.length - result.length;
  return result.map((v, i) => ({
    time: candles[offset + i].time,
    value: v,
  }));
}

export function calcIndicator(type, candles, opts = {}) {
  if (!candles || candles.length < 10) return [];
  const ohlc = toOhlc(candles);
  const def = INDICATOR_DEFS[type];
  if (!def) return [];

  try {
    switch (type) {
      case "SMA":
        return align(candles, sma({ values: ohlc.close, period: opts.period || 20 }));

      case "EMA":
        return align(candles, ema({ values: ohlc.close, period: opts.period || 20 }));

      case "RSI":
        return align(candles, rsi({ values: ohlc.close, period: opts.period || 14 }));

      case "MACD": {
        const result = macd({
          values: ohlc.close,
          fastPeriod: opts.fastPeriod || 12,
          slowPeriod: opts.slowPeriod || 26,
          signalPeriod: opts.signalPeriod || 9,
          SimpleMAOscillator: false,
          SimpleMASignal: false,
        });
        return {
          macd: align(candles, result.MACD),
          signal: align(candles, result.signal),
          histogram: align(candles, result.histogram),
        };
      }

      case "BB": {
        const result = bollingerbands({
          values: ohlc.close,
          period: opts.period || 20,
          stdDev: opts.stdDev || 2,
        });
        return {
          upper: align(candles, result.upper),
          middle: align(candles, result.middle),
          lower: align(candles, result.lower),
        };
      }

      case "ATR":
        return align(candles, atr({ high: ohlc.high, low: ohlc.low, close: ohlc.close, period: opts.period || 14 }));

      case "SuperTrend": {
        const period = opts.period || 10;
        const multiplier = opts.multiplier || 3;
        const atrVals = atr({ high: ohlc.high, low: ohlc.low, close: ohlc.close, period });
        const atrOffset = candles.length - atrVals.length;
        const result = [];
        let prevUpper = 0, prevLower = 0;
        for (let i = atrOffset; i < candles.length; i++) {
          const hl = (candles[i].high + candles[i].low) / 2;
          const basicUpper = hl + multiplier * atrVals[i - atrOffset];
          const basicLower = hl - multiplier * atrVals[i - atrOffset];
          const upper = i === atrOffset ? basicUpper : (basicUpper < prevUpper || candles[i - 1].close > prevUpper ? basicUpper : prevUpper);
          const lower = i === atrOffset ? basicLower : (basicLower > prevLower || candles[i - 1].close < prevLower ? basicLower : prevLower);
          const direction = i === atrOffset ? "up" : (result[result.length - 1].direction === "up" && candles[i].close < upper ? "down" : (result[result.length - 1].direction === "down" && candles[i].close > lower ? "up" : result[result.length - 1].direction));
          const value = direction === "up" ? lower : upper;
          prevUpper = upper;
          prevLower = lower;
          result.push({ time: candles[i].time, value, direction });
        }
        return result;
      }

      case "PSAR":
        return psar({ high: ohlc.high, low: ohlc.low, step: opts.step || 0.02, max: opts.max || 0.2 })
          .map((v, i) => ({ time: candles[i].time, value: v }));

      case "Stochastic": {
        const result = stochastic({
          high: ohlc.high, low: ohlc.low, close: ohlc.close,
          period: opts.period || 14,
          signalPeriod: opts.signalPeriod || 3,
        });
        return {
          k: align(candles, result.k),
          d: align(candles, result.d),
        };
      }

      case "CCI":
        return align(candles, cci({ high: ohlc.high, low: ohlc.low, close: ohlc.close, period: opts.period || 20 }));

      case "OBV":
        return obv({ close: ohlc.close, volume: ohlc.volume })
          .map((v, i) => ({ time: candles[i].time, value: v }));

      case "ADX":
        return align(candles, adx({ high: ohlc.high, low: ohlc.low, close: ohlc.close, period: opts.period || 14 }));

      case "VWAP":
        return tiVwap({ high: ohlc.high, low: ohlc.low, close: ohlc.close, volume: ohlc.volume })
          .map((v, i) => ({ time: candles[i].time, value: v }));

      case "WilliamsR":
        return align(candles, williamsr({ high: ohlc.high, low: ohlc.low, close: ohlc.close, period: opts.period || 14 }));

      case "ROC":
        return align(candles, roc({ values: ohlc.close, period: opts.period || 12 }));

      default:
        return [];
    }
  } catch (err) {
    console.warn(`[Indicator] ${type} calculation failed:`, err.message);
    return [];
  }
}

let cache = {};

export function clearIndicatorCache() {
  cache = {};
}

export function getCachedIndicator(type, candles, opts) {
  const key = `${type}_${JSON.stringify(opts)}_${candles.length}_${candles[candles.length - 1]?.time}`;
  if (cache[key]) return cache[key];
  const result = calcIndicator(type, candles, opts);
  cache[key] = result;
  return result;
}
