/**
 * Logo easter egg engine: a software-rendered 3D version of the banner logo.
 *
 * Each lit half-cell of the logo becomes a unit cube. The cubes fly in and
 * spin, shuffle around a 3D grid, and settle back into the logo. Every
 * terminal cell is drawn as a 2x4 braille dot grid, z-tested per dot.
 *
 * Modeled on the pi coding agent's logo egg: the screen it covers (an ANSI
 * snapshot of Ink's last frame) dissolves into braille dust on entry and
 * re-forms on exit.
 */

export type RGB = [number, number, number]
export type EggCell = { char: string; color: RGB; bg?: RGB }
export type EggScene = {
  render(width: number, height: number, seconds: number): (EggCell | null)[][]
  /** Starts the exit animation; a second call skips it. */
  close(seconds: number): void
  isDone(seconds: number): boolean
}

type Vec3 = [number, number, number]
type Block = { home: Vec3; color: RGB }
type Box = { min: Vec3; max: Vec3; color: RGB }
type Pose = { centerX: number; centerY: number; scale: number; yaw: number; pitch: number; roll: number }

const DEPTH = 0.7
const CAMERA_DISTANCE = 26
const WIDTH_SHARE = 0.5 // settled logo spans this share of the screen width
const HEIGHT_SHARE = 0.75 // ... or of the height above the hint, whichever is tighter
const MAX_PITCH = 0.3
/** Terminal colors the egg blends toward: text fades into `background`, stars and the hint mix from it. */
export type EggPalette = { background: RGB; foreground: RGB; muted: RGB }
export const DARK_PALETTE: EggPalette = { background: [38, 38, 38], foreground: [220, 220, 220], muted: [136, 136, 136] }
export const LIGHT_PALETTE: EggPalette = { background: [255, 255, 255], foreground: [40, 40, 40], muted: [120, 120, 120] }

// Timeline, in seconds from the start of the egg.
const FLY_START = 0.1
const FLY_DURATION = 1.3
const PUZZLE_START = FLY_START + FLY_DURATION + 3
const PUZZLE_STEP = 0.3
const PUZZLE_STEPS = 12
const PUZZLE_RETURN = 1
const PUZZLE_HOLD = 0.6
const PUZZLE_CYCLE = PUZZLE_STEP * PUZZLE_STEPS + PUZZLE_RETURN + PUZZLE_HOLD
const SPIN_RAMP = 1.4
const SPIN_SPEED = (Math.PI * 2) / PUZZLE_CYCLE
const SPIN_LINGER = 0.6
const FIRST_FRONT_VIEW = PUZZLE_START + PUZZLE_STEP * PUZZLE_STEPS + PUZZLE_RETURN + PUZZLE_HOLD / 2
const STARS_START = 2.5
const STARS_FADE = 2
const HINT_START = FLY_START + FLY_DURATION
const HINT_FADE = 0.5
const HINT_TEXT = 'escape to return'
// Screen text turns to dust in a wave spreading out from the logo.
const DUST_DURATION = 0.35
const WAVE_SPREAD = 0.55
const WAVE_JITTER = 0.12
const DISSOLVE_END = FLY_START + WAVE_SPREAD + WAVE_JITTER + DUST_DURATION
const TEXT_FADE = 0.6
const BACKGROUND_FADE = 0.5
// Light backgrounds only (as in pi): a soft tinted glow behind the logo, so pale
// braille dots on white still read as a solid shape. Dark backgrounds don't need it.
const HALO_STRENGTH = 0.3
const HALO_RADIUS_X = 6
const HALO_RADIUS_Y = 3
const HALO_LEVELS = 32
// Lit colors are snapped to this step so slow lighting changes don't restyle cells every frame.
const COLOR_STEP = 5
const EXIT_DURATION = 1.1

const STAR_DENSITY = 0.018
const STAR_TINTS: RGB[] = [
  [255, 255, 255],
  [170, 195, 255],
  [255, 225, 170],
  [255, 190, 205],
]
const DOT_BITS = [1, 8, 2, 16, 4, 32, 64, 128]
const BRAILLE = Array.from({ length: 256 }, (_, bits) => String.fromCharCode(0x2800 + bits))

// Light direction and half vector for the specular highlight (dark backgrounds only).
const LIGHT = normalize([-0.45, -0.6, 0.75])
const HALF_VECTOR = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1])

// Each terminal cell is shown as a 2x4 dot grid; this maps (dotY&3, dotX&1) to a braille bit.
const dotBit = (dotX: number, dotY: number) => DOT_BITS[(dotY & 3) * 2 + (dotX & 1)]!

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smooth(value: number): number {
  const t = clamp01(value)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function easeOut(value: number): number {
  const t = 1 - clamp01(value)
  return 1 - t * t * t
}

function mix(a: RGB, b: RGB, amount: number): RGB {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]
}

