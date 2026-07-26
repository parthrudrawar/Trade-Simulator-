import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { getProvider } from "../config/marketDataProviders.js";

// ── Currency Mapping ───────────────────────────────────────────────────────
// Stocks trade in INR, crypto in USD. This mapping is used for all cash
// operations. If we add more asset types later, extend this map.

const CURRENCY_MAP = { stock: "INR", crypto: "USD" };

function currencyFor(assetType) {
  return CURRENCY_MAP[assetType] || "INR";
}

// ── Synchronous Market Order Execution ─────────────────────────────────────
//
// Market orders execute IMMEDIATELY at the current cached price. The entire
// operation is wrapped in a Prisma $transaction for atomicity.
//
// WHY THIS MUST BE TRANSACTIONAL:
// If the process crashes halfway through a market order:
//
//   Scenario A: Cash deducted, position NOT updated
//     → User lost money but has no position. The cash is gone.
//     → Support ticket: "I paid for RELIANCE but I don't own it."
//
//   Scenario B: Position updated, cash NOT deducted
//     → User got free shares. The platform lost money.
//     → Exploit: crash the server after the position UPSERT but before the
//       cash deduction to mint free shares.
//
//   Scenario C: Order row created with status "filled" but cash/position
//     not updated
//     → Trade history shows a fill that financially never happened.
//     → Portfolio analytics, P&L calculations, and tax reports all wrong.
//
// A database transaction ensures ALL THREE operations (cash → position → order)
// succeed or ALL roll back. PostgreSQL's WAL (Write-Ahead Log) guarantees
// durability even if the power fails mid-commit.

export async function executeMarketOrder(userId, orderInput) {
  const { side, assetType, assetSymbol, quantity } = orderInput;

  // Get current price from Redis cache
  const cacheKey = `price:${assetType}:${assetSymbol.toUpperCase()}`;
  const cached = await redis.get(cacheKey);
  if (!cached) {
    // Fallback: fetch fresh from provider (shouldn't happen if poller is running)
    try {
      const provider = getProvider(assetType);
      const data = await provider.fetchPrice(assetSymbol.toUpperCase());
      await redis.setex(cacheKey, 60, JSON.stringify({
        price: data.price, change: data.change,
        changePercent: data.changePercent, timestamp: data.timestamp,
        provider: data.provider,
      }));
      return executeFill(userId, { ...orderInput, price: data.price, orderType: "market" });
    } catch {
      throw new Error("Price unavailable for " + assetSymbol);
    }
  }

  const { price } = JSON.parse(cached);
  return executeFill(userId, { ...orderInput, price, orderType: "market" });
}

// ── Core Fill Logic ────────────────────────────────────────────────────────
//
// This is the CENTRAL function that every order type (market, limit, stop-loss,
// bracket) eventually calls to record a fill. It handles:
//   1. Cash deduction/credit (atomic check-and-update)
//   2. Position UPSERT (buy) or decrement (sell)
//   3. Order status update
//
// CONCURRENCY STRATEGY:
// We use PESSIMISTIC ROW LOCKING via SELECT FOR UPDATE.
//
// Two orders competing for the same cash (buy) or same position (sell):
//
//   Transaction A (buy RELIANCE ₹60,000):
//     UPDATE portfolio_balances SET cash = cash - 60000 WHERE id = X AND cash >= 60000
//     → PostgreSQL acquires ROW EXCLUSIVE lock on portfolio_balances row X
//     → If cash was ₹100,000, it's now ₹40,000. Row updated.
//
//   Transaction B (buy TCS ₹50,000, arrives concurrently):
//     UPDATE portfolio_balances SET cash = cash - 50000 WHERE id = X AND cash >= 50000
//     → PostgreSQL queues this behind Transaction A's lock
//     → When A commits, B reads the NEW cash balance (₹40,000)
//     → ₹40,000 < ₹50,000 → condition fails → 0 rows updated → "insufficient cash"
//
// Why pessimistic locking (not optimistic)?
//   - Optimistic locking with version numbers would cause transaction B to fail
//     and retry, but on retry it would still see insufficient cash.
//   - For portfolio operations, contention is high (many orders hit the same
//     cash balance row) and retries are expensive (DB round-trip + wasted work).
//   - PostgreSQL's row-level locks are cheap (~100 bytes per locked row) and
//     deadlock detection handles the rare circular-wait case.
//
// For sells, we use SELECT FOR UPDATE on the position row to prevent two
// concurrent sells from overselling the same position.

