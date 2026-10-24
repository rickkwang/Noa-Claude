import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// In dev, the Bun bridge (server/main.ts) runs on 8787; Vite proxies its WebSocket and API routes.
const bridge = "http://localhost:8787"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: bridge.replace("http", "ws"), ws: true },
      "/api": { target: bridge },
    },
  },
})