function hash(value: number): number {
  let x = Math.imul(value ^ 2654435769, 2246822507)
  x ^= x >>> 13
  x = Math.imul(x, 3266489909)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

// Row-major 3x3 rotation M = Rz * Rx * Ry.
function rotation(yaw: number, pitch: number, roll: number): number[] {
  const [sy, cy, sx, cx, sz, cz] = [Math.sin(yaw), Math.cos(yaw), Math.sin(pitch), Math.cos(pitch), Math.sin(roll), Math.cos(roll)]
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]
  return multiply(rz, multiply(rx, ry))
}

function multiply(a: number[], b: number[]): number[] {
  const result = new Array<number>(9)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      result[row * 3 + column] = a[row * 3]! * b[column]! + a[row * 3 + 1]! * b[3 + column]! + a[row * 3 + 2]! * b[6 + column]!
    }
  }
  return result
}

function baseSpinPhase(time: number): number {
  const elapsed = time - FLY_START
  if (elapsed <= 0) return 0
  const u = elapsed / SPIN_RAMP
  return u < 1
    ? SPIN_SPEED * SPIN_RAMP * (u ** 6 - 3 * u ** 5 + 2.5 * u ** 4)
    : SPIN_SPEED * (SPIN_RAMP * 0.5 + elapsed - SPIN_RAMP)
}

// Offsets the spin so the logo ends facing the viewer at FIRST_FRONT_VIEW.
const SPIN_ALIGNMENT = Math.PI * 2 - (baseSpinPhase(FIRST_FRONT_VIEW) % (Math.PI * 2))

function spinPhase(time: number): number {
  return baseSpinPhase(time) + SPIN_ALIGNMENT * smooth((time - FLY_START) / FLY_DURATION)
}

// The lingering term holds the logo a little longer at each facing.
function spinAngle(time: number): number {
  const phase = spinPhase(time)
  return phase - SPIN_LINGER * Math.sin(phase)
}

// Each puzzle step moves some blocks by one grid cell. A block that just moved
// is avoided next step, so the logo keeps rearranging instead of oscillating.
const PUZZLE_MOVES: Vec3[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
]

function shuffleSteps(blocks: Block[], columns: number, rows: number, cycle: number): Vec3[][] {
  let positions = blocks.map(block => block.home)
  const steps = [positions]
  let lastMoved = new Set<number>()
  let random = cycle * 7919 + 1
  const next = () => hash(random++)
  const key = ([x, y, z]: Vec3) => ((z + 1) * rows + y) * columns + x
  for (let step = 0; step < PUZZLE_STEPS; step++) {
    const occupied = new Set(positions.map(key))
    const nextPositions = [...positions]
    const moved = new Set<number>()
    const moveCount = Math.round(blocks.length * (0.04 + next() * 0.05))
    for (let move = 0; move < moveCount; move++) {
      const candidates: { block: number; target: Vec3 }[] = []
      positions.forEach((position, block) => {
        if (moved.has(block)) return
        const [x, y, z] = position
        for (const [dx, dy, dz] of PUZZLE_MOVES) {
          const target: Vec3 = [x + dx, y + dy, z + dz]
          const inside = target[0] >= 0 && target[0] < columns && target[1] >= 0 && target[1] < rows && target[2] >= -1 && target[2] <= 1
          if (inside && !occupied.has(key(target))) candidates.push({ block, target })
        }
      })
      const fresh = candidates.filter(candidate => !lastMoved.has(candidate.block))
      const pool = fresh.length > 0 ? fresh : candidates
      const choice = pool[Math.floor(next() * pool.length)]
      if (!choice) break
      occupied.add(key(choice.target))
      nextPositions[choice.block] = choice.target
      moved.add(choice.block)
    }
    lastMoved = moved
    positions = nextPositions
    steps.push(positions)
  }
  return steps
}

/** Projects a box face's corners and returns its bounding rect in dot space. */
function faceRect(m: number[], pose: Pose, corners: Vec3[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y, z] of corners) {
    const cx = m[0]! * x + m[1]! * y + m[2]! * z
    const cy = m[3]! * x + m[4]! * y + m[5]! * z
    const cz = m[6]! * x + m[7]! * y + m[8]! * z
    const perspective = (pose.scale * CAMERA_DISTANCE) / (CAMERA_DISTANCE - cz)
    const screenX = pose.centerX + cx * perspective
    const screenY = pose.centerY + cy * perspective
    minX = Math.min(minX, screenX)
    minY = Math.min(minY, screenY)
    maxX = Math.max(maxX, screenX)
    maxY = Math.max(maxY, screenY)
  }
  return { minX, minY, maxX, maxY }
}

type VisibleFace = {
  axis: number
  plane: number
  uRange: [number, number]
  vRange: [number, number]
  minX: number
  minY: number
  maxX: number
  maxY: number
  color: RGB
}

