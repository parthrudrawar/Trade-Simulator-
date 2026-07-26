import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api, setAccessToken, clearAccessToken } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const refreshRes = await api.post("/auth/refresh");
      if (!refreshRes) {
        clearAccessToken();
        setUser(null);
        return;
      }

      setAccessToken(refreshRes.accessToken);

      const meRes = await api.get("/auth/me");
      setUser(meRes.user);
    } catch {
      clearAccessToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    setAccessToken(res.accessToken);
    setUser(res.user);
    return res;
  }, []);

  const signup = useCallback(async (data) => {
    const res = await api.post("/auth/signup", data);
    setAccessToken(res.accessToken);
    setUser(res.user);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      clearAccessToken();
      setUser(null);
    }
  }, []);

  const value = { user, loading, login, signup, logout, setUser, refreshUser };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
