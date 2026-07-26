import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

// ── Caching Strategy ───────────────────────────────────────────────────────
//
// DECISION: Compute on-the-fly with a 30-second Redis cache.
//
// Why NOT precompute:
//   Precomputing means updating cached values after every trade fill AND every
//   price tick (since portfolio value changes with price). Price ticks happen
//   every 10 seconds for active symbols — we'd be recomputing analytics 6 times
//   per minute per user, even if no one is viewing the dashboard. That's wasted
//   CPU for data nobody reads.
//
// Why NOT fully on-the-fly (no cache):
//   The P&L history query scans the orders table (hundreds of rows per user).
//   If the user refreshes the dashboard 5 times in 10 seconds, each refresh runs
//   the same scan. A 30-second cache absorbs these bursts.
//
// Why 30 seconds is the sweet spot:
//   - Short enough that users see fresh data within the session
//   - Long enough to absorb rapid refreshes (CTRL+R spam)
//   - After a trade fill, the maximum staleness is 30 seconds
//   - Price changes are reflected at most 30 seconds late (positions' current_price
//     is updated by the poller every 10 seconds, but analytics cache lags behind)
//
// Tradeoff accepted: after a trade fill, the dashboard may be stale for up to
// 30 seconds. For a paper trading platform, this is acceptable — no real money
// is at risk from a 30-second delay.

const CACHE_TTL = 30;

async function cached(key, computeFn) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const result = await computeFn();
  await redis.setex(key, CACHE_TTL, JSON.stringify(result));
  return result;
}

function cacheKey(userId, metric) {
  return `analytics:${userId}:${metric}`;
}

// ── 1. Portfolio Summary ──────────────────────────────────────────────────
// Current snapshot: cash, positions value, total P&L, day change.

export async function getPortfolioSummary(userId) {
  return cached(cacheKey(userId, "summary"), async () => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        portfolio: { include: { balances: true } },
        positions: true,
      },
    });

    if (!user?.portfolio) return null;

    // Initial deposit (configured in env, stored as constant for calculation)
    const initialInr = Number(process.env.DEFAULT_INR_BALANCE) || 1_000_000;
    const initialUsd = Number(process.env.DEFAULT_USD_BALANCE) || 0;
    const initialTotal = initialInr + initialUsd * 83; // approximate USD→INR for display

    // Current cash in INR (keep an approximate total for dashboard display)
    let currentCash = 0;
    let inrCash = 0;
    let usdCash = 0;
    for (const b of user.portfolio.balances) {
      const amt = Number(b.cashBalance);
      if (b.currency === "INR") { currentCash += amt; inrCash = amt; }
      if (b.currency === "USD") { currentCash += amt * 83; usdCash = amt; }
    }

    // Positions value
    let positionsValue = 0;
    let positionsCost = 0;
    let totalQty = 0;
    const positionDetails = [];

    for (const pos of user.positions) {
      const qty = Number(pos.quantity);
      const price = Number(pos.currentPrice || 0);
      const avgCost = Number(pos.avgBuyPrice || 0);
      const posValue = qty * price;
      const posCost = qty * avgCost;

      positionsValue += posValue;
      positionsCost += posCost;
      totalQty += qty;

      if (qty > 0) {
        positionDetails.push({
          assetType: pos.assetType,
          symbol: pos.assetSymbol,
          quantity: qty,
          currentPrice: price,
          avgBuyPrice: avgCost,
          value: posValue,
          pnl: posValue - posCost,
          pnlPercent: posCost > 0 ? ((posValue - posCost) / posCost * 100) : 0,
        });
      }
    }

    const totalValue = currentCash + positionsValue;
    const totalPnl = totalValue - initialTotal;
    const totalInvested = positionsCost + (currentCash - inrCash - usdCash * 83);

    return {
      cash: { inr: inrCash, usd: usdCash, totalInr: currentCash },
      positions: {
        count: positionDetails.length,
        totalQty,
        value: positionsValue,
        cost: positionsCost,
      },
      portfolio: {
        totalValue,
        totalInvested,
        totalPnl,
        totalPnlPercent: initialTotal > 0 ? (totalPnl / initialTotal * 100) : 0,
      },
      positions: positionDetails,
    };
  });
}

// ── 2. P&L History ────────────────────────────────────────────────────────
// Daily P&L computed from realized fills. Returns an array of { date, pnl }
// for the requested period.

