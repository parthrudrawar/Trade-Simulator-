# SYSTEM MEMORY — TradeSimulator

*Use this file to rehydrate context if the model's context window expires.*

---

## PROJECT

Paper trading platform for stocks (INR) and crypto (USD).
React + Vite + TailwindCSS frontend, Node.js/Express backend,
PostgreSQL (Prisma ORM), Redis (ioredis), WebSocket, Bull Queue.

---

## FILE TREE (current state)

```
TradeSimulator AI/
.README.md                           # Monorepo layout, quick start
.explanation.txt                     # System design review + prompts log
.SYSTEM_MEMORY.md                    # THIS FILE — context recall

.backend/
.  .package.json                     # express, @prisma/client, ioredis, bcryptjs, zod, jsonwebtoken, bull, socket.io
.  .env.example                      # DATABASE_URL, REDIS_URL, JWT secrets, DEFAULT_INR_BALANCE
.  .prisma/schema.prisma             # 10 models, 3 enums, 5 partial indexes
.  .src/
.  .  .index.js                      # Express + HTTP + Socket.io + Redis sub + price poller + order matcher
.  .  .config/
.  .  .  .database.js                # PrismaClient singleton (globalThis for hot-reload)
.  .  .  .redis.js                   # ioredis (regular) + redisSubscriber (PUB/SUB only — separate connection)
.  .  .  .jwt.js                     # signAccessToken(15m), signRefreshToken(7d), verify* functions
.  .  .  .marketDataProviders.js     # TwelveDataProvider (stocks) + CoinGeckoProvider (crypto) + rate limit tracking
.  .  .  .socket.js                  # Socket.io Server: JWT auth, subscribe/unsubscribe -> per-symbol rooms
.  .  .middleware/auth.js            # Extract Bearer token, verify, attach req.user
.  .  .services/authService.js       # signup(tx), login, generateOtp, verifyOtp, resetPortfolio
.  .  .services/marketDataService.js # Cache-aside getPrice, getPricesBulk, discoverActiveSymbols, updatePriceCache
.  .  .services/priceBroadcast.js    # Redis PUB/SUB -> Socket.io + queueOrderCheck() for order matcher
.  .  .services/orderExecutionService.js # executeMarketOrder(sync), executeFill(core), createLimit/Stop/Bracket(async), shouldExecute, cancelOrder
.  .  .workers/pricePoller.js        # Bull queue repeating job (10s), selective refresh of active symbols only
.  .  .workers/orderMatcher.js       # Bull queue: event-driven (triggered by price updates) + 60s fallback scan, bracket OCO
.  .  .validators/auth.js            # Zod: signupSchema, loginSchema, verifyOtpSchema
.  .  .routes/auth.js                # 5 auth endpoints
.  .  .routes/marketData.js          # GET /market/price/:type/:sym, POST /market/prices, GET /market/active-symbols
.  .  .routes/orders.js              # POST market/limit/stop-loss/bracket/cancel, GET orders, GET /export/csv
.  .  .routes/watchlists.js          # CRUD multiple named lists + add/remove items
.  .  .routes/alerts.js              # CRUD price alerts + dismiss
.  .  .services/alertService.js      # createAlert, isAlertTriggered, triggerAlert (atomic UPDATE)
.  .  .services/newsService.js       # NewsAPI fetcher, 30min Redis cache, graceful degrade
.  .  .workers/alertMatcher.js       # Bull queue: event-driven per price tick + 60s fallback scan (same pattern as orderMatcher)

.frontend/
.  .package.json                     # react 19, vite 6, tailwindcss 4, @tailwindcss/vite, socket.io-client
.  .vite.config.js                   # Tailwind v4 plugin + dev proxy /auth -> localhost:3001
.  .index.html
.  .src/
.  .  .main.jsx                      # BrowserRouter + AuthProvider -> App
.  .  .App.jsx                       # Route definitions (auth + protected pages)
.  .  .index.css                     # @import "tailwindcss"
.  .  .context/
.  .  .  .AuthContext.jsx            # Auth state, login/signup/logout, token persistence
.  .  .services/
.  .  .  .socket.js                  # Socket.io client singleton (one conn per app), reconnect with backoff
.  .  .  .api.js                     # Fetch wrapper: JWT attach, auto-refresh, methods
.  .  .hooks/
.  .  .  .useSocketPrice.js          # Sub/unsub lifecycle on mount/navigate/unmount, re-sub on reconnect
.  .  .components/
.  .  .  .Layout.jsx                 # Sidebar nav + Outlet (collapsible)
.  .  .  .ProtectedRoute.jsx         # Redirect to /login if no user
.  .  .pages/
.  .  .  .Login.jsx                  # Email/password login, redirects to OTP if 2FA enabled
.  .  .  .Signup.jsx                 # Registration form
.  .  .  .OtpVerify.jsx             # OTP input, auto-generate on mount
.  .  .  .Dashboard.jsx             # Analytics: P&L, win rate, Sharpe, positions table, charts
.  .  .  .Trading.jsx               # Order form: market/limit/stop-loss/bracket with live price
.  .  .  .Portfolio.jsx             # Positions table with P&L, reset button
.  .  .  .Watchlists.jsx            # CRUD watchlists, live prices per symbol via WS
.  .  .  .TradeHistory.jsx          # Filterable table, pagination, CSV export
.  .  .  .Alerts.jsx                # Create/dismiss/delete price alerts
.  .  .  .AssetDetail.jsx           # Timeframe chart (1m-1w), stats, news, buy/sell panel

.backend/
.  .src/
.  .  .services/newsService.js      # NEW: NewsAPI fetcher, 30min cache, graceful degrade
```

