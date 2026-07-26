import { io } from "socket.io-client";
import { getAccessToken } from "./api";

// ── Socket.io Client Singleton ─────────────────────────────────────────────
//
// A single WebSocket connection is shared across the entire app. Multiple
// React components can subscribe to different symbols over the same connection.
//
// Why one connection per app (not one per component)?
//   - Each WebSocket connection consumes server memory (~10-50KB per socket)
//   - 10 components each opening their own connection = 10x the overhead
//   - One connection with per-symbol rooms achieves the same result at 10% cost
//   - Socket.io multiplexing: namespaces and rooms handle this natively

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";

let socket = null;

export function getSocket() {
  if (socket && socket.connected) {
    return socket;
  }

  if (!socket) {
    const token = getAccessToken();

    socket = io(SOCKET_URL, {
      auth: { token },
      autoConnect: true,
      // ── Reconnection Strategy ──────────────────────────────────────────
      // Exponential backoff with jitter:
      //   Attempt 1: 1000ms
      //   Attempt 2: 2000ms
      //   Attempt 3: 4000ms
      //   Attempt 4: 8000ms
      //   Attempt 5: 16000ms
      //   Attempt 6+: 30000ms (cap)
      //
      // Why backoff (not fixed interval)?
      //   - Fixed 1s retry: if the server is down for 60s, the client makes
      //     60 useless connection attempts — flooding server logs on restart
      //   - Exponential backoff: first retry is fast (1s — might be a brief
      //     network glitch), then backs off aggressively to avoid hammering
      //   - Jitter (random ±50%): prevents thundering herd when 10,000 clients
      //     all retry on the same schedule after a server restart
      //
      // Why not infinite retries?
      //   - Browser tabs left open for days would keep retrying forever
      //   - We cap at 30s and let the user refresh if the connection is truly dead
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5, // jitter: delay ±50%
    });

    socket.on("connect_error", (err) => {
      console.warn("[Socket] Connection error:", err.message);
    });
  }

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
}

// Allow token refresh without creating a new connection
export function updateSocketToken(newToken) {
  if (socket) {
    socket.auth.token = newToken;
    socket.disconnect().connect();
  }
}

// Clean up on app unmount (rarely needed, but good practice)
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
