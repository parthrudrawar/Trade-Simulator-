function isDoji(c) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  return range > 0 && body / range < 0.1;
}

function isHammer(c, prev) {
  if (!prev) return false;
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const range = c.high - c.low;
  if (range === 0) return false;
  const bodyRatio = body / range;
  return bodyRatio < 0.3 && lowerWick > body * 2 && upperWick < body * 0.5 && prev.close < prev.open;
}

function isHangingMan(c, prev) {
  if (!prev) return false;
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const range = c.high - c.low;
  if (range === 0) return false;
  const bodyRatio = body / range;
  return bodyRatio < 0.3 && lowerWick > body * 2 && upperWick < body * 0.5 && prev.close > prev.open;
}

function isShootingStar(c, prev) {
  if (!prev) return false;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const range = c.high - c.low;
  if (range === 0) return false;
  const bodyRatio = body / range;
  return bodyRatio < 0.3 && upperWick > body * 2 && lowerWick < body * 0.5 && prev.close > prev.open;
}

function isBullishEngulfing(c, prev) {
  if (!prev) return false;
  return c.close > c.open && prev.close < prev.open && c.close > prev.open && c.open < prev.close;
}

function isBearishEngulfing(c, prev) {
  if (!prev) return false;
  return c.close < c.open && prev.close > prev.open && c.close < prev.open && c.open > prev.close;
}

function isBullishHarami(c, prev) {
  if (!prev) return false;
  return c.close > c.open && prev.close < prev.open && c.close < prev.open && c.open > prev.close && c.close < prev.close && c.open > prev.open;
}

function isBearishHarami(c, prev) {
  if (!prev) return false;
  return c.close < c.open && prev.close > prev.open && c.close > prev.open && c.open < prev.close && c.close < prev.close && c.open > prev.open;
}

function isMorningStar(c, prev, prev2) {
  if (!prev || !prev2) return false;
  const firstBear = prev2.close < prev2.open;
  const thirdBull = c.close > c.open;
  const middleSmall = Math.abs(prev.close - prev.open) < Math.abs(prev2.close - prev2.open) * 0.5;
  const gapDown = prev.high < prev2.low;
  const gapUp = c.low > prev.high;
  return firstBear && middleSmall && gapDown && gapUp && thirdBull;
}

function isEveningStar(c, prev, prev2) {
  if (!prev || !prev2) return false;
  const firstBull = prev2.close > prev2.open;
  const thirdBear = c.close < c.open;
  const middleSmall = Math.abs(prev.close - prev.open) < Math.abs(prev2.close - prev2.open) * 0.5;
  const gapUp = prev.low > prev2.high;
  const gapDown = c.high < prev.low;
  return firstBull && middleSmall && gapUp && gapDown && thirdBear;
}

function isThreeWhiteSoldiers(c, prev, prev2) {
  if (!prev || !prev2) return false;
  return (
    c.close > c.open && prev.close > prev.open && prev2.close > prev2.open &&
    c.close > prev.close && prev.close > prev2.close &&
    (c.close - c.open) < (prev.close - prev.open) * 1.5
  );
}

function isThreeBlackCrows(c, prev, prev2) {
  if (!prev || !prev2) return false;
  return (
    c.close < c.open && prev.close < prev.open && prev2.close < prev2.open &&
    c.close < prev.close && prev.close < prev2.close &&
    (c.open - c.close) < (prev.open - prev.close) * 1.5
  );
}

function isPiercing(c, prev) {
  if (!prev) return false;
  const prevRange = prev.open - prev.close;
  const closeInPrevBody = c.close > prev.close + prevRange * 0.5;
  return c.close > c.open && prev.close < prev.open && c.open < prev.close && closeInPrevBody && c.close < prev.open;
}

function isDarkCloudCover(c, prev) {
  if (!prev) return false;
  const prevRange = prev.close - prev.open;
  const closeInPrevBody = c.close < prev.open - prevRange * 0.5;
  return c.close < c.open && prev.close > prev.open && c.open > prev.close && closeInPrevBody && c.close > prev.open;
}

export function detectPatterns(candles) {
  if (!candles || candles.length < 3) return [];
  const patterns = [];
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];
    const time = c.time;

    if (isDoji(c)) patterns.push({ time, type: "doji", label: "Doji", color: "#6B7280" });
    if (isHammer(c, prev)) patterns.push({ time, type: "hammer", label: "Hammer", color: "#22C55E" });
    if (isHangingMan(c, prev)) patterns.push({ time, type: "hanging_man", label: "Hanging Man", color: "#EF4444" });
    if (isShootingStar(c, prev)) patterns.push({ time, type: "shooting_star", label: "Shooting Star", color: "#EF4444" });
    if (isBullishEngulfing(c, prev)) patterns.push({ time, type: "bullish_engulfing", label: "Bullish Engulfing", color: "#22C55E" });
    if (isBearishEngulfing(c, prev)) patterns.push({ time, type: "bearish_engulfing", label: "Bearish Engulfing", color: "#EF4444" });
    if (isBullishHarami(c, prev)) patterns.push({ time, type: "bullish_harami", label: "Bullish Harami", color: "#22C55E" });
    if (isBearishHarami(c, prev)) patterns.push({ time, type: "bearish_harami", label: "Bearish Harami", color: "#EF4444" });
    if (isMorningStar(c, prev, prev2)) patterns.push({ time, type: "morning_star", label: "Morning Star", color: "#22C55E" });
    if (isEveningStar(c, prev, prev2)) patterns.push({ time, type: "evening_star", label: "Evening Star", color: "#EF4444" });
    if (isThreeWhiteSoldiers(c, prev, prev2)) patterns.push({ time, type: "three_white_soldiers", label: "3 White Soldiers", color: "#22C55E" });
    if (isThreeBlackCrows(c, prev, prev2)) patterns.push({ time, type: "three_black_crows", label: "3 Black Crows", color: "#EF4444" });
    if (isPiercing(c, prev)) patterns.push({ time, type: "piercing", label: "Piercing Pattern", color: "#22C55E" });
    if (isDarkCloudCover(c, prev)) patterns.push({ time, type: "dark_cloud", label: "Dark Cloud Cover", color: "#EF4444" });
  }
  return patterns;
}
