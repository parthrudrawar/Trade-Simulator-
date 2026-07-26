-- CreateEnum
CREATE TYPE "order_side" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "order_type" AS ENUM ('market', 'limit', 'stop_loss', 'bracket');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'open', 'filled', 'partially_filled', 'cancelled', 'expired', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cooldown_expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_balances" (
    "id" UUID NOT NULL,
    "portfolio_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "cash_balance" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "portfolio_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_order_id" UUID,
    "side" "order_side" NOT NULL,
    "order_type" "order_type" NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "price" DECIMAL(18,4),
    "stop_price" DECIMAL(18,4),
    "status" "order_status" NOT NULL,
    "filled_quantity" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "avg_fill_price" DECIMAL(18,4),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "avg_buy_price" DECIMAL(18,4),
    "current_price" DECIMAL(18,4),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL,
    "watchlist_id" UUID NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "asset_type" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "target_price" DECIMAL(18,4) NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "triggered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_journal" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID,
    "asset_type" TEXT NOT NULL,
    "asset_symbol" TEXT NOT NULL,
    "notes" TEXT,
    "tags" TEXT[],
    "exit_date" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_journal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "portfolios_user_id_key" ON "portfolios"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_balances_portfolio_id_currency_key" ON "portfolio_balances"("portfolio_id", "currency");

-- CreateIndex
CREATE INDEX "idx_orders_pending" ON "orders"("status", "asset_symbol");

-- CreateIndex
CREATE INDEX "idx_orders_user_date" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_user_status" ON "orders"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_user_asset" ON "orders"("user_id", "asset_symbol", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_user_type" ON "orders"("user_id", "order_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_parent" ON "orders"("parent_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_user_id_asset_type_asset_symbol_key" ON "positions"("user_id", "asset_type", "asset_symbol");

-- CreateIndex
CREATE UNIQUE INDEX "watchlists_user_id_name_key" ON "watchlists"("user_id", "name");

-- CreateIndex
CREATE INDEX "idx_watchlist_items_wl" ON "watchlist_items"("watchlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_watchlist_id_asset_symbol_key" ON "watchlist_items"("watchlist_id", "asset_symbol");

-- CreateIndex
CREATE INDEX "idx_price_alerts_active" ON "price_alerts"("user_id", "asset_symbol", "triggered");

-- CreateIndex
CREATE INDEX "idx_trade_journal_user" ON "trade_journal"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_balances" ADD CONSTRAINT "portfolio_balances_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_journal" ADD CONSTRAINT "trade_journal_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_journal" ADD CONSTRAINT "trade_journal_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
