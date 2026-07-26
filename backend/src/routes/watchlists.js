import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { prisma } from "../config/database.js";

const router = Router();
router.use(authenticate);

// GET /watchlists — list all watchlists for the user, with their items
router.get("/", async (req, res) => {
  const lists = await prisma.watchlist.findMany({
    where: { userId: req.user.id },
    include: { items: { orderBy: { addedAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(lists);
});

// GET /watchlists/:id — single watchlist with items
router.get("/:id", async (req, res) => {
  const list = await prisma.watchlist.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: { items: { orderBy: { addedAt: "asc" } } },
  });
  if (!list) return res.status(404).json({ error: "Watchlist not found" });
  res.json(list);
});

// POST /watchlists — create a named watchlist
router.post("/", async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const list = await prisma.watchlist.create({
      data: { userId: req.user.id, name: name.trim() },
    });
    res.status(201).json(list);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Watchlist name already exists" });
    }
    throw err;
  }
});

// PUT /watchlists/:id — rename a watchlist
router.put("/:id", async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const list = await prisma.watchlist.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!list) return res.status(404).json({ error: "Watchlist not found" });
  try {
    const updated = await prisma.watchlist.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Watchlist name already exists" });
    }
    throw err;
  }
});

// DELETE /watchlists/:id — delete a watchlist (items cascade)
router.delete("/:id", async (req, res) => {
  const list = await prisma.watchlist.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!list) return res.status(404).json({ error: "Watchlist not found" });
  await prisma.watchlist.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// POST /watchlists/:id/items — add an asset to the watchlist
// Body: { assetType, assetSymbol }
router.post("/:id/items", async (req, res) => {
  const { assetType, assetSymbol } = req.body;
  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  if (!assetSymbol) {
    return res.status(400).json({ error: "assetSymbol is required" });
  }
  const list = await prisma.watchlist.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!list) return res.status(404).json({ error: "Watchlist not found" });
  try {
    const item = await prisma.watchlistItem.create({
      data: {
        watchlistId: req.params.id,
        assetType,
        assetSymbol: assetSymbol.toUpperCase(),
      },
    });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Asset already in this watchlist" });
    }
    throw err;
  }
});

// DELETE /watchlists/:id/items/:itemId — remove an asset from the watchlist
router.delete("/:id/items/:itemId", async (req, res) => {
  const list = await prisma.watchlist.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!list) return res.status(404).json({ error: "Watchlist not found" });
  const item = await prisma.watchlistItem.findFirst({
    where: { id: req.params.itemId, watchlistId: req.params.id },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });
  await prisma.watchlistItem.delete({ where: { id: req.params.itemId } });
  res.status(204).end();
});

export default router;