export async function getPnLHistory(userId, period = "all") {
  return cached(cacheKey(userId, `pnl:${period}`), async () => {
    // Determine date range
    const now = new Date();
    let since;
    switch (period) {
      case "1d": since = new Date(now - 86400000); break;
      case "1w": since = new Date(now - 7 * 86400000); break;
      case "1m": since = new Date(now - 30 * 86400000); break;
      case "3m": since = new Date(now - 90 * 86400000); break;
      case "1y": since = new Date(now - 365 * 86400000); break;
      default: since = new Date(0); break; // all-time
    }

    // Get all filled orders in the range
    const fills = await prisma.order.findMany({
      where: {
        userId,
        status: "filled",
        createdAt: { gte: since },
      },
      select: {
        side: true,
        filledQuantity: true,
        avgFillPrice: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Group by day and compute net P&L
    // Realized P&L per sell = sell_value - buy_cost (estimated via average cost)
    // For simplicity: daily P&L = sell_credit - buy_cost for fills that day
    const daily = {};
    for (const f of fills) {
      const day = f.createdAt.toISOString().slice(0, 10); // "2026-07-24"
      if (!daily[day]) daily[day] = { date: day, buyCost: 0, sellCredit: 0, tradeCount: 0 };

      const amount = Number(f.filledQuantity) * Number(f.avgFillPrice || 0);
      daily[day].tradeCount += 1;

      if (f.side === "buy") {
        daily[day].buyCost += amount;
      } else {
        daily[day].sellCredit += amount;
      }
    }

    // Build cumulative P&L over time
    let cumulativePnl = 0;
    const history = Object.values(daily)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        const dayPnl = d.sellCredit - d.buyCost;
        cumulativePnl += dayPnl;
        return {
          date: d.date,
          pnl: Math.round(dayPnl * 100) / 100,
          cumulativePnl: Math.round(cumulativePnl * 100) / 100,
          tradeCount: d.tradeCount,
        };
      });

    return {
      period,
      from: since.toISOString(),
      to: now.toISOString(),
      totalPnl: history.length > 0 ? history[history.length - 1].cumulativePnl : 0,
      history,
    };
  });
}

// ── 3. Win Rate ───────────────────────────────────────────────────────────
// Percentage of profitable closed trades vs total closed trades.
// A "trade" is defined as a fully closed position (buy→sell pair).
// For MVP, we approximate: a sell order where sell_credit > buy_cost of
// the corresponding position.

export async function getWinRate(userId) {
  return cached(cacheKey(userId, "winrate"), async () => {
    // Get all filled sell orders (exits)
    const sells = await prisma.order.findMany({
      where: { userId, side: "sell", status: "filled" },
      select: { filledQuantity: true, avgFillPrice: true },
    });

    // Get all filled buy orders (entries)
    const buys = await prisma.order.findMany({
      where: { userId, side: "buy", status: "filled" },
      select: { filledQuantity: true, avgFillPrice: true },
    });

    // Match buys and sells by FIFO approximation
    // For MVP: compare total sell value vs total buy value
    let totalBuyCost = 0;
    let totalBuyQty = 0;
    for (const b of buys) {
      totalBuyCost += Number(b.filledQuantity) * Number(b.avgFillPrice || 0);
      totalBuyQty += Number(b.filledQuantity);
    }

    let totalSellCredit = 0;
    let totalSellQty = 0;
    let profitableTrades = 0;
    let losingTrades = 0;

    for (const s of sells) {
      const qty = Number(s.filledQuantity);
      const price = Number(s.avgFillPrice || 0);
      totalSellCredit += qty * price;
      totalSellQty += qty;

      // Estimate if this sell was profitable: compare to average buy price
      // (This is a simplification — proper FIFO/LIFO matching would need
      //  a more complex allocation algorithm)
      const avgBuy = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;
      if (avgBuy > 0) {
        if (price >= avgBuy) {
          profitableTrades += qty;
        } else {
          losingTrades += qty;
        }
      }
    }

    const totalClosed = profitableTrades + losingTrades;
    const winRate = totalClosed > 0 ? (profitableTrades / totalClosed * 100) : 0;

    return {
      totalTrades: totalClosed,
      profitableTrades,
      losingTrades,
      winRate: Math.round(winRate * 100) / 100,
      note: "Win rate estimated via average cost comparison. Does not account for FIFO matching.",
    };
  });
}

// ── 4. Best / Worst Assets ────────────────────────────────────────────────
// Rank positions by P&L contribution.

export async function getBestWorstAssets(userId) {
  return cached(cacheKey(userId, "bestworst"), async () => {
    const positions = await prisma.position.findMany({
      where: { userId, quantity: { gt: 0 } },
    });

    const results = [];
    for (const pos of positions) {
      const qty = Number(pos.quantity);
      const price = Number(pos.currentPrice || 0);
      const avgCost = Number(pos.avgBuyPrice || 0);
      const pnl = qty * (price - avgCost);
      const pnlPercent = avgCost > 0 ? ((price - avgCost) / avgCost * 100) : 0;

      results.push({
        assetType: pos.assetType,
        symbol: pos.assetSymbol,
        quantity: qty,
        currentPrice: price,
        avgBuyPrice: avgCost,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
      });
    }

    results.sort((a, b) => b.pnl - a.pnl);

    return {
      best: results.slice(0, 5),
      worst: results.slice(-5).reverse(),
      all: results,
    };
  });
}

// ── 5. Sector Allocation ──────────────────────────────────────────────────
// For MVP: groups by asset_type (stock vs crypto) since we don't have a
// symbol→sector mapping table. A production version would join against a
// reference table like `sectors(symbol, sector_name)`.

export async function getSectorAllocation(userId) {
  return cached(cacheKey(userId, "sectors"), async () => {
    const positions = await prisma.position.findMany({
      where: { userId, quantity: { gt: 0 } },
    });

    const byType = { stock: 0, crypto: 0 };
    const bySymbol = {};

    for (const pos of positions) {
      const qty = Number(pos.quantity);
      const price = Number(pos.currentPrice || 0);
      const value = qty * price;

      byType[pos.assetType] = (byType[pos.assetType] || 0) + value;
      bySymbol[pos.assetSymbol] = (bySymbol[pos.assetSymbol] || 0) + value;
    }

    const totalValue = Object.values(byType).reduce((a, b) => a + b, 0);

    return {
      byType: Object.entries(byType).map(([type, value]) => ({
        type,
        value: Math.round(value * 100) / 100,
        percentage: totalValue > 0 ? Math.round((value / totalValue) * 10000) / 100 : 0,
      })),
      bySymbol: Object.entries(bySymbol)
        .map(([symbol, value]) => ({
          symbol,
          value: Math.round(value * 100) / 100,
          percentage: totalValue > 0 ? Math.round((value / totalValue) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.value - a.value),
      totalValue: Math.round(totalValue * 100) / 100,
    };
  });
}

// ── 6. Average Holding Period ─────────────────────────────────────────────
// Average number of days between first buy and last sell for closed positions.
// For MVP: computes from matched buy→sell pairs by symbol.

export async function getAvgHoldingPeriod(userId) {
  return cached(cacheKey(userId, "holding"), async () => {
    // Get all filled orders grouped by symbol
    const fills = await prisma.order.findMany({
      where: { userId, status: "filled" },
      select: {
        assetType: true, assetSymbol: true, side: true,
        filledQuantity: true, avgFillPrice: true, createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Group buys and sells by symbol
    const bySymbol = {};
    for (const f of fills) {
      const key = `${f.assetType}:${f.assetSymbol}`;
      if (!bySymbol[key]) bySymbol[key] = { buys: [], sells: [] };
      if (f.side === "buy") bySymbol[key].buys.push(f);
      else bySymbol[key].sells.push(f);
    }

    // For each symbol, match sells to buys (FIFO) and compute holding period
    const holdingPeriods = [];
    for (const [key, { buys, sells }] of Object.entries(bySymbol)) {
      if (sells.length === 0) continue;

      // Approximate: use the first buy and last sell dates for this symbol
      // (A real implementation would match individual lots)
      for (const sell of sells) {
        // Find the earliest buy that has enough remaining quantity
        // For MVP: simply pair with the first buy
        if (buys.length > 0) {
          const buyDate = new Date(buys[0].createdAt);
          const sellDate = new Date(sell.createdAt);
          const days = (sellDate - buyDate) / 86400000;
          if (days > 0) {
            holdingPeriods.push({
              symbol: key,
              days: Math.round(days * 10) / 10,
              buyDate: buyDate.toISOString(),
              sellDate: sellDate.toISOString(),
            });
          }
        }
      }
    }

    const avgDays = holdingPeriods.length > 0
      ? holdingPeriods.reduce((s, h) => s + h.days, 0) / holdingPeriods.length
      : 0;

    return {
      averageDays: Math.round(avgDays * 10) / 10,
      totalClosedTrades: holdingPeriods.length,
      bySymbol: holdingPeriods.sort((a, b) => b.days - a.days).slice(0, 20),
      note: "Holding period estimated from first buy → last sell per symbol. Does not reflect partial lot matching.",
    };
  });
}

// ── 7. Volatility (Simplified) ────────────────────────────────────────────
// Annualized standard deviation of daily portfolio returns.
// Approximated from P&L history: each day's "return" is the day's P&L divided
// by the running portfolio value.

export async function getVolatility(userId) {
  return cached(cacheKey(userId, "volatility"), async () => {
    const pnlData = await getPnLHistory(userId, "1y");
    const history = pnlData.history;

    if (history.length < 2) {
      return { annualizedVolatility: 0, dailyVolatility: 0, dailyReturns: [], note: "Insufficient trade history" };
    }

    // Compute daily returns from P&L
    const dailyReturns = [];
    for (let i = 1; i < history.length; i++) {
      const prevValue = 1_000_000 + history[i - 1].cumulativePnl; // approximate base
      const dayReturn = prevValue > 0 ? history[i].pnl / prevValue : 0;
      dailyReturns.push(dayReturn);
    }

    // Standard deviation of daily returns
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
    const dailyVol = Math.sqrt(variance);
    const annualizedVol = dailyVol * Math.sqrt(252); // 252 trading days/year

    return {
      dailyVolatility: Math.round(dailyVol * 10000) / 10000,
      annualizedVolatility: Math.round(annualizedVol * 10000) / 10000,
      sampleSize: dailyReturns.length,
      note: "Volatility computed from daily realized P&L. Does not include unrealized changes from open positions.",
    };
  });
}

// ── 8. Sharpe Ratio (Simplified) ──────────────────────────────────────────
// (Portfolio Return - Risk-Free Rate) / Portfolio Volatility
// Annualized.

export async function getSharpeRatio(userId) {
  return cached(cacheKey(userId, "sharpe"), async () => {
    const volData = await getVolatility(userId);
    const pnlData = await getPnLHistory(userId, "1y");
    const history = pnlData.history;

    if (volData.annualizedVolatility === 0 || history.length < 2) {
      return { sharpeRatio: 0, note: "Insufficient data for Sharpe calculation" };
    }

    // Portfolio return over the period
    const startingValue = 1_000_000; // initial deposit
    const endingPnl = history[history.length - 1]?.cumulativePnl || 0;
    const portfolioReturn = startingValue > 0 ? endingPnl / startingValue : 0;

    // Annualize the return
    const days = history.length;
    const annualizedReturn = (1 + portfolioReturn) ** (252 / days) - 1;

    // Risk-free rate: 6% annual (approximate Indian risk-free rate)
    const riskFreeRate = 0.06;

    const sharpe = volData.annualizedVolatility > 0
      ? (annualizedReturn - riskFreeRate) / volData.annualizedVolatility
      : 0;

    return {
      sharpeRatio: Math.round(sharpe * 100) / 100,
      annualizedReturn: Math.round(annualizedReturn * 10000) / 100,
      annualizedVolatility: volData.annualizedVolatility,
      riskFreeRate: riskFreeRate,
      sampleSize: volData.sampleSize,
      note: "Simplified Sharpe using risk-free rate of 6%. Returns annualized over 252 trading days.",
    };
  });
}

// ── Aggregate Dashboard ───────────────────────────────────────────────────
// Returns all metrics in one call to minimize round-trips.

export async function getDashboard(userId) {
  const [summary, pnl, winRate, bestWorst, sectorAlloc, holdingPeriod, volatility, sharpe] =
    await Promise.all([
      getPortfolioSummary(userId),
      getPnLHistory(userId, "all"),
      getWinRate(userId),
      getBestWorstAssets(userId),
      getSectorAllocation(userId),
      getAvgHoldingPeriod(userId),
      getVolatility(userId),
      getSharpeRatio(userId),
    ]);

  return {
    summary,
    pnl,
    winRate,
    bestWorst,
    sectorAllocation: sectorAlloc,
    averageHoldingPeriod: holdingPeriod,
    volatility,
    sharpeRatio: sharpe,
  };
}