---

## DATABASE SCHEMA (10 tables, 3 enums)

All PKs are UUID with `@default(uuid())`. All FK CASCADE on delete.
snake_case in PostgreSQL via @@map and @map.

ENUMS:       OrderSide(buy,sell), OrderType(market,limit,stop_loss,bracket),
             OrderStatus(pending,open,filled,partially_filled,cancelled,expired,rejected)

MODELS:
- User:        id, email(UQ), passwordHash, name, twoFactorEnabled, Portfolio(1:1)
- Portfolio:   id, userId(UQ), cooldownExpiresAt, user, balances[]
- PortfolioBalance: id, portfolioId(FK), currency, cashBalance, UQ(portfolioId,currency)
- Order:       id, userId(FK), parentOrderId(FK self), side(enum), orderType(enum),
               assetType, assetSymbol, quantity, price?, stopPrice?, status(enum),
               filledQuantity, avgFillPrice, metadata(Json), expiresAt?
               Partial indexes: pending/active idx, user+date idx, parent exists idx
- Position:    id, userId(FK), assetType, assetSymbol, quantity, avgBuyPrice, currentPrice
               UQ(userId,assetType,assetSymbol)
- Watchlist:   id, userId(FK), name, UQ(userId,name)
- WatchlistItem: id, watchlistId(FK), assetType, assetSymbol, UQ(watchlistId,assetSymbol)
- PriceAlert:  id, userId(FK), assetType, assetSymbol, direction(above/below),
               targetPrice, triggered(Bool), triggeredAt?
               Partial index: WHERE triggered=false
- TradeJournal: id, userId(FK), orderId(FK?), assetType, assetSymbol, notes, tags(String[]),
                exitDate?

---

## PRISMA vs KNEX — Decision (documented in schema.prisma header)

Prisma chosen because:
1. Native UUID PKs (Knex needs raw SQL)
2. Native ENUMs (Knex needs CREATE TYPE in raw SQL)
3. Partial indexes via @@index(where: "...") (Knex needs raw SQL)
4. JSONB fields via `Json` type
5. Array fields via `String[]`
6. Declarative migrations (diff-based) — safer for 10-table schema
7. Type-safe client — catches column typos at compile time

Tradeoff: Knex better for complex CTEs/window functions. This schema doesn't need them.

---

## AUTH SYSTEM

