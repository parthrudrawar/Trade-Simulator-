import jwt from "jsonwebtoken";

// ── WHY TWO TOKENS (ACCESS + REFRESH)? ──────────────────────────────────────
//
// Using a single long-lived JWT is simpler but has a critical security hole:
// if the token is stolen (XSS, compromised client, MITM), the attacker has
// access until the token expires. There's no way to revoke it without a
// blocklist (which defeats the purpose of stateless JWTs).
//
// The access + refresh pattern solves this:
//
// 1. SHORT-LIVED ACCESS TOKEN (15 min)
//    - Carried on every API request (Authorization header).
//    - If stolen, the damage window is ~15 minutes.
//    - Stateless: the server doesn't need to check a DB or cache on each request.
//
// 2. LONG-LIVED REFRESH TOKEN (7 days)
//    - Sent only to /auth/refresh, stored in an httpOnly secure cookie.
//    - httpOnly means JavaScript can't read it — mitigates XSS token theft.
//    - Can be rotated: when a refresh token is used, issue a new one and
//      invalidate the old one. If a stolen refresh token is used AFTER you've
//      already used it, you know it's compromised and can revoke all sessions.
//    - Can be individually revoked server-side (stored hash in DB or Redis)
//      without affecting other users.
//
// 3. REVOCATION STRATEGY (v2 enhancement, noted for future)
//    - Store `refresh_token_hash` + `expires_at` in a `sessions` table.
//    - On refresh: verify the token, check the hash against the DB.
//    - On logout/compromise: delete the row. The token becomes useless.
//    - For MVP we skip this — a single secret change invalidates all tokens
//      which is acceptable for a paper trading app.

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || "dev-access-secret";
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || "dev-refresh-secret";

export function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}
