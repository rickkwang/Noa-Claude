import { useEffect, useRef } from "react"

// 80-point Fibonacci sphere for #62 Surface Light-Wave Globe.
const SPHERE_POINTS = Array.from({ length: 80 }, (_, i) => {
  const y = 1 - (i / 79) * 2
  const r = Math.sqrt(1 - y * y)
  const theta = i * Math.PI * (3 - Math.sqrt(5))
  return [Math.cos(theta) * r, y, Math.sin(theta) * r] as const
})

export function WorkingOrb({ size = 16, className = "" }: { size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const px = Math.round(size * dpr)
    canvas.width = px
    canvas.height = px

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const center = px / 2
    const scale = px * 0.36
    const dist = 3.4
    const tilt = 0.35
    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)

    let rafId = 0
    const draw = (now: number) => {
      const t = reducedMotion ? 0 : now * 0.001
      const cosY = Math.cos(t * 0.85)
      const sinY = Math.sin(t * 0.85)
      ctx.fillStyle = getComputedStyle(canvas).color

      ctx.clearRect(0, 0, px, px)

      const projected = SPHERE_POINTS.map(([px0, py0, pz0]) => {
        const x1 = px0 * cosY + pz0 * sinY
        const z1 = -px0 * sinY + pz0 * cosY
        const y2 = py0 * cosT - z1 * sinT
        const z2 = py0 * sinT + z1 * cosT
        const f = dist / (dist - z2)
        const wave = 0.5 + 0.5 * Math.sin(x1 * 3.2 - t * 3.8)
        return [center + x1 * scale * f, center + y2 * scale * f, z2, wave] as const
      }).sort((a, b) => a[2] - b[2])

      for (const [x, y, z, wave] of projected) {
        const k = Math.max(0, (z + 1) / 2)
        const alpha = 0.06 + k * (0.28 + 0.67 * wave)
        const radius = (0.34 + k * (0.22 + 0.32 * wave)) * dpr
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (!reducedMotion) {
        rafId = requestAnimationFrame(draw)
      }
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, [size])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