/** Faces of each box that face the camera, with their lit colors. */
// On a light background a white specular glint and bright rim read as holes, so
// light themes get flatter lighting with no specular (as pi does).
function visibleFaces(m: number[], origin: Vec3, pose: Pose, boxes: Box[], dotWidth: number, dotHeight: number, lightBackground: boolean): VisibleFace[] {
  const faces: VisibleFace[] = []
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3
      const v = (axis + 2) % 3
      for (const side of [-1, 1]) {
        const plane = side > 0 ? box.max[axis]! : box.min[axis]!
        // Skip faces pointing away from the camera, and faces covered by a
        // neighbour pressed flush against them: those sit on the seam at the
        // same depth as the front faces, and would win stray dots there.
        if ((origin[axis]! - plane) * side <= 0) continue
        const covered = boxes.some(
          other =>
            other !== box &&
            (side > 0 ? other.min[axis] : other.max[axis]) === plane &&
            other.min[u]! <= box.min[u]! &&
            other.max[u]! >= box.max[u]! &&
            other.min[v]! <= box.min[v]! &&
            other.max[v]! >= box.max[v]!,
        )
        if (covered) continue
        const corners: Vec3[] = []
        for (const cu of [box.min[u]!, box.max[u]!]) {
          for (const cv of [box.min[v]!, box.max[v]!]) {
            const corner: Vec3 = [0, 0, 0]
            corner[axis] = plane
            corner[u] = cu
            corner[v] = cv
            corners.push(corner)
          }
        }
        const rect = faceRect(m, pose, corners)
        const minX = Math.max(0, Math.floor(rect.minX))
        const minY = Math.max(0, Math.floor(rect.minY))
        const maxX = Math.min(dotWidth - 1, Math.ceil(rect.maxX))
        const maxY = Math.min(dotHeight - 1, Math.ceil(rect.maxY))
        if (maxX < minX || maxY < minY) continue

        // Face normal in camera space is column `axis` of M, flipped by side.
        const nx = m[axis]! * side
        const ny = m[3 + axis]! * side
        const nz = m[6 + axis]! * side
        const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2])
        const rim = Math.max(0, nx * 0.8 - nz * 0.3)
        const specular = lightBackground ? 0 : Math.max(0, nx * HALF_VECTOR[0] + ny * HALF_VECTOR[1] + nz * HALF_VECTOR[2]) ** 24 * 0.6 * 255
        const light = lightBackground ? Math.min(1, 0.55 + diffuse * 0.45 + rim * 0.1) : 0.45 + diffuse * 0.78 + rim * 0.25
        faces.push({
          axis,
          plane,
          uRange: [box.min[u]!, box.max[u]!],
          vRange: [box.min[v]!, box.max[v]!],
          minX,
          minY,
          maxX,
          maxY,
          color: [
            Math.min(255, box.color[0] * light + specular),
            Math.min(255, box.color[1] * light + specular),
            Math.min(255, box.color[2] * light + specular),
          ],
        })
      }
    }
  }
  return faces
}

/**
 * Ray-casts every dot against the faces and returns, per cell, the braille
 * bits and the averaged color of the dots that hit.
 */
function rasterize(faces: VisibleFace[], m: number[], origin: Vec3, pose: Pose, width: number, height: number, background: RGB, lightBackground: boolean) {
  const dotWidth = width * 2
  const dotHeight = height * 4
  const depth = new Float32Array(dotWidth * dotHeight).fill(Infinity)
  const faceIds = new Int32Array(dotWidth * dotHeight)
  faces.forEach((face, faceIndex) => {
    const a = face.axis
    const u = (a + 1) % 3
    const v = (a + 2) % 3
    for (let dotY = face.minY; dotY <= face.maxY; dotY++) {
      const sy = (dotY + 0.5 - pose.centerY) / pose.scale
      for (let dotX = face.minX; dotX <= face.maxX; dotX++) {
        const sx = (dotX + 0.5 - pose.centerX) / pose.scale
        // Ray through this dot, in model space: M^T * (sx, sy, -distance).
        const dir: Vec3 = [
          m[0]! * sx + m[3]! * sy - m[6]! * CAMERA_DISTANCE,
          m[1]! * sx + m[4]! * sy - m[7]! * CAMERA_DISTANCE,
          m[2]! * sx + m[5]! * sy - m[8]! * CAMERA_DISTANCE,
        ]
        const t = (face.plane - origin[a]!) / dir[a]!
        const index = dotY * dotWidth + dotX
        if (!(t > 0 && t < depth[index]!)) continue
        const hitU = origin[u]! + t * dir[u]!
        const hitV = origin[v]! + t * dir[v]!
        if (hitU < face.uRange[0]! || hitU > face.uRange[1]! || hitV < face.vRange[0]! || hitV > face.vRange[1]!) continue
        depth[index] = t
        faceIds[index] = faceIndex + 1
      }
    }
  })

  const bits = new Uint8Array(width * height)
  const counts = new Uint8Array(width * height)
  const sums = new Float32Array(width * height * 3)
  for (let dotY = 0; dotY < dotHeight; dotY++) {
    for (let dotX = 0; dotX < dotWidth; dotX++) {
      const index = dotY * dotWidth + dotX
      const id = faceIds[index]!
      if (id === 0) continue
      const face = faces[id - 1]!
      // Fade distant faces toward the background.
      const fog = clamp01(0.15 - CAMERA_DISTANCE * (1 - depth[index]!) * 0.12) * (lightBackground ? 0.5 : 1)
      const cell = (dotY >> 2) * width + (dotX >> 1)
      bits[cell] = bits[cell]! | dotBit(dotX, dotY)
      counts[cell] = counts[cell]! + 1
      for (let channel = 0; channel < 3; channel++) {
        sums[cell * 3 + channel] = sums[cell * 3 + channel]! + face.color[channel]! + (background[channel]! - face.color[channel]!) * fog
      }
    }
  }
  const colors = new Array<RGB | undefined>(width * height)
  for (let cell = 0; cell < width * height; cell++) {
    const count = counts[cell]!
    if (count === 0) continue
    const snap = (sum: number) => Math.round(sum / count / COLOR_STEP) * COLOR_STEP
    colors[cell] = [snap(sums[cell * 3]!), snap(sums[cell * 3 + 1]!), snap(sums[cell * 3 + 2]!)]
  }
  return { bits, counts, colors }
}