### JWT Two-Token Pattern (access + refresh)

- Access token: 15m expiry, sent as `Authorization: Bearer <token>`, stateless
- Refresh token: 7d expiry, stored in httpOnly cookie (not accessible to JS)
- WHY TWO TOKENS: limits theft damage (15m window), enables rotation/revocation,
  httpOnly refresh prevents XSS theft of long-lived credentials
- Secrets in .env: ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET (both HS256)
- Implemented in: config/jwt.js (sign/verify), middleware/auth.js (extract+verify)

### OTP 2FA with Redis

- POST /auth/otp/generate: creates 6-digit OTP, stores via `SETEX otp:{email} 300 <otp>`
- POST /auth/otp/verify: constant-time comparison via crypto.timingSafeEqual,
  deletes OTP on success, sets user.twoFactorEnabled = true
- WHY REDIS: OTPs are ephemeral, TTL handles auto-expiry (no cron),
  O(1) lookup, no permanent data loss if Redis crashes
- Redis client: ioredis with lazyConnect, exponential backoff retry (config/redis.js)

### Auth Endpoints (routes/auth.js)

| Method | Path                  | Auth? | Purpose                     |
|--------|----------------------|-------|-----------------------------|
| POST   | /auth/signup         | No    | Create user+portfolio+balances in tx |
| POST   | /auth/login          | No    | Verify password, return tokens |
| POST   | /auth/otp/generate   | No    | Generate OTP, store in Redis |
| POST   | /auth/otp/verify     | No    | Verify OTP, enable 2FA      |
| POST   | /auth/reset-portfolio| Yes   | Reset balances, set cooldown |

### Transactional Signup (services/authService.js)

Uses Prisma `$transaction` for atomicity:
1. tx.user.create({ email, passwordHash, name })
2. tx.portfolio.create({ userId })
3. tx.portfolioBalance.createMany([INR=1,000,000, USD=0])

WHY TRANSACTION: partial failure leaves orphan user (login but no portfolio)
or orphan portfolio (no balances). All three must succeed or all roll back.

### Portfolio Reset + Cooldown

- Cooldown enforced at APPLICATION layer (not DB CHECK constraint)
- WHY APP LAYER: CHECK constraints can't reference NOW() (non-deterministic)
- Sets cooldownExpiresAt = NOW() + 24h
- Race condition (two simultaneous resets) is harmless:
  both produce same result (reset to defaults), final cooldown wins

---

## MARKET DATA LAYER — Cache-Aside + Selective Refresh

### Provider Architecture (marketDataProviders.js)

- **TwelveDataProvider** (stocks): `api.twelvedata.com/price` — batch via comma-separated symbols
- **CoinGeckoProvider** (crypto): `api.coingecko.com/api/v3/simple/price` — IDs mapped from ticker
- Rate limit tracking: Redis INCR counter with 60s TTL per provider (`ratelimit:{name}:{minuteEpoch}`)
- Shared counter across all Node processes — prevents each process from exhausting quota independently

### Cache-Aside Flow (marketDataService.js)

User request -> check Redis `price:stock:RELIANCE` -> HIT: return -> MISS: fetch API -> SETEX 60s -> return
On rate limit: serve from `fallback` key (no TTL, written by poller) with `stale: true` flag.

### Selective Background Poller (pricePoller.js)

Bull queue repeating job every 10s:
1. `discoverActiveSymbols()` — queries DB for distinct symbols in watchlist_items + positions + price_alerts
2. Groups by type (stock/crypto) — each gets ONE batch API call
3. For each: `provider.fetchPrices([symbols])` -> `updatePriceCache()` writes Redis + fallback + PUB/SUB
4. On rate limit: skip cycle, cache serves stale data, retry next tick

### Why not poll everything?

Market has 14,000+ symbols. Free API tiers give ~800 calls/day. Our approach polls only ~1,500 watched symbols
in 2 batch calls per cycle. That's 6 calls/min vs 14,000 calls/min for full market poll.

### TTL: 60 seconds