export async function executeFill(userId, { side, assetType, assetSymbol, quantity, price, orderType, parentOrderId }) {
  const currency = currencyFor(assetType);
  const total = Number((price * quantity).toFixed(2));

  return prisma.$transaction(async (tx) => {
    // Get portfolio + balance inside the transaction (FOR UPDATE locks the row)
    const [balance] = await tx.$queryRaw`
      SELECT pb.id, pb.cash_balance
      FROM portfolios p
      JOIN portfolio_balances pb ON pb.portfolio_id = p.id
      WHERE p.user_id = ${userId}::uuid AND pb.currency = ${currency}
      FOR UPDATE OF pb
    `;

    if (!balance) {
      throw new Error("Portfolio or balance not found");
    }

    if (side === "buy") {
      // Atomic check-and-deduct: UPDATE ... WHERE cash_balance >= amount
      // PostgreSQL's UPDATE acquires a row lock. If two transactions try to
      // deduct from the same balance simultaneously, the second waits for the
      // first to commit, then sees the updated balance.
      const [updated] = await tx.$queryRaw`
        UPDATE portfolio_balances
        SET cash_balance = ROUND((cash_balance - ${total})::numeric, 2)
        WHERE id = ${balance.id}::uuid AND cash_balance >= ${total}
        RETURNING cash_balance
      `;

      if (!updated) {
        throw new Error("Insufficient cash balance");
      }

      // UPSERT position: create or update
      await tx.$executeRaw`
        INSERT INTO positions (id, user_id, asset_type, asset_symbol, quantity, avg_buy_price, current_price, created_at, updated_at)
        VALUES (gen_random_uuid(), ${userId}::uuid, ${assetType}, ${assetSymbol}, ${quantity}, ${price}, ${price}, NOW(), NOW())
        ON CONFLICT (user_id, asset_type, asset_symbol) DO UPDATE SET
          quantity = ROUND((positions.quantity + ${quantity})::numeric, 8),
          avg_buy_price = ROUND(
            ((COALESCE(positions.avg_buy_price, 0) * positions.quantity + ${price} * ${quantity})
             / (positions.quantity + ${quantity}))::numeric, 4
          ),
          current_price = ${price},
          updated_at = NOW()
      `;
    } else { // sell
      // Lock the position row to prevent concurrent sells from overselling
      const [position] = await tx.$queryRaw`
        SELECT quantity FROM positions
        WHERE user_id = ${userId}::uuid AND asset_type = ${assetType} AND asset_symbol = ${assetSymbol}
        FOR UPDATE
      `;

      if (!position || Number(position.quantity) < quantity) {
        throw new Error("Insufficient position quantity");
      }

      // Decrement position
      await tx.$executeRaw`
        UPDATE positions
        SET quantity = ROUND((quantity - ${quantity})::numeric, 8)
        WHERE user_id = ${userId}::uuid AND asset_type = ${assetType} AND asset_symbol = ${assetSymbol}
      `;

      // Credit cash
      await tx.$executeRaw`
        UPDATE portfolio_balances
        SET cash_balance = ROUND((cash_balance + ${total})::numeric, 2)
        WHERE id = ${balance.id}::uuid
      `;
    }

    // Create the order record with status "filled"
    const [order] = await tx.$queryRaw`
      INSERT INTO orders (id, user_id, side, order_type, asset_type, asset_symbol,
                          quantity, price, status, filled_quantity, avg_fill_price,
                          parent_order_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${side}::order_side, ${orderType}::order_type,
              ${assetType}, ${assetSymbol}, ${quantity}, ${price},
              'filled'::order_status, ${quantity}, ${price},
              ${parentOrderId}::uuid, NOW(), NOW())
      RETURNING id, side, order_type, asset_type, asset_symbol, quantity,
                price, status, filled_quantity, avg_fill_price, created_at
    `;

    return order;
  });
}

// ── Async Order Creation (Limit / Stop-Loss / Bracket) ─────────────────────
//
// These do NOT execute immediately. They create a row with status "pending"
// and rely on the order matcher worker to pick them up when the market price
// reaches the trigger condition.

export async function createLimitOrder(userId, { side, assetType, assetSymbol, quantity, price }) {
  const order = await prisma.order.create({
    data: {
      userId, side, orderType: "limit",
      assetType, assetSymbol: assetSymbol.toUpperCase(),
      quantity, price,
      status: "pending",
    },
  });
  return order;
}

export async function createStopLossOrder(userId, { side, assetType, assetSymbol, quantity, stopPrice }) {
  const order = await prisma.order.create({
    data: {
      userId, side, orderType: "stop_loss",
      assetType, assetSymbol: assetSymbol.toUpperCase(),
      quantity, stopPrice,
      status: "pending",
    },
  });
  return order;
}