/**
 * Glow around the lit cells: a separable tent blur of dot coverage and color,
 * snapped to HALO_LEVELS so it only restyles cells when it visibly changes.
 * Returns a per-cell blend amount and color, or null when nothing is lit.
 */
function renderHalo(width: number, height: number, counts: Uint8Array, colors: (RGB | undefined)[], strength: number) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let cell = 0; cell < width * height; cell++) {
    if (counts[cell] === 0) continue
    const x = cell % width
    const y = Math.floor(cell / width)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (maxX < 0) return null
  const tent = (radius: number) => {
    const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => radius + 1 - Math.abs(i - radius))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    return weights.map(weight => weight / total)
  }
  const weightsX = tent(HALO_RADIUS_X)
  const weightsY = tent(HALO_RADIUS_Y)
  const regionMinX = Math.max(0, minX - HALO_RADIUS_X)
  const regionMaxX = Math.min(width - 1, maxX + HALO_RADIUS_X)
  const regionWidth = regionMaxX - regionMinX + 1
  // Horizontal pass over the lit rows: [coverage, r, g, b] per cell, color premultiplied by coverage.
  const horizontal = new Float32Array((maxY - minY + 1) * regionWidth * 4)
  for (let y = minY; y <= maxY; y++) {
    for (let x = regionMinX; x <= regionMaxX; x++) {
      const target = ((y - minY) * regionWidth + (x - regionMinX)) * 4
      for (let dx = -HALO_RADIUS_X; dx <= HALO_RADIUS_X; dx++) {
        const sourceX = x + dx
        if (sourceX < minX || sourceX > maxX) continue
        const source = y * width + sourceX
        const coverage = counts[source]! / 8
        if (coverage === 0) continue
        const weight = weightsX[dx + HALO_RADIUS_X]! * coverage
        const color = colors[source]!
        horizontal[target] = horizontal[target]! + weight
        horizontal[target + 1] = horizontal[target + 1]! + color[0] * weight
        horizontal[target + 2] = horizontal[target + 2]! + color[1] * weight
        horizontal[target + 3] = horizontal[target + 3]! + color[2] * weight
      }
    }
  }
  const amount = new Float32Array(width * height)
  const tint = new Array<RGB | undefined>(width * height)
  for (let y = Math.max(0, minY - HALO_RADIUS_Y); y <= Math.min(height - 1, maxY + HALO_RADIUS_Y); y++) {
    for (let x = regionMinX; x <= regionMaxX; x++) {
      let coverage = 0
      let red = 0
      let green = 0
      let blue = 0
      for (let dy = -HALO_RADIUS_Y; dy <= HALO_RADIUS_Y; dy++) {
        const sourceY = y + dy
        if (sourceY < minY || sourceY > maxY) continue
        const weight = weightsY[dy + HALO_RADIUS_Y]!
        const source = ((sourceY - minY) * regionWidth + (x - regionMinX)) * 4
        coverage += horizontal[source]! * weight
        red += horizontal[source + 1]! * weight
        green += horizontal[source + 2]! * weight
        blue += horizontal[source + 3]! * weight
      }
      if (coverage <= 0) continue
      const level = Math.round(strength * Math.min(1, coverage) ** 0.7 * HALO_LEVELS) / HALO_LEVELS
      if (level <= 0) continue
      const cell = y * width + x
      const snap = (sum: number) => Math.round(sum / coverage / COLOR_STEP) * COLOR_STEP
      amount[cell] = level
      tint[cell] = [snap(red), snap(green), snap(blue)]
    }
  }
  return { amount, tint }
}

type Star = { glyph: string; tint: RGB; strength: number; phase: number; speed: number }

