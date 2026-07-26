import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { redis, USE_MOCK_REDIS } from "./config/redis.js";
import { prisma } from "./config/database.js";
import { startNewsIngestion, stopNewsIngestion } from "./workers/newsIngestionWorker.js";
import ragRoutes from "./routes/ragRoutes.js";

const app = express();
const PORT = process.env.RAG_PORT || 3002;

app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use("/rag", ragRoutes);

async function start() {
  try {
    console.log("[RAG] 1. Connecting Redis...");
    await redis.connect();
    console.log("[RAG] 2. Redis connected");

    console.log("[RAG] 3. Connecting PostgreSQL...");
    await prisma.$connect();
    console.log("[RAG] 4. PostgreSQL connected");

    console.log("[RAG] 5. Starting News Ingestion Worker...");
    await startNewsIngestion();
    console.log("[RAG] 6. News Ingestion started");

    app.listen(PORT, () => {
      console.log(`[RAG] RAG Service running on http://localhost:${PORT}`);
      console.log(`[RAG] Endpoints:`);
      console.log(`[RAG]   GET /rag/health`);
      console.log(`[RAG]   GET /rag/explain/:assetType/:symbol  (SSE streaming)`);
      console.log(`[RAG]   GET /rag/articles/:assetType/:symbol`);
    });
  } catch (err) {
    console.error("[RAG] Startup error:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", async () => {
  if (!USE_MOCK_REDIS) await stopNewsIngestion();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});

start();
