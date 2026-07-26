# TradeSimulator

Paper trading platform for stocks (INR) and crypto (USD).

## Monorepo Layout

```
TradeSimulator AI/
├── frontend/          # React + Vite + TailwindCSS client
├── backend/           # Node.js + Express API server
│   ├── prisma/        # Prisma schema + migrations
│   └── src/
│       ├── config/    # DB, Redis, JWT client singletons
│       ├── routes/    # Express route handlers
│       ├── middleware/ # Auth, rate-limit, validation
│       ├── services/  # Business logic layer
│       └── validators/ # Zod input schemas
├── rag/               # RAG service: news ingestion + hybrid retrieval + LLM
│   ├── src/
│   │   ├── config/    # DB + Redis connections
│   │   ├── routes/    # SSE explain endpoint
│   │   ├── services/  # Embedding, LLM, hybrid retrieval
│   │   └── workers/   # Bull Queue news ingestion
│   └── .env.example
├── explanation.txt    # System design review from phase 1
└── README.md
```

### Why a monorepo without a workspace tool (npm/pnpm workspaces)?

This project has exactly two packages that share no runtime code — `backend` and
`frontend` are completely independent deployables. Adding a workspace orchestrator
like Turborepo or Nx would introduce configuration overhead (shared ESLint, shared
tsconfig, build pipeline) that doesn't pay off until you have 3+ packages with
shared libraries. We can add one later if the shared-types package emerges.

### Why this separation?

- **Backend owns auth, data, and matching** — it's the source of truth. It can be
  deployed to a VPS or container independently.
- **Frontend is a static Vite build** — served via CDN or Nginx, no Node.js
  runtime needed in production.
- **No shared language/runtime coupling** — if you later want to rewrite the
  frontend in something else, the backend API stays untouched.

## Quick Start

```bash
# Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npx prisma generate
npm run dev

# Frontend
cd frontend
npm install
npm run dev

# RAG Service (separate terminal)
cd rag
cp .env.example .env
npm install
npm run dev
```

The RAG service runs independently on port 3002 and is proxied by Vite at `/rag/*`.