- <15s: cache useless, API quota exhausted by user traffic
- >300s: dangerously stale portfolio values
- 60s: absorbs user traffic (cache hits), inactive symbols auto-expire
- Active symbols get pushed every 10s by poller (overwrites TTL), so they're never actually 60s stale

## WEBSOCKET LAYER — Per-Symbol Rooms

### Architecture

```
Price Poller (10s tick) -> updatePriceCache() -> Redis PUB/SUB "price:updates"
                                                      |
                                            priceBroadcast.js (subscriber)
                                                      |
                                            Socket.io Server
                                                      |
                               io.to("price:stock:RELIANCE").emit("price:update", data)
                                                      |
                                            Client in room "price:stock:RELIANCE"
```

### Why two Redis connections?

Redis protocol: a connection in SUBSCRIBE mode cannot execute GET/SET/etc.
- `redis`: regular commands + Bull queue
- `redisSubscriber`: SUBSCRIBE "price:updates" only (config/redis.js)

### Per-symbol rooms (not global broadcast)

Room name: `price:{assetType}:{SYMBOL}`
- Global broadcast: every client gets 14,000 msgs/sec (all symbols) = 140M/sec for 10k clients
- Per-symbol: client gets exactly N msgs/sec (N = symbols watching). O(N) vs O(market).

### Subscribe/Unsubscribe Lifecycle

Client emits `subscribe([{assetType, symbol}, ...])` → server joins rooms
Client emits `unsubscribe([...])` → server leaves rooms
On disconnect → Socket.io auto-removes from all rooms
On reconnect → hook re-emits subscribe for all current symbols via ref (see below)

### Reconnection (exponential backoff with jitter)

Socket.io built-in: 1s → 2s → 4s → 8s → 16s → 30s (cap), ±50% jitter.
On reconnect "connect" event: useSocketPrice reads subsRef.current and re-subscribes.

### Hook: useSocketPrice(subscriptions)

- subscriptions: array of `{assetType, symbol}` (caller should useMemo)
- returns: `{ "stock:RELIANCE": {price, change, changePercent, timestamp, stale?} }`
- Effect cleanup unsubscribes the OLD subscriptions
- Next effect subscribes NEW subscriptions
- Reconnect handler uses ref to get CURRENT subscriptions (not stale closure)

## ARCHITECTURE — Price Update Flow (Updated)

```
External API -> Bull Queue -> Redis (cache + PUB/SUB)
                                  |
                    priceBroadcast.js (subscriber)
                                  |
                    Socket.io (per-symbol rooms)
                                  |
                    React Client (useSocketPrice hook)
```

Key: Redis is triple-purposed (price cache, PUB/SUB bus, Bull backend).
WS fan-out per-symbol room — O(N) per client, not O(market).

---

## RISK REGISTER

| # | Risk | Mitigation |
|---|------|------------|
| 1 | PG as matching engine: lock contention, no priority queue | Schema allows swapping matcher later. MVP keeps Bull+PG for simplicity |
| 2 | Node WS fan-out: single thread, 50k connections limit | Defer to post-MVP. Options: uWebSockets, per-conn Redis SUB, Centrifugo |
| 3 | Bracket order: partial fill race, OCO semantics | MVP builds market/limit/stop-loss first. Brackets: sequential-entry only |

---

## QUICK START

```bash
cd backend
cp .env.example .env
# edit .env with your PostgreSQL and Redis credentials
npm install
npx prisma migrate dev
npm run dev

# separate terminal
cd frontend
npm install
npm run dev
```

Backend runs on :3001, Frontend on :5173 with proxy to backend.

---

## BUILT SO FAR (✓ completed)

