import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";

// ── Create Alert ───────────────────────────────────────────────────────────

export async function createAlert(userId, { assetType, assetSymbol, direction, targetPrice }) {
  if (!["above", "below"].includes(direction)) {
    throw new Error("direction must be 'above' or 'below'");
  }
  if (!targetPrice || targetPrice <= 0) {
    throw new Error("positive targetPrice required");
  }

  return prisma.priceAlert.create({
    data: {
      userId,
      assetType,
      assetSymbol: assetSymbol.toUpperCase(),
      direction,
      targetPrice,
    },
  });
}

// ── List Alerts ────────────────────────────────────────────────────────────

export async function listAlerts(userId, includeTriggered = false) {
  const where = { userId };
  if (!includeTriggered) {
    where.triggered = false;
  }

  return prisma.priceAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

// ── Dismiss Alert ──────────────────────────────────────────────────────────

export async function dismissAlert(userId, alertId) {
  const alert = await prisma.priceAlert.findFirst({
    where: { id: alertId, userId },
  });
  if (!alert) throw new Error("Alert not found");

  return prisma.priceAlert.update({
    where: { id: alertId },
    data: { triggered: false, triggeredAt: null },
  });
}

// ── Delete Alert ───────────────────────────────────────────────────────────

export async function deleteAlert(userId, alertId) {
  const alert = await prisma.priceAlert.findFirst({
    where: { id: alertId, userId },
  });
  if (!alert) throw new Error("Alert not found");

  await prisma.priceAlert.delete({ where: { id: alertId } });
}

// ── Check Alert Condition ──────────────────────────────────────────────────
// Returns true if the alert's condition is met at the given price.

export function isAlertTriggered(alert, currentPrice) {
  if (!currentPrice || currentPrice <= 0) return false;

  if (alert.direction === "above") {
    return currentPrice >= Number(alert.targetPrice);
  }
  // direction === "below"
  return currentPrice <= Number(alert.targetPrice);
}

// ── Trigger Alert ──────────────────────────────────────────────────────────
// Marks the alert as triggered and returns its data for push notification.

export async function triggerAlert(alertId) {
  const [alert] = await prisma.$queryRaw`
    UPDATE price_alerts
    SET triggered = true, triggered_at = NOW()
    WHERE id = ${alertId}::uuid AND triggered = false
    RETURNING id, user_id, asset_type, asset_symbol, direction, target_price
  `;
  return alert || null;
}
