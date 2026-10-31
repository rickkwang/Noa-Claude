import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles/noa.css"
import { trackScrollActivity } from "./scrollActivity"

// Inside the Electron shell the titlebar is hidden-inset: Noa's CSS reads data-desktop to clear the traffic lights.
if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "true"

trackScrollActivity()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