1. ✓ System design review: PostgreSQL schema, architecture diagram, risk analysis
2. ✓ Monorepo scaffold: frontend (React+Vite+Tailwind) + backend (Node+Express)
3. ✓ Prisma schema: 10 tables, 3 enums, partial indexes, all FK relationships
4. ✓ Auth system: signup/login with JWT access+refresh tokens + OTP 2FA via Redis
5. ✓ Transactional signup: user + portfolio + balances created atomically
6. ✓ Portfolio reset with cooldown enforcement (app-layer, 24h)
7. ✓ Market data layer: cache-aside (60s TTL) + selective background poller (10s)
8. ✓ Twelve Data provider (stocks) + CoinGecko provider (crypto) with rate limit tracking
9. ✓ Rate limit fallback: stale data served from Redis fallback key instead of crashing
10. ✓ Active symbol discovery: only polls symbols users actually watch/hold/alert
11. ✓ WebSocket server (Socket.io) with per-symbol rooms (price:{type}:{SYMBOL})
12. ✓ priceBroadcast.js: Redis PUB/SUB -> Socket.io bridge (decouples fetcher from WS)
13. ✓ useSocketPrice React hook: sub/unsub lifecycle + reconnect with exponential backoff
14. ✓ Reconnection strategy: 1s→2s→4s→8s→16s→30s cap, ±50% jitter, re-subscribe via ref
15. ✓ Market orders: synchronous execution in DB transaction (atomic cash check-and-deduct)
16. ✓ Limit/stop-loss/bracket orders: async via Bull queue, event-driven by price updates
17. ✓ Order matcher worker: hybrid (event-driven per price tick + 60s full scan fallback)
18. ✓ Bracket OCO: when one child fills, sibling auto-cancelled
19. ✓ Race condition safety: pessimistic row locking (UPDATE ... WHERE cash >= amount, SELECT FOR UPDATE)
20. ✓ Concurrency: PostgreSQL row-level lock serializes concurrent portfolio mutations
21. ✓ Watchlist CRUD: multiple named lists, add/remove assets, ownership-gated
22. ✓ Price alerts: event-driven Bull queue (same pattern as order matcher)
23. ✓ Alert matcher reuses same architecture as order matcher (same reason: condition check on price tick)
24. ✓ Trade history: 3 new composite indexes (user+status, user+asset, user+type) for filtered queries
25. ✓ CSV export: GET /orders/export/csv with same filter params as list
26. ✓ Analytics dashboard: 8 metric functions (P&L, win rate, Sharpe, volatility, etc) with 30s Redis cache
27. ✓ Analytics routes: GET /analytics/dashboard, /summary, /pnl, /win-rate, /best-worst, /sectors, /holding-period, /volatility, /sharpe
28. ✓ Frontend routing: BrowserRouter + AuthProvider, protected routes via Layout
29. ✓ Auth pages: Login (with OTP redirect), Signup, OTP Verify
30. ✓ Dashboard page: stats cards, P&L line chart, positions bar chart, sector allocation, positions table
31. ✓ Trading page: market/limit/stop-loss/bracket order form with live price display
32. ✓ Portfolio page: positions table with P&L/return %, reset portfolio button
33. ✓ Watchlists page: CRUD multiple lists, add/remove items with live prices via WebSocket
34. ✓ Trade History page: paginated table with status/symbol filters, CSV export button
35. ✓ Alerts page: create/dismiss/delete alerts with include-triggered toggle
36. ✓ Asset Detail page: TradingView Lightweight Charts with live price updates
37. ✓ Multi-interval OHLCV: 1m/5m/15m/1h/1d/1w with tiered cache per timeframe
38. ✓ BinanceProvider: crypto OHLCV via public klines API (no key needed)
39. ✓ Asset stats: market cap, 52w high/low, volume, P/E, circulating supply, ATH/ATL
40. ✓ News feed: NewsAPI with 30min Redis cache, graceful degrade if no API key
41. ✓ Stats/News routes: GET /market/stats/:type/:sym, GET /market/news/:type/:sym
42. ✓ Buy/sell panel on asset detail page with all 4 order types

## NEXT STEPS (not yet built)

1. WebSocket push of fill events to clients (real-time order status updates)
2. In-app notification system for triggered alerts
3. Position management (close, partial close)
4. Connect frontend proxy settings so /api and /ws routes work seamlessly
5. Add order cancellation from order history UI
6. Loading skeletons and empty states polish
