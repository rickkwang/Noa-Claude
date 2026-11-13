// Dot-matrix fill for the highest effort level. Small rounded cells: a charge tint that deepens toward the thumb, and
// lit cells whose brightness snaps to a 5-step ramp. On reveal a wavefront races out from the thumb; afterwards each
// cell keeps pulsing on its own clock — a quick arrival flash, an afterglow, and a fresh draw of which cells light up —
// so the mosaic never freezes. Colors derive from the theme's accent.

const CELL_PITCH = 5
const CELL_SIZE = 3.75
const CELL_R = 1.1
const SPEED = 29 // wavefront speed, cells/sec
const RANGE = 72 // cells from the thumb the field carries
const DENSITY = 0.85 // fraction of cells lit per pulse
const JITTER = 0.1 // per-cell arrival scatter, sec
const PULSE = 1.4 // seconds between pulses, per cell
const HEAD_GAIN = 1.25
const HEAD_DECAY = 5
const BODY_GAIN = 0.65
const BODY_DECAY = 0.77
const STEPS = [0.04, 0.2, 0.4, 0.6, 0.8]
const RAMP_POW = 1.4
const BREATH_DIP = 0.28
const BREATH_BASE = 2.4
const BREATH_VARY = 1.4
// Light themes lay the charge as a continuous ground (gaps included) and paint every lit cell near-solid, carrying the
// ramp in color; dark themes keep the charge inside the cells and let alpha carry the ramp.
const MODES = {
  light: { bedFill: true, chargeMax: 1, chargeRamp: 0.35, inkFloor: 0.28, inkCeil: 1, gain: 1.6 },
  dark: { bedFill: false, chargeMax: 0.85, chargeRamp: 1.1, inkFloor: 0.08, inkCeil: 0.85, gain: 1 },
}
const FALLBACK_ACCENT = [217, 119, 87]

function hash(x: number, y: number, salt: number) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function mixRgb(a: number[], b: number[], t: number) {
  return a.map((v, i) => Math.round(v + (b[i]! - v) * t))
}

