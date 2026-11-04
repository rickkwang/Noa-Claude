import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// In dev, the Bun bridge (server/main.ts) runs on 8787; Vite proxies its WebSocket and API routes.
const bridge = `http://127.0.0.1:${process.env.NOA_GUI_PORT ?? 8787}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Lowering `||=` for an es2020 target drops the variable it assigns (esbuild minify), which breaks xterm's
  // DECRQM reply and freezes the terminal; every supported runtime has logical assignment.
  build: { target: "es2022" },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: bridge.replace("http", "ws"), ws: true },
      "/terminal": { target: bridge.replace("http", "ws"), ws: true },
      "/api": { target: bridge },
    },
  },
})
