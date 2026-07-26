import { Router } from "express";
import jwt from "jsonwebtoken";
import { explainPriceMove, retrieveArticles } from "../services/ragService.js";

const router = Router();

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : req.query.token;

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    req.user = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// GET /rag/explain/:assetType/:symbol
// SSE endpoint: streams "Why is it moving?" explanation for a given symbol.
// RAG pipeline: hybrid retrieval (pgvector + tsvector) → LLM → cached per time bucket.
router.get("/explain/:assetType/:symbol", authenticateToken, async (req, res) => {
  const { assetType, symbol } = req.params;

  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent("status", { message: "Retrieving relevant news articles..." });

    const result = await explainPriceMove(assetType, symbol.toUpperCase());

    sendEvent("status", {
      message: `Found ${result.articles.length} relevant articles. Generating explanation...`,
      articleCount: result.articles.length,
    });

    for (const bullet of result.bullets) {
      const match = bullet.match(/\[Source:\s*(\d+)\]/i);
      const sourceIdx = match ? parseInt(match[1], 10) - 1 : -1;
      const article = sourceIdx >= 0 && sourceIdx < result.articles.length
        ? result.articles[sourceIdx]
        : null;

      sendEvent("bullet", { text: bullet, article });
      await new Promise(r => setTimeout(r, 300));
    }

    sendEvent("done", { cached: result.cached || false });
  } catch (err) {
    console.error("[RAG:Explain] Error:", err.message);
    sendEvent("error", { message: err.message || "Failed to generate explanation" });
  }

  res.end();
});

// GET /rag/health
router.get("/health", async (_req, res) => {
  res.json({
    status: "ok",
    service: "rag",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// GET /rag/articles/:assetType/:symbol
// Returns stored articles for a symbol (debug/utility)
router.get("/articles/:assetType/:symbol", authenticateToken, async (req, res) => {
  const { assetType, symbol } = req.params;
  try {
    const { articles } = await retrieveArticles(assetType, symbol.toUpperCase(), 20);
    res.json({ symbol: symbol.toUpperCase(), articles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
