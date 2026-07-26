import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "../config/database.js";
import { redis } from "../config/redis.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../config/jwt.js";

const SALT_ROUNDS = 12;
const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_PREFIX = "otp:";
const REFRESH_PREFIX = "refresh:";
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// ── SIGNUP (Transactional) ─────────────────────────────────────────────────
//
// Why a Prisma interactive transaction?
//
// If the process crashes after creating the user row but before creating the
// portfolio and balance rows, you end up with an orphan user who can log in
// but has no portfolio. Any trading action would crash with a null reference.
//
// The three operations MUST be atomic:
//   1. INSERT INTO users
//   2. INSERT INTO portfolios (references user.id)
//   3. INSERT INTO portfolio_balances x2 (references portfolio.id)
//
// If step 2 fails, step 1 must roll back.
// If step 3 fails, steps 1 and 2 must roll back.
//
// Prisma's interactive transaction (`$transaction([...])`) ensures all three
// happen in a single DB transaction. PostgreSQL rolls back on any error.

export async function signup({ email, password, name }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Create user
    const user = await tx.user.create({
      data: { email, passwordHash, name },
    });

    // 2. Create portfolio (1:1 with user)
    const portfolio = await tx.portfolio.create({
      data: { userId: user.id },
    });

    // 3. Create balance rows (INR with default virtual balance, USD at 0)
    const defaultInr = Number(process.env.DEFAULT_INR_BALANCE) || 1_000_000;
    const defaultUsd = Number(process.env.DEFAULT_USD_BALANCE) || 0;

    await tx.portfolioBalance.createMany({
      data: [
        { portfolioId: portfolio.id, currency: "INR", cashBalance: defaultInr },
        { portfolioId: portfolio.id, currency: "USD", cashBalance: defaultUsd },
      ],
    });

    return user;
  });

  // Generate tokens from the committed user data
  const payload = { sub: result.id, email: result.email };
  const refreshToken = signRefreshToken(payload);
  await storeRefreshToken(result.id, refreshToken);

  return {
    user: { id: result.id, email: result.email, name: result.name },
    accessToken: signAccessToken(payload),
    refreshToken,
  };
}

// ── LOGIN ──────────────────────────────────────────────────────────────────

async function ensurePortfolioExists(userId) {
  const portfolio = await prisma.portfolio.findUnique({ where: { userId } });
  if (portfolio) return portfolio;

  const defaultInr = Number(process.env.DEFAULT_INR_BALANCE) || 1_000_000;
  const defaultUsd = Number(process.env.DEFAULT_USD_BALANCE) || 0;

  return prisma.$transaction(async (tx) => {
    const p = await tx.portfolio.create({ data: { userId } });
    await tx.portfolioBalance.createMany({
      data: [
        { portfolioId: p.id, currency: "INR", cashBalance: defaultInr },
        { portfolioId: p.id, currency: "USD", cashBalance: defaultUsd },
      ],
    });
    return p;
  });
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  // Ensure portfolio + balances exist (handles legacy users)
  await ensurePortfolioExists(user.id);

  const payload = { sub: user.id, email: user.email };
  const refreshToken = signRefreshToken(payload);
  await storeRefreshToken(user.id, refreshToken);

  return {
    user: { id: user.id, email: user.email, name: user.name },
    accessToken: signAccessToken(payload),
    refreshToken,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

// ── REFRESH TOKEN STORAGE (Redis) ───────────────────────────────────────────
//
// We store a hash of the refresh token in Redis with a 7-day TTL.
// This allows us to:
// 1. Validate refresh tokens on /auth/refresh
// 2. Revoke tokens on logout (delete from Redis)
// 3. Detect token reuse (potential theft) - optional enhancement

async function storeRefreshToken(userId, refreshToken) {
  const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const key = `${REFRESH_PREFIX}${userId}:${hash}`;
  await redis.setex(key, REFRESH_TTL_SECONDS, "1");
}

async function validateRefreshToken(userId, refreshToken) {
  const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const key = `${REFRESH_PREFIX}${userId}:${hash}`;
  return redis.get(key);
}

async function revokeRefreshToken(refreshToken) {
  // We need to find which user this belongs to - for simplicity, we'll just
  // not store userId in the token and instead rely on the token payload
  try {
    const payload = verifyRefreshToken(refreshToken);
    const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
    const key = `${REFRESH_PREFIX}${payload.sub}:${hash}`;
    await redis.del(key);
  } catch {
    // Token invalid or expired - nothing to revoke
  }
}

// ── REFRESH ACCESS TOKEN ───────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new Error("Invalid or expired refresh token");
  }

  // Verify the refresh token exists in Redis (not revoked)
  const exists = await validateRefreshToken(payload.sub, refreshToken);
  if (!exists) {
    throw new Error("Refresh token revoked or expired");
  }

  // Rotate: revoke old, issue new
  await revokeRefreshToken(refreshToken);

  const newPayload = { sub: payload.sub, email: payload.email };
  const newRefreshToken = signRefreshToken(newPayload);
  await storeRefreshToken(payload.sub, newRefreshToken);

  return {
    accessToken: signAccessToken(newPayload),
    refreshToken: newRefreshToken,
  };
}