// Rotates a color's hue by `degrees`, keeping its lightness and saturation.
function rotateHue([r, g, b]: number[], degrees: number) {
  const [rn, gn, bn] = [r! / 255, g! / 255, b! / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return [r!, g!, b!]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  h = (h * 60 + degrees + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r1, g1, b1].map((v) => Math.round((v + m) * 255))
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

// The canvas normalizes any CSS color it accepts to #rrggbb (or rgba() when translucent).
function parseColor(ctx: CanvasRenderingContext2D, value: string) {
  ctx.fillStyle = "#000"
  ctx.fillStyle = value
  const normalized = String(ctx.fillStyle)
  if (normalized.startsWith("#") && normalized.length === 7) {
    return [1, 3, 5].map((i) => parseInt(normalized.slice(i, i + 2), 16))
  }
  const rgb = normalized.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number)
  return rgb?.length === 3 ? rgb : FALLBACK_ACCENT
}

/**
 * Draws into a fresh canvas appended to `host`; returns a stop function. `reveal` plays the wavefront from the thumb;
 * otherwise the field starts fully lit. A still frame is drawn when `still` is set.
 */
export function startEffortPixelGrid(host: HTMLElement, still: boolean, reveal: boolean): (() => void) | undefined {
  if (typeof ResizeObserver === "undefined") return
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  host.append(canvas)
  const origin = performance.now()
  const playReveal = reveal && !still
  let width = 1
  let height = 1
  let frame = 0
  let mode = MODES.light
  let chargeFrom = FALLBACK_ACCENT
  let chargeTo = FALLBACK_ACCENT
  let inkCool = FALLBACK_ACCENT
  let inkHot = FALLBACK_ACCENT
  let tintA = FALLBACK_ACCENT
  let tintB = FALLBACK_ACCENT

  const cell = (x: number, y: number, size: number, r: number, rgb: number[], alpha: number) => {
    ctx.fillStyle = `rgba(${rgb.join(", ")}, ${alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.roundRect(x, y, size, size, r)
    ctx.fill()
  }

  const draw = (t: number) => {
    ctx.clearRect(0, 0, width, height)
    // Whole rows tile the height; cells stay square, so the right edge (under the thumb) absorbs a partial column.
    const rows = Math.max(Math.round(height / CELL_PITCH), 1)
    const pitch = height / rows
    const scale = pitch / CELL_PITCH
    const size = CELL_SIZE * scale
    const r = CELL_R * scale
    const inset = (pitch - size) / 2
    const cols = Math.ceil(width / pitch)
    const originCol = cols - 1
    const originRow = Math.floor(rows / 2)
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * pitch + inset
      const g = Math.min(((cx + 0.5) * pitch) / width, 1)
      const charge = mixRgb(chargeFrom, chargeTo, g)
      // Whole-pixel tile edges so a continuous ground has no seams between neighbours.
      const tileX = Math.round(cx * pitch)
      const tileW = Math.round((cx + 1) * pitch) - tileX
      for (let cy = 0; cy < rows; cy++) {
        const y = cy * pitch + inset
        const manh = Math.abs(originCol - cx) + Math.abs(originRow - cy)
        const jitter = (hash(cx, cy, 41) - 0.5) * 2 * JITTER
        // Time since the reveal front reached this cell; without a reveal every cell is already lit.
        const since = playReveal ? t - manh / SPEED - jitter : t + PULSE
        if (since < 0) continue
        const charged = smoothstep(0, 0.15, since)
        const chargeA = mode.chargeMax * Math.pow(g, mode.chargeRamp) * charged
        if (chargeA > 0.005) {
          if (mode.bedFill) {
            const tileY = Math.round(cy * pitch)
            ctx.fillStyle = `rgba(${charge.join(", ")}, ${chargeA.toFixed(3)})`
            ctx.fillRect(tileX, tileY, tileW, Math.round((cy + 1) * pitch) - tileY)
          } else {
            cell(x, y, size, r, charge, chargeA)
          }
        }

        // The first pulse is the reveal front's arrival; later pulses run on a per-cell phase so they never sync up.
        let beat = 0
        let age = since
        if (since >= PULSE) {
          const s = since - PULSE + hash(cx, cy, 6) * PULSE
          beat = 1 + Math.floor(s / PULSE)
          age = s - (beat - 1) * PULSE
        }
        if (hash(cx, cy, 7 + beat * 0.37) > DENSITY) continue
        const falloff = Math.exp(-manh / (RANGE * 0.85))
        const vary = 0.35 + 0.65 * hash(cx, cy, 13)
        // Afterglow stacks across every earlier pulse (a geometric series), so the field stays lit between flashes.
        const carry = Math.exp(-PULSE * BODY_DECAY)
        const body = (BODY_GAIN * Math.exp(-age * BODY_DECAY) * (1 - Math.pow(carry, beat + 1))) / (1 - carry)
        const energy = (HEAD_GAIN * Math.exp(-age * HEAD_DECAY) + body) * falloff * vary
        // Each cell drifts between two personal brightness levels on its own slow cycle.
        const lumA = hash(cx, cy, 8)
        const lumB = hash(cx, cy, 88)
        const drift = 0.5 + 0.5 * Math.sin(t * 0.35 + lumA * 6.2832)
        const lum = Math.pow(lumA + (lumB - lumA) * drift, 1.9)
        // A faint wave keeps drifting along the bar with a little per-cell scatter.
        const stream = 0.9 + 0.16 * Math.sin(t * 1.3 + cx * 0.45 + lumB * 2)
        const e = Math.min(energy, 1) * (0.16 + 0.84 * lum) * stream * mode.gain
        let level = 0
        for (const step of STEPS) if (e >= step) level++
        if (!level) continue
        let alpha = mode.inkFloor + ((mode.inkCeil - mode.inkFloor) * (level - 1)) / 4
        // Only top-step cells breathe: slow, shallow, never in unison.
        if (level === 5) {
          const period = BREATH_BASE + BREATH_VARY * hash(cx, cy, 3)
          alpha *= 1 - BREATH_DIP * 0.5 * (1 + Math.sin((t * 6.2832) / period + hash(cx, cy, 5) * 6.2832))
        }
        let ink = mixRgb(inkCool, inkHot, Math.pow(level / 5, RAMP_POW))
        // Hue scatter: a minority of cells lean toward each neighbouring hue so the field reads rich, not monochrome.
        const hueSel = hash(cx, cy, 27.9)
        ink = mixRgb(ink, tintA, 0.55 * smoothstep(0.62, 0.95, hueSel))
        ink = mixRgb(ink, tintB, 0.55 * (1 - smoothstep(0.05, 0.38, hueSel)))
        cell(x, y, size, r, ink, alpha)
      }
    }
  }
  const resize = () => {
    const style = getComputedStyle(host)
    const accent = parseColor(ctx, style.getPropertyValue("--accent-color").trim())
    const dark = document.documentElement.dataset.theme === "dark"
    mode = dark ? MODES.dark : MODES.light
    // The charge deepens from the accent toward the thumb; lit cells climb from a light accent tint to near white
    // (dark themes: from white to the primary text color).
    chargeFrom = accent
    chargeTo = mixRgb(accent, [0, 0, 0], dark ? 0.42 : 0.36)
    inkCool = dark ? [255, 255, 255] : mixRgb(accent, [255, 255, 255], 0.12)
    inkHot = dark ? parseColor(ctx, style.getPropertyValue("--text-primary").trim() || "#fff") : mixRgb(accent, [255, 255, 255], 0.92)
    tintA = mixRgb(rotateHue(accent, 35), [255, 255, 255], 0.35)
    tintB = mixRgb(rotateHue(accent, -35), [255, 255, 255], 0.35)
    const ratio = Math.min(window.devicePixelRatio, 2)
    const rect = canvas.getBoundingClientRect()
    width = Math.max(rect.width, 1)
    height = Math.max(rect.height, 1)
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    draw(still ? 0 : (performance.now() - origin) / 1000)
  }
  const tick = (now: number) => {
    draw((now - origin) / 1000)
    frame = requestAnimationFrame(tick)
  }
  const observer = new ResizeObserver(resize)
  resize()
  observer.observe(canvas)
  // Theme and accent live on the root element; re-read colors when either changes.
  const themeObserver = new MutationObserver(resize)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] })
  if (!still) frame = requestAnimationFrame(tick)
  return () => {
    if (frame) cancelAnimationFrame(frame)
    observer.disconnect()
    themeObserver.disconnect()
    canvas.remove()
  }
}
