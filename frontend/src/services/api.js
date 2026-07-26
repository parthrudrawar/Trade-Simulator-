// Use VITE_API_URL if set (production), otherwise empty = same origin (Vite proxy)
const RAW_BASE = import.meta.env.VITE_API_URL || "";
const HAS_ABSOLUTE_BASE = RAW_BASE.length > 0;

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
}

function buildUrl(endpoint, params) {
  if (HAS_ABSOLUTE_BASE) {
    const url = new URL(`${RAW_BASE}${endpoint}`);
    if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    return url.toString();
  }
  // Relative URL - will go through Vite proxy
  let url = endpoint;
  if (params) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && sp.set(k, v));
    const qs = sp.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

async function request(endpoint, options = {}) {
  const { method = "GET", body, params, headers: extraHeaders, raw } = options;

  const url = buildUrl(endpoint, params);

  const headers = { ...extraHeaders };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: "include", // Include cookies for refresh token
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });

  // Auto-refresh on 401 (skip for auth endpoints — their own 401/errors
  // must propagate to the caller without interference).
  const isAuthEndpoint = endpoint.startsWith("/auth/");
  if (res.status === 401 && !isAuthEndpoint) {
    if (!refreshPromise) {
      const refreshUrl = buildUrl("/auth/refresh");
      refreshPromise = fetch(refreshUrl, {
        method: "POST",
        credentials: "include",
      }).finally(() => {
        refreshPromise = null;
      });
    }

    const refreshRes = await refreshPromise;

    if (refreshRes.ok) {
      const data = await refreshRes.json();
      accessToken = data.accessToken;
      headers["Authorization"] = `Bearer ${accessToken}`;

      // Retry original request
      const retryRes = await fetch(url, {
        method,
        headers,
        credentials: "include",
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      });

      if (raw) return retryRes;
      const json = await retryRes.json();
      if (!retryRes.ok) throw new Error(json.error || json.message || "Request failed");
      return json;
    }

    // Refresh failed — clear token, don't redirect (caller decides)
    accessToken = null;
    throw new Error("Session expired");
  }

  if (raw) return res;
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || json.message || "Request failed");
  return json;
}

export const api = {
  get: (endpoint, options) => request(endpoint, { ...options, method: "GET" }),
  post: (endpoint, body, options) => request(endpoint, { ...options, method: "POST", body }),
  put: (endpoint, body, options) => request(endpoint, { ...options, method: "PUT", body }),
  delete: (endpoint, options) => request(endpoint, { ...options, method: "DELETE" }),
};
