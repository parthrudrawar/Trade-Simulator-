import Bull from "bull";
import { redis, createBullRedis } from "../config/redis.js";
import { getProvider, RateLimitError } from "../config/marketDataProviders.js";
import { discoverActiveSymbols, updatePriceCache } from "../services/marketDataService.js";
import { USE_MOCK_REDIS } from "../config/redis.js";

const POLL_INTERVAL_MS = 10000;

let pricePollQueue = null;
let mockPollInterval = null;

export async function startPricePoller() {
  if (USE_MOCK_REDIS) {
    // Simple setInterval-based poller for mock mode (Bull doesn't work with ioredis-mock)
    console.log("[PricePoller] Starting mock mode poller (setInterval)");
    mockPollInterval = setInterval(async () => {
      try {
        const active = await discoverActiveSymbols();
        if (active.stock.size > 0) {
          await pollAssetType("stock", [...active.stock]);
        }
        if (active.crypto.size > 0) {
          await pollAssetType("crypto", [...active.crypto]);
        }
      } catch (err) {
        console.error("[PricePoller] Mock poll failed:", err.message);
      }
    }, POLL_INTERVAL_MS);
    console.log(`Price poller started (mock): every ${POLL_INTERVAL_MS / 1000}s`);
    return;
  }

  // Real Bull-based poller for production
  pricePollQueue = new Bull("price-poll", {
    createClient: () => createBullRedis(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: 100,
    },
  });

  pricePollQueue.process(async () => {
    try {
      const active = await discoverActiveSymbols();
      const promises = [];
      if (active.stock.size > 0) {
        promises.push(pollAssetType("stock", [...active.stock]));
      }
      if (active.crypto.size > 0) {
        promises.push(pollAssetType("crypto", [...active.crypto]));
      }
      await Promise.allSettled(promises);
    } catch (err) {
      console.error("[PricePoller] Discovery failed:", err.message);
    }
  });

  const repeatJobs = await pricePollQueue.getRepeatableJobs();
  for (const job of repeatJobs) {
    await pricePollQueue.removeRepeatableByKey(job.key);
  }

  await pricePollQueue.add(
    {},
    {
      repeat: { every: POLL_INTERVAL_MS },
      jobId: "price-poller-repeat",
    }
  );

  console.log(`Price poller started: every ${POLL_INTERVAL_MS / 1000}s`);
}

async function pollAssetType(assetType, symbols) {
  try {
    const provider = getProvider(assetType);
    const prices = await provider.fetchPrices(symbols);
    const updatePromises = [];
    for (const [symbol, data] of prices) {
      updatePromises.push(updatePriceCache(assetType, symbol, data));
    }
    await Promise.allSettled(updatePromises);
    const returned = new Set(prices.keys());
    const missing = symbols.filter((s) => !returned.has(s));
    if (missing.length > 0) {
      console.warn(`[PricePoller] ${assetType}: no data for ${missing.join(", ")}`);
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.warn(
        `[PricePoller] ${assetType}: ${err.message}. Retry in ${err.retryAfterSeconds}s.`
      );
      return;
    }
    console.error(`[PricePoller] ${assetType} fetch failed:`, err.message);
  }
}

export async function stopPricePoller() {
  if (mockPollInterval) {
    clearInterval(mockPollInterval);
    mockPollInterval = null;
  }
  if (pricePollQueue) await pricePollQueue.close();
}

export async function triggerImmediatePoll() {
  if (USE_MOCK_REDIS) {
    // Run immediately in mock mode
    const active = await discoverActiveSymbols();
    if (active.stock.size > 0) await pollAssetType("stock", [...active.stock]);
    if (active.crypto.size > 0) await pollAssetType("crypto", [...active.crypto]);
    return;
  }
  if (pricePollQueue) await pricePollQueue.add({}, { jobId: `manual-${Date.now()}` });
}