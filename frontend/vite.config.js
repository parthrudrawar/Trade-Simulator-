import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/auth": { target: "http://localhost:3001", changeOrigin: true },
      "/market": { target: "http://localhost:3001", changeOrigin: true },
      "/orders": { target: "http://localhost:3001", changeOrigin: true },
      "/watchlists": { target: "http://localhost:3001", changeOrigin: true },
      "/alerts": { target: "http://localhost:3001", changeOrigin: true },
      "/analytics": { target: "http://localhost:3001", changeOrigin: true },
      "/health": { target: "http://localhost:3001", changeOrigin: true },
      "/rag": { target: "http://localhost:3002", changeOrigin: true },
    },
  },
});
