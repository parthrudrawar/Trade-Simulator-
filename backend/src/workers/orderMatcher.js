import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { USE_MOCK_REDIS } from "../config/redis.js";
import { createBullRedis } from "../config/redis.js";
import { shouldExecute, executeFill } from "../services/orderExecutionService.js";
import Bull from "bull";

let orderMatchingQueue = null;
let mockInterval = null;

export async function startOrderMatcher() {
  if (USE_MOCK_REDIS) {
    // Simple setInterval-based matcher for mock mode
    console.log("[OrderMatcher] Starting mock mode (setInterval)");
    mockInterval = setInterval(async () => {
      try {
        await runOrderMatching({ fullScan: true });
      } catch (err) {
        console.error("[OrderMatcher] Mock scan error:", err.message);
      }
    }, 60000);
    console.log("[OrderMatcher] Started (mock). 60s fallback scan.");
    return;
  }

  // Real Bull-based implementation
  orderMatchingQueue = new Bull("order-matching", {
    createClient: createBullRedis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  });

  orderMatchingQueue.process(async (job) => {
    await runOrderMatching(job.data);
  });

  const repeatJobs = await orderMatchingQueue.getRepeatableJobs();
  for (const job of repeatJobs) {
    await orderMatchingQueue.removeRepeatableByKey(job.key);
  }

  await orderMatchingQueue.add(
    { fullScan: true },
    {
      repeat: { every: 60000 },
      jobId: "order-matcher-fallback",
      priority: 1,
    }
  );

  console.log("[OrderMatcher] Started. Event-driven + 60s fallback scan.");
}

async function runOrderMatching(data) {
  let orders;
  if (data.fullScan) {
    orders = await prisma.order.findMany({
      where: {
        status: { in: ["pending", "open"] },
        orderType: { in: ["limit", "stop_loss"] },
        parentOrderId: null,
      },
      orderBy: { createdAt: "asc" },
    });
  } else {
    const { assetType, symbol } = data;
    orders = await prisma.order.findMany({
      where: {
        assetType,
        assetSymbol: symbol,
        status: { in: ["pending", "open"] },
        orderType: { in: ["limit", "stop_loss"] },
        parentOrderId: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  if (orders.length === 0) return;

  for (const order of orders) {
    const currentPrice = await getCachedPrice(order.assetType, order.assetSymbol);
    if (currentPrice === null) continue;

    if (shouldExecute(order, currentPrice)) {
      try {
        await executeFill(order.userId, {
          side: order.side,
          assetType: order.assetType,
          assetSymbol: order.assetSymbol,
          quantity: Number(order.quantity),
          price: currentPrice,
          orderType: order.orderType,
          parentOrderId: order.parentOrderId || undefined,
        }, order.id);

        await armBracketChildren(order.id);
        console.log(`[OrderMatcher] Filled ${order.id} (${order.side} ${order.assetSymbol} @ ${currentPrice})`);
      } catch (err) {
        console.warn(`[OrderMatcher] Fill failed for ${order.id}: ${err.message}`);
      }
    }
  }
}

export async function queueOrderCheck(assetType, symbol) {
  if (orderMatchingQueue) {
    await orderMatchingQueue.add(
      { assetType, symbol: symbol.toUpperCase() },
      {
        jobId: `order-match:${assetType}:${symbol.toUpperCase()}`,
        priority: 2,
      }
    );
  }
  // In mock mode, trigger immediate check
  if (USE_MOCK_REDIS) {
    runOrderMatching({ assetType, symbol: symbol.toUpperCase() }).catch(() => {});
  }
}

async function getCachedPrice(assetType, symbol) {
  const key = `price:${assetType}:${symbol}`;
  const cached = await redis.get(key);
  if (!cached) return null;
  const { price } = JSON.parse(cached);
  return price;
}

async function armBracketChildren(parentOrderId) {
  await prisma.order.updateMany({
    where: { parentOrderId, status: "pending" },
    data: { status: "open" },
  });
}

export async function cancelSiblingOrder(filledChildId) {
  const child = await prisma.order.findUnique({
    where: { id: filledChildId },
    select: { parentOrderId: true },
  });

  if (!child?.parentOrderId) return;

  const sibling = await prisma.order.findFirst({
    where: {
      parentOrderId: child.parentOrderId,
      id: { not: filledChildId },
      status: { in: ["pending", "open"] },
    },
  });

  if (sibling) {
    await prisma.order.update({
      where: { id: sibling.id },
      data: { status: "cancelled" },
    });
  }
}

export async function stopOrderMatcher() {
  if (orderMatchingQueue) await orderMatchingQueue.close();
  if (mockInterval) clearInterval(mockInterval);
}