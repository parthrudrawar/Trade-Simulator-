import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { USE_MOCK_REDIS } from "../config/redis.js";
import { isAlertTriggered, triggerAlert } from "../services/alertService.js";
import { createBullRedis } from "../config/redis.js";
import Bull from "bull";

let alertQueue = null;
let mockInterval = null;

export async function startAlertMatcher() {
  if (USE_MOCK_REDIS) {
    console.log("[AlertMatcher] Starting mock mode (setInterval)");
    mockInterval = setInterval(async () => {
      try {
        await runAlertCheck({ fullScan: true });
      } catch (err) {
        console.error("[AlertMatcher] Mock scan error:", err.message);
      }
    }, 60000);
    console.log("[AlertMatcher] Started (mock). 60s fallback scan.");
    return;
  }

  // Real Bull-based implementation
  alertQueue = new Bull("alert-checking", {
    createClient: createBullRedis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });

  alertQueue.process(async (job) => {
    await runAlertCheck(job.data);
  });

  const repeatJobs = await alertQueue.getRepeatableJobs();
  for (const job of repeatJobs) {
    await alertQueue.removeRepeatableByKey(job.key);
  }

  await alertQueue.add(
    { fullScan: true },
    {
      repeat: { every: 60000 },
      jobId: "alert-matcher-fallback",
    }
  );

  console.log("[AlertMatcher] Started. Event-driven + 60s fallback scan.");
}

async function runAlertCheck(data) {
  let alerts;
  if (data.fullScan) {
    alerts = await prisma.priceAlert.findMany({
      where: { triggered: false },
      orderBy: { createdAt: "asc" },
    });
  } else {
    const { assetType, symbol } = data;
    alerts = await prisma.priceAlert.findMany({
      where: { assetType, assetSymbol: symbol, triggered: false },
      orderBy: { createdAt: "asc" },
    });
  }

  if (alerts.length === 0) return;

  const bySymbol = {};
  for (const a of alerts) {
    const key = `${a.assetType}:${a.assetSymbol}`;
    if (!bySymbol[key]) bySymbol[key] = [];
    bySymbol[key].push(a);
  }

  for (const [key, symbolAlerts] of Object.entries(bySymbol)) {
    const [assetType, symbol] = key.split(":");
    const priceData = await redis.get(`price:${assetType}:${symbol}`);
    if (!priceData) continue;

    const { price } = JSON.parse(priceData);

    for (const alert of symbolAlerts) {
      if (isAlertTriggered(alert, price)) {
        const triggered = await triggerAlert(alert.id);
        if (triggered) {
          console.log(
            `[AlertMatcher] Triggered ${alert.id}: ${alert.assetSymbol} ${alert.direction} ${alert.targetPrice} (current: ${price})`
          );
        }
      }
    }
  }
}

export async function queueAlertCheck(assetType, symbol) {
  if (alertQueue) {
    await alertQueue.add(
      { assetType, symbol: symbol.toUpperCase() },
      {
        jobId: `alert-check:${assetType}:${symbol.toUpperCase()}`,
      }
    );
  }
  // In mock mode, trigger immediate check
  if (USE_MOCK_REDIS) {
    runAlertCheck({ assetType, symbol: symbol.toUpperCase() }).catch(() => {});
  }
}

export async function stopAlertMatcher() {
  if (alertQueue) await alertQueue.close();
  if (mockInterval) clearInterval(mockInterval);
}