function prepareStars(width: number, height: number): (Star | undefined)[] {
  const stars: (Star | undefined)[] = new Array(width * height)
  for (let index = 0; index < width * height; index++) {
    if (hash(index * 3 + 20973) >= STAR_DENSITY) continue
    const random = (salt: number) => hash(index * 7 + salt * 40503)
    stars[index] = {
      glyph: BRAILLE[DOT_BITS[Math.floor(random(1) * 8)]!]!,
      tint: STAR_TINTS[Math.floor(random(2) * STAR_TINTS.length)]!,
      strength: 0.1 + random(3) * 0.12,
      phase: random(4) * Math.PI * 2,
      speed: 0.4 + random(5) * 0.8,
    }
  }
  return stars
}

// How many braille dots a glyph turns into: punctuation is sparse, box drawing medium.
function glyphInk(text: string, seed: number): number {
  if (text.trim() === '') return 0
  if (/^[.,:;'`\-_·]$/.test(text)) return 2
  if (/^[\u2500-\u257f]$/.test(text)) return 3
  return 4 + Math.floor(seed * 3)
}

// xterm's 256-color palette; the first 16 are the common defaults.
const ANSI16: RGB[] = [
  [0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16], [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67], [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255],
]
function palette(index: number): RGB {
  if (index < 16) return ANSI16[index]!
  if (index < 232) {
    const n = index - 16
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return [level(Math.floor(n / 36)), level(Math.floor(n / 6) % 6), level(n % 6)]
  }
  const gray = 8 + (index - 232) * 10
  return [gray, gray, gray]
}

type ParsedCell = { text: string; width: number; fg: RGB; bg?: RGB }

/** Splits ANSI-styled lines into cells with resolved colors (dim and inverse applied). */
function parseAnsiLines(lines: string[], width: number, charWidth: (text: string) => number, colors: EggPalette): ParsedCell[][] {
  const { background: BACKGROUND, foreground: FOREGROUND } = colors
  const segmenter = new Intl.Segmenter()
  return lines.map(line => {
    const cells: ParsedCell[] = []
    let fg: RGB | undefined
    let bg: RGB | undefined
    let dim = false
    let inverse = false
    const applySgr = (params: string) => {
      const codes = params === '' ? ['0'] : params.split(';')
      for (let i = 0; i < codes.length; i++) {
        const parts = codes[i]!.split(':').map(part => Number.parseInt(part, 10))
        const code = parts[0] ?? 0
        if (code === 38 || code === 48) {
          let args: number[]
          if (parts.length > 1) args = parts.slice(1).filter(part => !Number.isNaN(part))
          else {
            const kind = Number.parseInt(codes[i + 1] ?? '', 10)
            const count = kind === 5 ? 2 : kind === 2 ? 4 : 1
            args = codes.slice(i + 1, i + 1 + count).map(part => Number.parseInt(part, 10))
            i += count
          }
          let color: RGB | undefined
          if (args[0] === 5 && args[1] !== undefined) color = palette(args[1])
          else if (args[0] === 2 && args.length >= 4) color = [args[1]!, args[2]!, args[3]!]
          if (color) {
            if (code === 38) fg = color
            else bg = color
          }
        } else if (code === 0) {
          fg = bg = undefined
          dim = inverse = false
        } else if (code === 2) dim = true
        else if (code === 22) dim = false
        else if (code === 7) inverse = true
        else if (code === 27) inverse = false
        else if (code >= 30 && code <= 37) fg = palette(code - 30)
        else if (code >= 90 && code <= 97) fg = palette(code - 90 + 8)
        else if (code === 39) fg = undefined
        else if (code >= 40 && code <= 47) bg = palette(code - 40)
        else if (code >= 100 && code <= 107) bg = palette(code - 100 + 8)
        else if (code === 49) bg = undefined
      }
    }
    const pushText = (text: string) => {
      for (const { segment } of segmenter.segment(text)) {
        const glyphWidth = charWidth(segment)
        if (glyphWidth === 0 || cells.length + glyphWidth > width) continue
        let cellFg = fg ?? FOREGROUND
        let cellBg = bg
        if (inverse) {
          cellFg = bg ?? BACKGROUND
          cellBg = fg ?? FOREGROUND
        }
        if (dim) cellFg = mix(cellFg, cellBg ?? BACKGROUND, 0.4)
        const cell = { text: segment, width: glyphWidth, fg: cellFg, bg: cellBg }
        cells.push(cell)
        if (glyphWidth === 2) cells.push({ ...cell, text: '', width: 0 })
      }
    }
    let i = 0
    while (i < line.length) {
      const start = line.indexOf('\x1b', i)
      if (start === -1) {
        pushText(line.slice(i))
        break
      }
      if (start > i) pushText(line.slice(i, start))
      const kind = line[start + 1]
      if (kind === '[') {
        let end = start + 2
        while (end < line.length && (line.charCodeAt(end) < 64 || line.charCodeAt(end) > 126)) end++
        if (line[end] === 'm') applySgr(line.slice(start + 2, end))
        i = end + 1
      } else if (kind === ']' || kind === '_' || kind === 'P' || kind === '^') {
        // OSC/APC/DCS/PM (e.g. hyperlinks): skip to BEL or ST.
        const bell = line.indexOf('\x07', start + 2)
        const st = line.indexOf('\x1b\\', start + 2)
        if (bell === -1 && st === -1) break
        i = bell !== -1 && (st === -1 || bell < st) ? bell + 1 : st + 2
      } else i = start + 2
    }
    return cells
  })
}

// A screen cell; a wide glyph is followed by a filler cell (width 0) sharing its owner's dust.
type ScreenCell = { text: string; width: number; color: RGB; bg?: RGB; delay: number; ink: number; seed: number }

/**
 * Builds the egg from the banner logo. Each lit half-cell becomes a cube of
 * one solid `color`: a per-cube gradient shows every seam as a color step.
 * `origin` is the screen cell of the logo's top-left corner, `screen` the
 * ANSI lines the egg covers, `charWidth` measures a grapheme in columns, and
 * `palette` holds the terminal colors to blend toward.
 */
export function createEggScene(
  logo: string[],
  color: RGB,
  origin: { column: number; row: number },
  screen: string[],
  charWidth: (text: string) => number,
  palette: EggPalette,
): EggScene {
  const { background: BACKGROUND, foreground: FOREGROUND, muted: MUTED } = palette
  // Rec. 709 luma: above mid-gray counts as a light background.
  const lightBackground = 0.2126 * BACKGROUND[0] + 0.7152 * BACKGROUND[1] + 0.0722 * BACKGROUND[2] > 128
  // Half-cell pixels: '█' lights both halves, '▀' the top, '▄' the bottom.
  const columns = logo[0]!.length
  const rows = logo.length * 2
  const blocks: Block[] = []
  logo.forEach((line, charRow) => {
    for (let col = 0; col < line.length; col++) {
      const char = line[col]
      const top = char === '█' || char === '▀'
      const bottom = char === '█' || char === '▄'
      if (top) blocks.push({ home: [col, charRow * 2, 0], color })
      if (bottom) blocks.push({ home: [col, charRow * 2 + 1, 0], color })
    }
  })
  // Half extents while spinning: yaw swings the width into depth, and pitch then
  // lifts it, so the vertical reach grows by the width times sin(pitch).
  const extentX = Math.hypot(columns / 2, 1 + DEPTH / 2)
  const extentY = rows / 2 + extentX * Math.sin(MAX_PITCH)
  const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - extentX)
  // At this scale the front face covers exactly the banner's logo cells.
  const startScale = (2 * (CAMERA_DISTANCE - DEPTH / 2)) / CAMERA_DISTANCE

  // The shuffle depends only on the cycle index, so cache the last one.
  let shuffleCache: { cycle: number; steps: Vec3[][] } | undefined
  let layoutCache: { width: number; height: number; stars: (Star | undefined)[]; cells: (ScreenCell | undefined)[][] } | undefined
  let exit: { start: number; time: number; yaw: number; targetYaw: number; offsets: Vec3[]; skipped: boolean } | undefined

  function blockOffsets(time: number): Vec3[] {
    const zero = blocks.map((): Vec3 => [0, 0, 0])
    if (time < PUZZLE_START) return zero
    const cycle = Math.floor((time - PUZZLE_START) / PUZZLE_CYCLE)
    const local = time - PUZZLE_START - cycle * PUZZLE_CYCLE
    if (shuffleCache?.cycle !== cycle) {
      shuffleCache = { cycle, steps: shuffleSteps(blocks, columns, rows, cycle) }
    }
    const steps = shuffleCache.steps
    const offset = (position: Vec3, index: number): Vec3 => {
      const home = blocks[index]!.home
      return [position[0] - home[0], position[1] - home[1], position[2] - home[2]]
    }
    const shuffleEnd = PUZZLE_STEP * PUZZLE_STEPS
    if (local < shuffleEnd) {
      const step = Math.floor(local / PUZZLE_STEP)
      const progress = smooth((local - step * PUZZLE_STEP) / PUZZLE_STEP)
      return steps[step]!.map((from, index) => {
        const a = offset(from, index)
        const b = offset(steps[step + 1]![index]!, index)
        return [a[0] + (b[0] - a[0]) * progress, a[1] + (b[1] - a[1]) * progress, a[2] + (b[2] - a[2]) * progress]
      })
    }
    if (local < shuffleEnd + PUZZLE_RETURN) {
      // Blocks slide home, arcing forward and back in z so they don't pass through each other.
      const u = (local - shuffleEnd) / PUZZLE_RETURN
      const remaining = 1 - smooth(u)
      const arc = Math.sin(Math.PI * clamp01(u)) * 0.8
      return steps[PUZZLE_STEPS]!.map((position, index) => {
        const [x, y, z] = offset(position, index)
        return [x * remaining, y * remaining, z * remaining + (index % 2 === 0 ? arc : -arc)]
      })
    }
    return zero
  }

  const flyProgress = (time: number) => smooth((time - FLY_START) / FLY_DURATION)
  const starAlpha = (time: number) => smooth((time - STARS_START) / STARS_FADE)
  const hintAlpha = (time: number) => smooth((time - HINT_START) / HINT_FADE)
  const exitProgress = (seconds: number) => (exit ? (exit.skipped ? 1 : clamp01((seconds - exit.start) / EXIT_DURATION)) : 0)

  function pose(width: number, height: number, progress: number, time: number): Pose {
    const fitX = (width * WIDTH_SHARE) / (extentX * perspective)
    const fitY = ((height * 2 - 4) * HEIGHT_SHARE) / (extentY * perspective)
    const endScale = Math.max(startScale, Math.min(fitX, fitY))
    const endX = width
    const endY = height * 2 - 4
    const startX = origin.column * 2 + columns
    const startY = origin.row * 4 + rows
    const spin = spinPhase(time)
    return {
      centerX: startX + (endX - startX) * progress,
      centerY: startY + (endY - startY) * progress,
      scale: startScale * (endScale / startScale) ** progress,
      yaw: spinAngle(time),
      pitch: MAX_PITCH * Math.sin(spin) * progress,
      roll: 0.06 * Math.sin(2 * spin) * progress,
    }
  }

  // Lays the banner text out in cells and gives each a dust delay that grows
  // with its distance from the logo.
  function prepareCells(width: number, height: number): (ScreenCell | undefined)[][] {
    const parsed = parseAnsiLines(screen.slice(0, height), width, charWidth, palette)
    const cells: (ScreenCell | undefined)[][] = Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, column) => {
        const cell = parsed[row]?.[column]
        return cell && { text: cell.text, width: cell.width, color: cell.fg, bg: cell.bg, delay: 0, ink: 0, seed: 0 }
      }),
    )
    // The logo's own blocks become the 3D model, so drop them from the text.
    logo.forEach((text, row) => {
      for (let column = 0; column < text.length; column++) {
        const line = cells[origin.row + row]
        if (line && /[█▀▄]/.test(text[column]!)) line[origin.column + column] = undefined
      }
    })
    const centerX = origin.column + columns / 2
    const centerY = origin.row + rows / 4
    const farthest = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY) * 2)
    cells.forEach((line, row) => {
      line.forEach((cell, column) => {
        if (!cell) return
        const owner = cell.width === 0 ? line[column - 1]! : cell
        const seed = hash(row * 65537 + column)
        cell.delay = cell.width === 0 ? owner.delay : FLY_START + (Math.hypot(column - centerX, (row - centerY) * 2) / farthest) * WAVE_SPREAD + seed * WAVE_JITTER
        cell.seed = row * 65537 + column
        cell.ink = glyphInk(owner.text, seed)
      })
    })
    return cells
  }

  return {
    close(seconds) {
      if (exit) {
        exit.skipped = true
        return
      }
      // Land on the next whole turn so the logo faces front when it arrives.
      const yaw = spinAngle(seconds)
      const turn = Math.PI * 2
      exit = { start: seconds, time: seconds, yaw, targetYaw: Math.ceil(yaw / turn) * turn, offsets: blockOffsets(seconds), skipped: false }
    },

    isDone(seconds) {
      return exit !== undefined && exitProgress(seconds) >= 1
    },

    render(width, height, seconds) {
      let dissolveTime: number
      let p: Pose
      let hint: number
      let stars: number
      let offsets: Vec3[]
      if (exit) {
        // Unwind everything from the moment of closing: the spin lands, the
        // blocks gather, the logo flies home, and the text re-forms.
        const progress = exitProgress(seconds)
        const landing = clamp01(progress / 0.8)
        const settle = 1 - smooth(landing)
        dissolveTime = Math.min(exit.time, DISSOLVE_END) * (1 - progress)
        p = pose(width, height, flyProgress(exit.time) * settle, exit.time)
        p.yaw = exit.yaw + (exit.targetYaw - exit.yaw) * easeOut(landing)
        p.pitch *= settle
        p.roll *= settle
        hint = hintAlpha(exit.time) * (1 - smooth(progress / 0.2))
        stars = starAlpha(exit.time) * (1 - smooth(progress / 0.3))
        const gather = 1 - smooth(progress / 0.5)
        offsets = exit.offsets.map(([x, y, z]): Vec3 => [x * gather, y * gather, z * gather])
      } else {
        dissolveTime = seconds
        p = pose(width, height, flyProgress(seconds), seconds)
        hint = hintAlpha(seconds)
        stars = starAlpha(seconds)
        offsets = blockOffsets(seconds)
      }

      const boxes: Box[] = blocks.map((block, index) => {
        const [dx, dy, dz] = offsets[index]!
        const x = block.home[0] - columns / 2 + dx
        const y = block.home[1] - rows / 2 + dy
        return { min: [x, y, dz - DEPTH / 2], max: [x + 1, y + 1, dz + DEPTH / 2], color: block.color }
      })
      const m = rotation(p.yaw, p.pitch, p.roll)
      const camera: Vec3 = [m[6]! * CAMERA_DISTANCE, m[7]! * CAMERA_DISTANCE, m[8]! * CAMERA_DISTANCE]
      const faces = visibleFaces(m, camera, p, boxes, width * 2, height * 4, lightBackground)
      const { bits, counts, colors } = rasterize(faces, m, camera, p, width, height, BACKGROUND, lightBackground)
      const halo = lightBackground ? renderHalo(width, height, counts, colors, HALO_STRENGTH) : null

      if (!layoutCache || layoutCache.width !== width || layoutCache.height !== height) {
        layoutCache = { width, height, stars: prepareStars(width, height), cells: prepareCells(width, height) }
      }
      const starLevel = Math.round(stars * 8) / 8
      const hintRow = height - 2
      const hintStart = Math.floor((width - HINT_TEXT.length) / 2)
      const showHint = hint > 0 && HINT_TEXT.length <= width
      const backgroundFade = smooth(dissolveTime / BACKGROUND_FADE)
      const textActive = dissolveTime < DISSOLVE_END || backgroundFade < 1
      const textFade = smooth(dissolveTime / TEXT_FADE) * 0.3
      const frame = Math.floor(dissolveTime * 14)

      const starAt = (index: number): EggCell | null => {
        const star = layoutCache!.stars[index]
        if (!star || starLevel <= 0) return null
        const flicker = Math.round((0.5 + 0.5 * Math.sin(seconds * star.speed + star.phase)) * 3) / 3
        const strength = star.strength * (0.7 + 0.3 * flicker) * starLevel
        return { char: star.glyph, color: mix(BACKGROUND, mix(FOREGROUND, star.tint, 0.5), strength) }
      }

      const lines: (EggCell | null)[][] = []
      for (let row = 0; row < height; row++) {
        const line: (EggCell | null)[] = []
        const cellRow = layoutCache.cells[row]!
        for (let column = 0; column < width; column++) {
          const index = row * width + column
          if (showHint && row === hintRow && column >= hintStart && column < hintStart + HINT_TEXT.length) {
            line.push({ char: HINT_TEXT[column - hintStart]!, color: mix(BACKGROUND, MUTED, hint) })
            continue
          }
          const dots = bits[index]!
          if (dots) {
            line.push({ char: BRAILLE[dots]!, color: colors[index]! })
            continue
          }
          const cell = textActive ? cellRow[column] : undefined
          // Cell backgrounds (selection, inverse text) fade out on their own clock.
          const bg = cell?.bg && backgroundFade < 1 ? mix(cell.bg, BACKGROUND, backgroundFade) : undefined
          const withBg = (out: EggCell | null): EggCell | null => (bg ? { char: out?.char ?? ' ', color: out?.color ?? BACKGROUND, bg } : out)
          if (!cell) {
            line.push(starAt(index))
            continue
          }
          const dust = (dissolveTime - cell.delay) / DUST_DURATION
          if (dust < 0) {
            const color = mix(cell.color, BACKGROUND, textFade)
            // A wide glyph prints whole unless the logo covers its right half.
            if (cell.width === 2 && !bits[index + 1]) {
              line.push(withBg({ char: cell.text, color }), withBg({ char: '', color }))
              column++
              continue
            }
            if (cell.width === 1) {
              line.push(withBg({ char: cell.text, color }))
              continue
            }
          }
          const dotCount = dust < 0 ? cell.ink : Math.round(cell.ink * (1 - clamp01(dust)))
          if (dotCount <= 0) {
            line.push(withBg(starAt(index)))
            continue
          }
          let dustBits = 0
          let placed = 0
          for (let attempt = 0; placed < dotCount && attempt < 32; attempt++) {
            const bit = DOT_BITS[Math.floor(hash(cell.seed * 7919 + frame * 131 + attempt) * 8)]!
            if (!(dustBits & bit)) {
              dustBits |= bit
              placed++
            }
          }
          const fade = textFade + (1 - textFade) * clamp01(dust) ** 0.8
          line.push(withBg({ char: BRAILLE[dustBits]!, color: mix(cell.color, BACKGROUND, fade) }))
        }
        if (halo) {
          // Lay the glow under whatever the cell shows, over any background it already has.
          line.forEach((out, column) => {
            const index = row * width + column
            const level = halo.amount[index]!
            if (level <= 0) return
            const bg = mix(out?.bg ?? BACKGROUND, halo.tint[index]!, level)
            line[column] = { char: out?.char ?? ' ', color: out?.color ?? BACKGROUND, bg }
          })
        }
        lines.push(line)
      }
      return lines
    },
  }
}