export async function createBracketOrder(userId, { side, assetType, assetSymbol, entryPrice, quantity, targetPrice, stopPrice }) {
  return prisma.$transaction(async (tx) => {
    // 1. Create the parent bracket order (entry leg)
    const [parent] = await tx.$queryRaw`
      INSERT INTO orders (id, user_id, side, order_type, asset_type, asset_symbol,
                          quantity, price, status, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${side}::order_side, 'bracket'::order_type,
              ${assetType}, ${assetSymbol}, ${quantity}, ${entryPrice},
              'pending'::order_status, NOW(), NOW())
      RETURNING id
    `;

    // 2. Create child: target (limit sell if entry was buy, or vice versa)
    const targetSide = side === "buy" ? "sell" : "buy";
    await tx.$executeRaw`
      INSERT INTO orders (id, user_id, parent_order_id, side, order_type, asset_type,
                          asset_symbol, quantity, price, status, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${parent.id}::uuid, ${targetSide}::order_side,
              'limit'::order_type, ${assetType}, ${assetSymbol}, ${quantity}, ${targetPrice},
              'pending'::order_status, NOW(), NOW())
    `;

    // 3. Create child: stop-loss
    const stopSide = side === "buy" ? "sell" : "buy";
    await tx.$executeRaw`
      INSERT INTO orders (id, user_id, parent_order_id, side, order_type, asset_type,
                          asset_symbol, quantity, stop_price, status, created_at, updated_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${parent.id}::uuid, ${stopSide}::order_side,
              'stop_loss'::order_type, ${assetType}, ${assetSymbol}, ${quantity}, ${stopPrice},
              'pending'::order_status, NOW(), NOW())
    `;

    return parent;
  });
}

// ── Condition Checking ─────────────────────────────────────────────────────
//
// Determines whether a pending order's trigger condition is met at the
// current market price.

export function shouldExecute(order, currentPrice) {
  if (!currentPrice || currentPrice <= 0) return false;

  const price = Number(currentPrice);

  switch (order.orderType) {
    case "limit":
      // Buy limit: execute when market price <= limit price
      // Sell limit: execute when market price >= limit price
      return order.side === "buy"
        ? price <= Number(order.price)
        : price >= Number(order.price);

    case "stop_loss":
      // Buy stop-loss: execute when market price >= stop price
      // Sell stop-loss: execute when market price <= stop price
      return order.side === "buy"
        ? price >= Number(order.stopPrice)
        : price <= Number(order.stopPrice);

    default:
      return false;
  }
}

// ── Cancel Order ───────────────────────────────────────────────────────────

export async function cancelOrder(userId, orderId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId, status: { in: ["pending", "open"] } },
  });

  if (!order) {
    throw new Error("Order not found or already filled/cancelled");
  }

  // If cancelling a bracket parent, also cancel children
  if (order.orderType === "bracket") {
    await prisma.order.updateMany({
      where: { parentOrderId: orderId, status: { in: ["pending", "open"] } },
      data: { status: "cancelled" },
    });
  }

  return prisma.order.update({
    where: { id: orderId },
    data: { status: "cancelled" },
  });
}

// ── CSV Export ────────────────────────────────────────────────────────────
// Exports orders as a CSV string. Filters are the same as listOrders.
// Generates the file in-memory (streaming is overkill for <10K orders).

export async function exportOrdersCSV(userId, filters = {}) {
  const where = { userId };

  if (filters.status) where.status = filters.status;
  if (filters.assetType) where.assetType = filters.assetType;
  if (filters.assetSymbol) where.assetSymbol = filters.assetSymbol.toUpperCase();
  if (filters.orderType) where.orderType = filters.orderType;
  if (filters.side) where.side = filters.side;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const header = "Date,Type,Side,Asset,Quantity,Price,Filled Qty,Avg Fill,Status,Order ID";
  const rows = orders.map((o) =>
    [
      o.createdAt.toISOString(),
      o.orderType,
      o.side,
      `${o.assetType}:${o.assetSymbol}`,
      o.quantity,
      o.price || "",
      o.filledQuantity,
      o.avgFillPrice || "",
      o.status,
      o.id,
    ].join(",")
  );

  return [header, ...rows].join("\n");
}

// ── List Orders ────────────────────────────────────────────────────────────

export async function listOrders(userId, filters = {}) {
  const where = { userId };

  if (filters.status) where.status = filters.status;
  if (filters.assetType) where.assetType = filters.assetType;
  if (filters.assetSymbol) where.assetSymbol = filters.assetSymbol.toUpperCase();
  if (filters.orderType) where.orderType = filters.orderType;
  if (filters.side) where.side = filters.side;

  // Date range filter
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }

  const page = Math.max(1, parseInt(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit) || 20));
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, limit, pages: Math.ceil(total / limit) };
}
