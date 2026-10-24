import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// In dev, the Bun bridge (server/main.ts) runs on 8787; Vite proxies its WebSocket and API routes.
const bridge = `http://127.0.0.1:${process.env.NOA_GUI_PORT ?? 8787}`

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
