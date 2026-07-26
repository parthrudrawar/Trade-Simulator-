import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { createAlert, listAlerts, dismissAlert, deleteAlert } from "../services/alertService.js";

const router = Router();
router.use(authenticate);

// POST /alerts — create a price alert
// Body: { assetType, assetSymbol, direction ("above"|"below"), targetPrice }
router.post("/", async (req, res) => {
  const { assetType, assetSymbol, direction, targetPrice } = req.body;

  if (!["stock", "crypto"].includes(assetType)) {
    return res.status(400).json({ error: "assetType must be 'stock' or 'crypto'" });
  }
  if (!assetSymbol) {
    return res.status(400).json({ error: "assetSymbol is required" });
  }

  try {
    const alert = await createAlert(req.user.id, {
      assetType, assetSymbol, direction, targetPrice,
    });
    res.status(201).json(alert);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /alerts — list user's alerts
// Query: includeTriggered=true to include already-triggered alerts
router.get("/", async (req, res) => {
  const includeTriggered = req.query.includeTriggered === "true";
  const alerts = await listAlerts(req.user.id, includeTriggered);
  res.json(alerts);
});

// PUT /alerts/:id/dismiss — reset a triggered alert back to active
router.put("/:id/dismiss", async (req, res) => {
  try {
    const alert = await dismissAlert(req.user.id, req.params.id);
    res.json(alert);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// DELETE /alerts/:id — delete an alert
router.delete("/:id", async (req, res) => {
  try {
    await deleteAlert(req.user.id, req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