// ── LOGOUT ──────────────────────────────────────────────────────────────────

export async function logout(refreshToken) {
  await revokeRefreshToken(refreshToken);
}

// ── GET ME ──────────────────────────────────────────────────────────────────

export async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, twoFactorEnabled: true, createdAt: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return { user };
}

// ── OTP GENERATION ─────────────────────────────────────────────────────────
//
// Why Redis for OTP storage:
// - OTPs are purely ephemeral — auto-expire in 5 min via Redis TTL.
// - No cleanup needed: no cron job to delete expired OTPs.
// - O(1) lookup on verification.
// - If Redis crashes, the only impact is that ongoing OTP flows fail —
//   no permanent data is lost, and the next signup/login will work fine.
// - Storing OTPs in the users table would require an extra column (or table)
//   and a cron job to clear expired values. That's complexity for data that
//   shouldn't outlive 5 minutes.

export async function generateOtp(email) {
  // Generate a 6-digit OTP
  const otp = crypto.randomInt(100_000, 999_999).toString();

  const key = `${OTP_PREFIX}${email}`;

  // Store in Redis with TTL
  // SETEX = SET + EXPIRE in one atomic command
  await redis.setex(key, OTP_TTL_SECONDS, otp);

  // In production, this would send via email/SMS.
  // For MVP, return it so the frontend can auto-fill during development.
  return { otp, expiresInSeconds: OTP_TTL_SECONDS };
}

// ── OTP VERIFICATION ──────────────────────────────────────────────────────

export async function verifyOtp({ email, otp }) {
  const key = `${OTP_PREFIX}${email}`;
  const stored = await redis.get(key);

  if (!stored) {
    throw new Error("OTP expired or not requested");
  }

  // Constant-time comparison to prevent timing attacks
  // crypto.timingSafeEqual requires Buffer inputs of equal length
  const inputBuffer = Buffer.from(otp);
  const storedBuffer = Buffer.from(stored);

  if (
    inputBuffer.length !== storedBuffer.length ||
    !crypto.timingSafeEqual(inputBuffer, storedBuffer)
  ) {
    throw new Error("Invalid OTP");
  }

  // OTP verified — delete it immediately (one-time use)
  await redis.del(key);

  // Mark user as 2FA-enabled in the database
  await prisma.user.update({
    where: { email },
    data: { twoFactorEnabled: true },
  });

  return { verified: true };
}

// ── PORTFOLIO RESET ───────────────────────────────────────────────────────
//
// Cooldown enforcement: done in the APPLICATION LAYER, not the database.
// Why? The cooldown is business logic ("can't reset more than once every
// N hours"), not a data integrity constraint. PostgreSQL CHECK constraints
// can't reference NOW() — they must be immutable per row. So we check
// `cooldown_expires_at < NOW()` in JavaScript.
//
// Race condition analysis: Two simultaneous reset requests could both read
// `cooldown_expires_at` as NULL (or past), then both proceed. This is
// acceptable because:
// - Worst case: the balance is reset twice, which is idempotent (same result)
// - The cooldown is set to NOW() + 24h, so even if both succeed, the second
//   one just overwrites with the same value.
// - This is a paper trading platform — no real money is at risk.

export async function resetPortfolio(userId) {
  const portfolio = await prisma.portfolio.findUnique({
    where: { userId },
  });

  if (!portfolio) {
    throw new Error("Portfolio not found");
  }

  // Check cooldown
  if (portfolio.cooldownExpiresAt && portfolio.cooldownExpiresAt > new Date()) {
    const remainingMs = portfolio.cooldownExpiresAt.getTime() - Date.now();
    const remainingHours = Math.ceil(remainingMs / 3600000);
    throw new Error(
      `Portfolio reset is on cooldown. Try again in ${remainingHours} hour(s).`
    );
  }

  const defaultInr = Number(process.env.DEFAULT_INR_BALANCE) || 1_000_000;
  const defaultUsd = Number(process.env.DEFAULT_USD_BALANCE) || 0;

  // Reset balances and set cooldown in a single transaction
  await prisma.$transaction(async (tx) => {
    // Reset INR to default
    await tx.portfolioBalance.update({
      where: {
        portfolioId_currency: { portfolioId: portfolio.id, currency: "INR" },
      },
      data: { cashBalance: defaultInr },
    });

    // Reset USD to 0
    await tx.portfolioBalance.update({
      where: {
        portfolioId_currency: { portfolioId: portfolio.id, currency: "USD" },
      },
      data: { cashBalance: defaultUsd },
    });

    // Set cooldown to 24 hours from now
    const cooldown = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.portfolio.update({
      where: { id: portfolio.id },
      data: { cooldownExpiresAt: cooldown },
    });
  });

  return { reset: true, cooldownExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
}
