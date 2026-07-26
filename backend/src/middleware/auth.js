import { verifyAccessToken } from "../config/jwt.js";

// Express middleware that validates the access token.
// Strategy:
// 1. Extract token from Authorization: Bearer <token>
// 2. Verify signature + expiry with the access secret
// 3. Attach decoded payload (user.id, user.email) to req.user
// 4. On failure, return 401 — never leak WHY (invalid vs expired)
//
// Why not verify against the DB on every request?
// Access tokens are short-lived (15 min). DB verification on every request would
// add 2-5ms latency to every API call for a security benefit that expires in
// minutes anyway. The tradeoff is acceptable for MVP.

export function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = { id: decoded.sub, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
