import { Router } from "express";
import cookieParser from "cookie-parser";
import { signup, login, generateOtp, verifyOtp, resetPortfolio, refreshAccessToken, logout, getMe } from "../services/authService.js";
import { authenticate } from "../middleware/auth.js";
import { signupSchema, loginSchema, verifyOtpSchema } from "../validators/auth.js";

const router = Router();

router.use(cookieParser());

// Zod validation middleware — keeps route handlers clean
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      });
    }
    req.validated = result.data;
    next();
  };
}

// POST /auth/signup
// Creates user + portfolio + balance rows atomically.
// Sets refresh token in HttpOnly cookie, returns access token + user in body.
router.post("/signup", validate(signupSchema), async (req, res) => {
  try {
    const result = await signup(req.validated);
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json({
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(500).json({ error: "Signup failed" });
  }
});

// POST /auth/login
// Validates credentials. Sets refresh token in HttpOnly cookie.
// Returns access token + user in body.
router.post("/login", validate(loginSchema), async (req, res) => {
  try {
    const result = await login(req.validated);
    setRefreshCookie(res, result.refreshToken);
    res.json({
      user: result.user,
      accessToken: result.accessToken,
      twoFactorEnabled: result.twoFactorEnabled,
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// POST /auth/refresh
// Rotates refresh token: verifies old one from cookie, issues new pair.
// Sets new refresh token in HttpOnly cookie.
router.post("/refresh", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: "No refresh token" });
    }
    const result = await refreshAccessToken(refreshToken);
    setRefreshCookie(res, result.refreshToken);
    res.json({ accessToken: result.accessToken });
  } catch (err) {
    clearRefreshCookie(res);
    res.status(401).json({ error: err.message });
  }
});

// GET /auth/me
// Returns current user from access token (validated by middleware).
router.get("/me", authenticate, async (req, res) => {
  try {
    const result = await getMe(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// POST /auth/logout
// Clears refresh token cookie and invalidates it server-side.
router.post("/logout", async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await logout(refreshToken);
    }
    clearRefreshCookie(res);
    res.json({ success: true });
  } catch {
    clearRefreshCookie(res);
    res.json({ success: true });
  }
});

// POST /auth/otp/generate
router.post("/otp/generate", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  try {
    const result = await generateOtp(email);
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to generate OTP" });
  }
});

// POST /auth/otp/verify
router.post("/otp/verify", validate(verifyOtpSchema), async (req, res) => {
  try {
    const result = await verifyOtp(req.validated);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// POST /auth/reset-portfolio
router.post("/reset-portfolio", authenticate, async (req, res) => {
  try {
    const result = await resetPortfolio(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
}

function clearRefreshCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("refreshToken", "", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 0,
    path: "/",
  });
}

export default router;
