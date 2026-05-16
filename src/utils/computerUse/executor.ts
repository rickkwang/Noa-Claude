/**
 * macOS desktop control via cliclick + AppleScript + screencapture.
 *
 * Self-contained — no external @ant/* package required. Exposes flat async
 * functions consumed by ComputerTool. Keyboard shortcuts use System Events;
 * pixel mouse operations and fast ASCII typing use cliclick (`brew install
 * cliclick`); screenshots use `screencapture` piped through `sips` for
 * resizing.
 *
 * Concurrency: every native call (cliclick + osascript) is serialized through
 * an internal queue to avoid interleaved modifier press/release sequences.
 */

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { sleep } from '../sleep.js'
import {
  appIdentityMatches,
  expandAppIdentityCandidates,
  type AppIdentity,
} from './appIdentity.js'

// ── Public types ─────────────────────────────────────────────────────────────

export type DisplayGeometry = {
  id: number
  x: number
  y: number
  width: number    // logical points
  height: number   // logical points
  scaleFactor: number
  estimated?: boolean
}

export type ScreenshotResult = {
  base64: string
  width: number
  height: number
}

export type ReadinessOptions = {
  text?: string
  viaClipboard?: boolean
}

// Screenshot target size. 1568×980 keeps small UI text legible while staying
// inside Claude's vision-token budget. Aspect ratio is preserved; never upscale.
const MAX_SHOT_WIDTH = 1568
const MAX_SHOT_HEIGHT = 980

function targetImageSize(physW: number, physH: number): [number, number] {
  const scale = Math.min(MAX_SHOT_WIDTH / physW, MAX_SHOT_HEIGHT / physH, 1)
  return [Math.round(physW * scale), Math.round(physH * scale)]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MOVE_SETTLE_MS = 80
const CLICLICK_TIMEOUT_MS = 5_000
const OSASCRIPT_TIMEOUT_MS = 5_000
const SYSPROFILER_TIMEOUT_MS = 8_000
const DISPLAYS_TTL_MS = 10_000
const JXA_TIMEOUT_MS = 5_000
const SCREENSHOT_CONTEXT_TTL_MS = 2 * 60_000

const MOD_MAP: Record<string, string> = {
  command: 'cmd', cmd: 'cmd', meta: 'cmd', super: 'cmd',
  option: 'alt', alt: 'alt',
  control: 'ctrl', ctrl: 'ctrl',
  shift: 'shift',
  fn: 'fn',
}

const KEY_NAME_MAP: Record<string, string> = {
  up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right',
  return: 'return', enter: 'return',
  escape: 'esc', esc: 'esc',
  tab: 'tab', space: 'space',
  delete: 'delete', backspace: 'delete',
  forwarddelete: 'fwd-delete', 'fwd-delete': 'fwd-delete',
  home: 'home', end: 'end',
  pageup: 'page-up', pagedown: 'page-down',
  'page-up': 'page-up', 'page-down': 'page-down',
  f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5', f6: 'f6',
  f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10', f11: 'f11', f12: 'f12',
  f13: 'f13', f14: 'f14', f15: 'f15', f16: 'f16',
}

const APPLESCRIPT_MODIFIER_MAP: Record<string, string> = {
  cmd: 'command down',
  alt: 'option down',
  ctrl: 'control down',
  shift: 'shift down',
}

const APPLESCRIPT_KEY_CODE_MAP: Record<string, number> = {
  'arrow-left': 123,
  'arrow-right': 124,
  'arrow-down': 125,
  'arrow-up': 126,
  return: 36,
  enter: 76,
  esc: 53,
  tab: 48,
  space: 49,
  delete: 51,
  'fwd-delete': 117,
  home: 115,
  end: 119,
  'page-up': 116,
  'page-down': 121,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  f13: 105,
  f14: 107,
  f15: 113,
  f16: 106,
}

// ── Serialization ────────────────────────────────────────────────────────────

let opQueue: Promise<unknown> = Promise.resolve()
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = opQueue.then(fn, fn)
  opQueue = next.catch(() => undefined)
  return next
}

// ── cliclick wrapper ─────────────────────────────────────────────────────────

let cliclickMissingWarned = false

async function cliclick(...args: string[]): Promise<string> {
  return serialize(() => cliclickRaw(args))
}

async function cliclickRaw(args: string[]): Promise<string> {
  const { stdout, code, error } = await execFileNoThrow('cliclick', args, {
    useCwd: false,
    timeout: CLICLICK_TIMEOUT_MS,
  })
  if (code !== 0) {
    const isMissing = /ENOENT|not found|No such file/i.test(
      `${error ?? ''} ${stdout ?? ''}`,
    )
    if (isMissing) {
      if (!cliclickMissingWarned) {
        cliclickMissingWarned = true
        logForDebugging(
          '[computer-use] cliclick not found. Install with: brew install cliclick',
          { level: 'error' },
        )
      }
      throw new Error(
        'cliclick is required for computer use. Install with: brew install cliclick',
      )
    }
    throw new Error(
      `cliclick ${args.join(' ')} failed (${code}): ${error || stdout}`,
    )
  }
  return stdout.trim()
}

async function execOsascript(
  script: string,
): Promise<{ stdout: string; code: number; error?: string }> {
  return serialize(() => execOsascriptRaw(script))
}

async function execOsascriptRaw(
  script: string,
): Promise<{ stdout: string; code: number; error?: string }> {
  const { stdout, code, error, stderr } = await execFileNoThrow('osascript', ['-e', script], {
    useCwd: false,
    timeout: OSASCRIPT_TIMEOUT_MS,
  })
  return { stdout: stdout.trim(), code, error: error || stderr }
}

async function execJxa(
  script: string,
): Promise<{ stdout: string; code: number; error?: string }> {
  return serialize(() => execJxaRaw(script))
}

async function execJxaRaw(
  script: string,
): Promise<{ stdout: string; code: number; error?: string }> {
  const { stdout, code, error, stderr } = await execFileNoThrow(
    'osascript',
    ['-l', 'JavaScript', '-e', script],
    { useCwd: false, timeout: JXA_TIMEOUT_MS },
  )
  return { stdout: stdout.trim(), code, error: error || stderr }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapModifier(name: string): string | undefined {
  return MOD_MAP[name.toLowerCase()]
}

function mapNamedKey(name: string): string | undefined {
  return KEY_NAME_MAP[name.toLowerCase()]
}

async function withModifiers<T>(
  mods: string[],
  fn: () => Promise<T>,
): Promise<T> {
  if (mods.length === 0) return fn()
  await cliclick(`kd:${mods.join(',')}`)
  try {
    return await fn()
  } finally {
    await cliclick(`ku:${mods.join(',')}`)
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

// Readiness probes are cached on success for the lifetime of the process —
// cliclick install, Accessibility grant, and Screen Recording grant don't get
// revoked silently mid-session. Failures are NOT cached: the user may grant
// the permission and retry without restarting Noa.
let cliclickInstalledCache: boolean | undefined
let accessibilityGrantedCache: boolean | undefined
let screenRecordingGrantedCache: boolean | undefined

export async function checkCliclickInstalled(): Promise<boolean> {
  if (cliclickInstalledCache === true) return true
  const { code } = await execFileNoThrow('which', ['cliclick'], {
    useCwd: false,
  })
  const ok = code === 0
  if (ok) cliclickInstalledCache = true
  return ok
}

export async function checkAccessibility(): Promise<boolean> {
  if (accessibilityGrantedCache === true) return true
  const { stdout, code } = await execJxa(
    "ObjC.import('ApplicationServices'); $.AXIsProcessTrusted() ? 'true' : 'false'",
  )
  if (code !== 0) return false
  const ok = stdout.trim() === 'true'
  if (ok) accessibilityGrantedCache = true
  return ok
}

export async function checkScreenRecording(): Promise<boolean> {
  if (screenRecordingGrantedCache === true) return true
  const dir = await fs.mkdtemp(join(tmpdir(), 'cu-probe-'))
  const out = join(dir, 'probe.png')
  try {
    const { code } = await execFileNoThrow(
      'screencapture',
      ['-x', '-R', '0,0,1,1', '-t', 'png', out],
      { useCwd: false },
    )
    if (code !== 0) return false
    const ok = await isReadablePng(out)
    if (ok) screenRecordingGrantedCache = true
    return ok
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function checkComputerUseReadiness(
  action: string,
  options: ReadinessOptions = {},
): Promise<{ ok: true } | { ok: false; message: string; errorCode: number }> {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      message: 'Computer use is only supported on macOS in this implementation.',
      errorCode: 10,
    }
  }

  if (needsCliclick(action, options) && !(await checkCliclickInstalled())) {
    return {
      ok: false,
      message:
        'Computer use input requires cliclick. Install it with: brew install cliclick',
      errorCode: 11,
    }
  }

  if (needsAccessibility(action) && !(await checkAccessibility())) {
    return {
      ok: false,
      message:
        'Computer use input requires macOS Accessibility permission for the app running Noa. Enable it in System Settings > Privacy & Security > Accessibility, then retry.',
      errorCode: 12,
    }
  }

  if (needsScreenRecording(action) && !(await checkScreenRecording())) {
    return {
      ok: false,
      message:
        'Computer use screenshot requires macOS Screen Recording permission for the app running Noa. Enable it in System Settings > Privacy & Security > Screen Recording, then retry.',
      errorCode: 13,
    }
  }

  return { ok: true }
}

function needsScreenRecording(action: string): boolean {
  return action === 'screenshot'
}

function needsCliclick(action: string, options: ReadinessOptions): boolean {
  if (action === 'key') return false
  if (action === 'type') {
    return !(options.viaClipboard || containsNonAscii(options.text ?? ''))
  }
  return [
    'click',
    'scroll',
    'drag',
    'cursor_position',
  ].includes(action)
}

function needsAccessibility(action: string): boolean {
  return [
    'click',
    'type',
    'key',
    'scroll',
    'drag',
    'cursor_position',
    'frontmost_app',
    'menu_click',
  ].includes(action)
}

// Display enumeration ─────────────────────────────────────────────────────────

let displaysCache: { at: number; value: DisplayGeometry[] } | undefined

export async function listDisplays(): Promise<DisplayGeometry[]> {
  const now = Date.now()
  if (displaysCache && now - displaysCache.at < DISPLAYS_TTL_MS) {
    return displaysCache.value
  }
  const value = await readDisplaysFromSystemProfiler()
  displaysCache = { at: now, value }
  return value
}

async function readDisplaysFromSystemProfiler(): Promise<DisplayGeometry[]> {
  const appKitDisplays = await readDisplaysFromAppKit()
  if (appKitDisplays.length > 0) {
    return appKitDisplays
  }

  const { stdout, code } = await execFileNoThrow(
    'system_profiler',
    ['SPDisplaysDataType', '-json'],
    { useCwd: false, timeout: SYSPROFILER_TIMEOUT_MS },
  )
  const fallback: DisplayGeometry[] = [
    { id: 1, x: 0, y: 0, width: 1440, height: 900, scaleFactor: 2, estimated: true },
  ]
  if (code !== 0) return fallback
  try {
    const data = JSON.parse(stdout)
    const groups = data?.SPDisplaysDataType ?? []
    const all: Record<string, unknown>[] = groups.flatMap(
      (g: Record<string, unknown>) =>
        (g?.spdisplays_ndrvs as Record<string, unknown>[]) ?? [],
    )
    const displays: DisplayGeometry[] = []
    all.forEach((d, i) => {
      const physStr = String(d['_spdisplays_pixels'] ?? '')
      const logStr = String(
        d['spdisplays_resolution'] ?? d['_spdisplays_resolution'] ?? '',
      )
      const phys = physStr.match(/(\d+)\s*x\s*(\d+)/)
      const log = logStr.match(/(\d+)\s*x\s*(\d+)/)
      if (!phys && !log) return
      const physW = phys ? parseInt(phys[1]!, 10) : parseInt(log![1]!, 10)
      const physH = phys ? parseInt(phys[2]!, 10) : parseInt(log![2]!, 10)
      const logW = log ? parseInt(log[1]!, 10) : physW
      const logH = log ? parseInt(log[2]!, 10) : physH
      const scaleFactor =
        logW > 0 && physW > 0
          ? Math.max(1, Math.round((physW / logW) * 100) / 100)
          : /retina/i.test(JSON.stringify(d))
            ? 2
            : 1
      displays.push({ id: i + 1, x: 0, y: 0, width: logW, height: logH, scaleFactor })
    })
    return displays.length > 0 ? displays : fallback
  } catch {
    return fallback
  }
}

async function readDisplaysFromAppKit(): Promise<DisplayGeometry[]> {
  const script = `
ObjC.import('AppKit')
const screens = $.NSScreen.screens
const out = []
for (let i = 0; i < screens.count; i++) {
  const screen = screens.objectAtIndex(i)
  const frame = screen.frame
  out.push({
    id: i + 1,
    x: Number(frame.origin.x),
    y: Number(frame.origin.y),
    width: Math.round(Number(frame.size.width)),
    height: Math.round(Number(frame.size.height)),
    scaleFactor: Number(screen.backingScaleFactor)
  })
}
JSON.stringify(out)
`
  const { stdout, code } = await execJxa(script)
  if (code !== 0 || !stdout) return []
  try {
    const parsed = JSON.parse(stdout)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((d, i) => ({
        id: Number.isFinite(d.id) ? d.id : i + 1,
        x: Math.round(Number(d.x) || 0),
        y: Math.round(Number(d.y) || 0),
        width: Math.round(Number(d.width)),
        height: Math.round(Number(d.height)),
        scaleFactor: Number(d.scaleFactor) || 1,
      }))
      .filter(
        d =>
          Number.isFinite(d.width) &&
          Number.isFinite(d.height) &&
          d.width > 0 &&
          d.height > 0,
      )
  } catch {
    return []
  }
}

// Screenshot ─────────────────────────────────────────────────────────────────

// State for image↔logical coordinate translation. Updated on every successful
// screenshot. click()/drag()/scroll() use this to convert image-space coords
// (what the model sees) into the logical pixel coords cliclick expects.
// Coordinate actions require a recent screenshot so stale/unknown mappings
// do not silently become wrong clicks.
let lastShot: {
  at: number
  displayId: number
  imageW: number
  imageH: number
  logicalX: number
  logicalY: number
  logicalW: number
  logicalH: number
} | undefined

export function hasRecentScreenshotContext(): boolean {
  return getRecentScreenshotContext() !== undefined
}

function getRecentScreenshotContext(): typeof lastShot {
  if (!lastShot) return undefined
  if (Date.now() - lastShot.at > SCREENSHOT_CONTEXT_TTL_MS) {
    lastShot = undefined
    return undefined
  }
  return lastShot
}

// Any mutating coordinate action (click/scroll/drag) invalidates the cached
// screenshot context: after the action the visible UI has likely changed, so
// the next coord-based action must be grounded in a fresh screenshot rather
// than reusing the prior image's pixel positions.
function invalidateScreenshotContext(): void {
  lastShot = undefined
}

function toLogical(x: number, y: number): { x: number; y: number } {
  const s = getRecentScreenshotContext()
  if (!s) {
    throw new Error(
      'No recent screenshot context is available. Take a screenshot before using image-space coordinates.',
    )
  }
  return {
    x: Math.round(s.logicalX + (x * s.logicalW) / s.imageW),
    y: Math.round(s.logicalY + (y * s.logicalH) / s.imageH),
  }
}

export async function screenshot(displayId?: number): Promise<ScreenshotResult> {
  const displays = await listDisplays()
  const id = displayId ?? displays[0]?.id ?? 1
  const display = displays.find(d => d.id === id) ?? displays[0]

  const dir = await fs.mkdtemp(join(tmpdir(), 'cu-shot-'))
  const raw = join(dir, 'raw.png')
  const resized = join(dir, 'resized.png')
  try {
    const args = ['-x', '-t', 'png']
    args.push('-D', String(id))
    args.push(raw)
    const { code, error } = await execFileNoThrow('screencapture', args, {
      useCwd: false,
    })
    if (code !== 0) {
      throw new Error(
        `screencapture failed. macOS Screen Recording permission is probably missing for the app running Noa. Original error: ${error ?? 'unknown error'}`,
      )
    }
    const rawDims = await readImageDimensions(raw)
    const [targetW, targetH] = targetImageSize(rawDims.width, rawDims.height)
    const { code: sipsCode, error: sipsErr } = await execFileNoThrow(
      'sips',
      ['-z', String(targetH), String(targetW), raw, '--out', resized],
      { useCwd: false },
    )
    if (sipsCode !== 0) throw new Error(`sips failed: ${sipsErr}`)
    const buf = await fs.readFile(resized)
    const displayForShot = resolveDisplayForScreenshot(rawDims, display, displays)
    const logical = logicalSizeForScreenshot(rawDims, displayForShot)
    lastShot = {
      at: Date.now(),
      displayId: id,
      imageW: targetW,
      imageH: targetH,
      logicalX: logical.x,
      logicalY: logical.y,
      logicalW: logical.width,
      logicalH: logical.height,
    }
    return { base64: buf.toString('base64'), width: targetW, height: targetH }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function isReadablePng(path: string): Promise<boolean> {
  try {
    const header = await fs.readFile(path)
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    if (
      header.length < pngSignature.length ||
      !header.subarray(0, pngSignature.length).equals(pngSignature)
    ) {
      return false
    }
    const dims = await readImageDimensions(path)
    return dims.width > 0 && dims.height > 0
  } catch {
    return false
  }
}

async function readImageDimensions(
  path: string,
): Promise<{ width: number; height: number }> {
  const { stdout, code, error } = await execFileNoThrow(
    'sips',
    ['-g', 'pixelWidth', '-g', 'pixelHeight', path],
    { useCwd: false },
  )
  if (code !== 0) throw new Error(`sips metadata failed: ${error}`)
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1])
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1])
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Could not read screenshot dimensions from sips output.`)
  }
  return { width, height }
}

function logicalSizeForScreenshot(
  rawDims: { width: number; height: number },
  display?: DisplayGeometry,
): { x: number; y: number; width: number; height: number } {
  if (display && !display.estimated) {
    return {
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
    }
  }

  const scaleFactor = inferScaleFactor(rawDims)
  return {
    x: 0,
    y: 0,
    width: Math.round(rawDims.width / scaleFactor),
    height: Math.round(rawDims.height / scaleFactor),
  }
}

function resolveDisplayForScreenshot(
  rawDims: { width: number; height: number },
  requested: DisplayGeometry | undefined,
  displays: readonly DisplayGeometry[],
): DisplayGeometry | undefined {
  const exactMatches = displays.filter(display => {
    const physW = Math.round(display.width * display.scaleFactor)
    const physH = Math.round(display.height * display.scaleFactor)
    return physW === rawDims.width && physH === rawDims.height
  })
  if (exactMatches.length === 1) return exactMatches[0]
  return requested
}

function inferScaleFactor(rawDims: { width: number; height: number }): number {
  // Best-effort fallback for environments where NSScreen/system_profiler cannot
  // enumerate displays. Built-in Retina captures are typically >2500 px wide;
  // normal external displays usually map 1:1.
  return rawDims.width >= 2500 || rawDims.height >= 1600 ? 2 : 1
}

// Mouse ──────────────────────────────────────────────────────────────────────

export async function moveMouse(x: number, y: number): Promise<void> {
  const p = toLogical(x, y)
  await cliclick(`m:${p.x},${p.y}`)
  await sleep(MOVE_SETTLE_MS)
}

export async function click(
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  count: 1 | 2 | 3 = 1,
  modifiers: string[] = [],
): Promise<void> {
  const { x: cx, y: cy } = toLogical(x, y)
  const mods = modifiers
    .map(mapModifier)
    .filter((m): m is string => Boolean(m))
  await withModifiers(mods, async () => {
    if (button === 'right') {
      await cliclick(`rc:${cx},${cy}`)
    } else if (count === 2) {
      await cliclick(`dc:${cx},${cy}`)
    } else if (count === 3) {
      await cliclick(`tc:${cx},${cy}`)
    } else {
      await cliclick(`c:${cx},${cy}`)
    }
  })
  await sleep(80)
  invalidateScreenshotContext()
}

export async function drag(
  from: { x: number; y: number } | undefined,
  to: { x: number; y: number },
): Promise<void> {
  // `from` (when provided) is in image space — convert. Cursor position read
  // from cliclick is already in logical space, pass through.
  const startLogical = from
    ? toLogical(from.x, from.y)
    : await getCursorPosition()
  const endLogical = toLogical(to.x, to.y)
  await cliclick(`dd:${startLogical.x},${startLogical.y}`)
  try {
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = Math.round(startLogical.x + (endLogical.x - startLogical.x) * t)
      const y = Math.round(startLogical.y + (endLogical.y - startLogical.y) * t)
      await cliclick(`dm:${x},${y}`)
      await sleep(16)
    }
  } finally {
    await cliclick(`du:${endLogical.x},${endLogical.y}`)
    invalidateScreenshotContext()
  }
}

export async function getCursorPosition(): Promise<{ x: number; y: number }> {
  const stdout = await cliclick('p')
  const [xs, ys] = stdout.split(',')
  const x = parseInt(xs?.trim() ?? '', 10)
  const y = parseInt(ys?.trim() ?? '', 10)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Unparseable cursor position: ${JSON.stringify(stdout)}`)
  }
  return { x, y }
}

export async function scroll(
  x: number,
  y: number,
  direction: 'up' | 'down',
  amount: number,
): Promise<void> {
  const p = toLogical(x, y)
  await cliclick(`m:${p.x},${p.y}`)
  await sleep(MOVE_SETTLE_MS)
  const lines = Math.min(50, Math.max(1, Math.round(amount)))
  const delta = direction === 'down' ? -lines : lines
  try {
    await scrollWheel(delta)
  } catch (error) {
    logForDebugging(
      `[computer-use] native scroll failed; falling back to arrow keys: ${String(error)}`,
      { level: 'warn' },
    )
    const key = direction === 'down' ? 'arrow-down' : 'arrow-up'
    for (let i = 0; i < lines; i++) {
      await cliclick(`kp:${key}`)
    }
  }
  invalidateScreenshotContext()
}

async function scrollWheel(deltaLines: number): Promise<void> {
  const script = `
ObjC.import('CoreGraphics')
const ev = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 1, ${Math.trunc(deltaLines)})
if (!ev) throw new Error('CGEventCreateScrollWheelEvent returned null')
$.CGEventPost($.kCGHIDEventTap, ev)
'ok'
`
  const { code, error } = await execJxa(script)
  if (code !== 0) {
    throw new Error(error || 'JXA scroll event failed')
  }
}

// Keyboard ───────────────────────────────────────────────────────────────────

export async function key(keySequence: string, repeat = 1): Promise<void> {
  for (let i = 0; i < repeat; i++) {
    if (i > 0) await sleep(8)
    await pressKeySequence(keySequence)
  }
}

async function pressKeySequence(keySequence: string): Promise<void> {
  const parts = keySequence.split('+').filter(Boolean)
  const mods: string[] = []
  let keyPart: string | undefined
  for (const p of parts) {
    const m = mapModifier(p)
    if (m) mods.push(m)
    else keyPart = p
  }
  if (!keyPart) {
    if (mods.length > 0) {
      await cliclick(`kd:${mods.join(',')}`)
      await cliclick(`ku:${mods.join(',')}`)
    }
    return
  }
  await pressKeyWithSystemEvents(keyPart, mods)
}

async function pressKeyWithSystemEvents(
  rawKey: string,
  mods: string[],
): Promise<void> {
  const named = mapNamedKey(rawKey)
  const key = named ?? rawKey.toLowerCase()
  const modifierList = mods
    .map(mod => APPLESCRIPT_MODIFIER_MAP[mod])
    .filter((mod): mod is string => Boolean(mod))
  const usingClause =
    modifierList.length > 0 ? ` using {${modifierList.join(', ')}}` : ''
  const keyCode = APPLESCRIPT_KEY_CODE_MAP[key]
  // System Events `keystroke` drops or corrupts non-ASCII characters (CJK,
  // emoji, accented latin) — same reason `type` auto-routes via clipboard.
  // Reject early instead of pressing a key that silently does the wrong thing.
  // Length test uses code-point count (not UTF-16 units) so single emoji,
  // which are surrogate pairs (rawKey.length === 2 in UTF-16), are correctly
  // recognised as one character that the keystroke path cannot synthesize.
  if (keyCode === undefined && containsNonAscii(rawKey)) {
    const codePointCount = [...rawKey].length
    if (codePointCount === 1) {
      throw new Error(
        `Cannot press non-ASCII key "${rawKey}" via System Events keystroke. Use the \`type\` action with via_clipboard: true to insert this character.`,
      )
    }
  }

  const command =
    keyCode !== undefined
      ? `key code ${keyCode}${usingClause}`
      : rawKey.length === 1
        ? `keystroke "${escapeAppleScriptString(rawKey)}"${usingClause}`
        : null

  if (command === null) {
    throw new Error(`Unknown key "${rawKey}". Use a named key or single character.`)
  }

  const { code, error } = await execOsascript(
    `tell application "System Events" to ${command}`,
  )
  if (code !== 0) {
    throw new Error(`System Events key ${rawKey} failed: ${error}`)
  }
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// Anything outside printable ASCII (incl. CJK, emoji, accented Latin) is not
// reliably synthesized through cliclick's keystroke path. Force the clipboard
// route so the caller doesn't have to remember `via_clipboard: true` every
// time — the prompt already says "use clipboard for non-ASCII", this just
// makes the safe behavior the default.
function containsNonAscii(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(text)
}

export async function type(
  text: string,
  opts: { viaClipboard?: boolean } = {},
): Promise<void> {
  if (opts.viaClipboard || containsNonAscii(text)) {
    await typeViaClipboard(text)
    return
  }
  // cliclick `t:` stops at the first newline, so split and inject Return
  // between segments. Preserves an explicit trailing newline.
  const segments = text.split('\n')
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    if (seg.length > 0) await cliclick(`t:${seg}`)
    if (i < segments.length - 1) await cliclick('kp:return')
  }
}

async function typeViaClipboard(text: string): Promise<void> {
  // If `the clipboard as record` errors (rare: promised file references,
  // missing scripting additions), we leave the user's clipboard alone — that
  // means our pasted text stays as the new clipboard, but wiping it to "" was
  // strictly worse: it both lost the original AND removed any chance for the
  // user to recover what we just pasted. Same logic on restore failure.
  const script = `
set __noaClipboardBackup to missing value
set __noaHadClipboardBackup to false
try
  set __noaClipboardBackup to the clipboard as record
  set __noaHadClipboardBackup to true
end try
set the clipboard to ${appleScriptStringLiteral(text)}
set __noaPasteError to missing value
try
  tell application "System Events" to keystroke "v" using command down
  delay 0.1
on error __noaErrorMessage number __noaErrorNumber
  set __noaPasteError to {__noaErrorMessage, __noaErrorNumber}
end try
if __noaHadClipboardBackup then
  try
    set the clipboard to __noaClipboardBackup
  end try
end if
if __noaPasteError is not missing value then
  error (item 1 of __noaPasteError) number (item 2 of __noaPasteError)
end if
`
  const { code, error } = await execOsascript(script)
  if (code !== 0) {
    throw new Error(`Clipboard paste failed: ${error || 'unknown error'}`)
  }
}

function appleScriptStringLiteral(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n')
  return normalized
    .split('\n')
    .map(part => `"${escapeAppleScriptString(part)}"`)
    .join(' & linefeed & ')
}

// Clipboard ──────────────────────────────────────────────────────────────────

export async function readClipboard(): Promise<string> {
  const { stdout, code } = await execFileNoThrow('pbpaste', [], {
    useCwd: false,
  })
  if (code !== 0) throw new Error(`pbpaste exited with code ${code}`)
  return stdout
}

export async function writeClipboard(text: string): Promise<void> {
  const { code } = await execFileNoThrow('pbcopy', [], {
    input: text,
    useCwd: false,
  })
  if (code !== 0) throw new Error(`pbcopy exited with code ${code}`)
}

// App management ─────────────────────────────────────────────────────────────

const OPEN_APP_READY_TIMEOUT_MS = 1_800
const OPEN_APP_POLL_INTERVAL_MS = 120

export async function openApp(bundleIdOrName: string): Promise<void> {
  const candidates = expandAppIdentityCandidates(bundleIdOrName)
  let lastError: string | undefined

  for (const candidate of candidates) {
    const byBundle = await execFileNoThrow('open', ['-b', candidate], {
      useCwd: false,
    })
    if (byBundle.code === 0) {
      invalidateScreenshotContext()
      await waitForFrontmostApp(bundleIdOrName, OPEN_APP_READY_TIMEOUT_MS)
      return
    }
    lastError = byBundle.error
  }

  for (const candidate of candidates) {
    const byName = await execFileNoThrow('open', ['-a', candidate], {
      useCwd: false,
    })
    if (byName.code === 0) {
      invalidateScreenshotContext()
      await waitForFrontmostApp(bundleIdOrName, OPEN_APP_READY_TIMEOUT_MS)
      return
    }
    lastError = byName.error ?? lastError
  }

  throw new Error(
    `Could not open app "${bundleIdOrName}": ${lastError || 'unknown error'}`,
  )
}

async function waitForFrontmostApp(
  expectedApp: string,
  timeoutMs: number,
): Promise<boolean> {
  // Changing the frontmost app makes any cached screenshot stale — a subsequent
  // click using coords from the previous app's screenshot would target the
  // wrong UI. Force the model to re-screenshot before its next coord action.
  invalidateScreenshotContext()

  // Poll until the requested app is actually frontmost (or timeout). Without
  // this, callers have to follow every open_app with a manual wait + frontmost
  // check before doing anything else. Alias-aware matching handles bundle ids,
  // localized names, and app rename drift (for example WeChat/Weixin/微信).
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const front = await getFrontmostApp()
    if (front && appIdentityMatches(front, expectedApp)) {
      return true
    }
    await sleep(OPEN_APP_POLL_INTERVAL_MS)
  }
  // Don't throw on timeout: some launchers (LSOpenURLsWithRole, login items)
  // take longer than our window. The model can verify with frontmost_app or
  // just proceed — failure to focus surfaces in the next action.
  return false
}

export async function activateApp(bundleIdOrName: string): Promise<void> {
  const candidates = expandAppIdentityCandidates(bundleIdOrName)
  let lastError: string | undefined

  for (const candidate of candidates) {
    if (!looksLikeBundleId(candidate)) continue
    const escaped = escapeAppleScriptString(candidate)
    const byId = await execOsascript(
      `tell application id "${escaped}" to activate`,
    )
    if (byId.code === 0) {
      await waitForFrontmostApp(bundleIdOrName, OPEN_APP_READY_TIMEOUT_MS)
      return
    }
    lastError = byId.error
  }

  for (const candidate of candidates) {
    const escaped = escapeAppleScriptString(candidate)
    const byName = await execOsascript(`tell application "${escaped}" to activate`)
    if (byName.code === 0) {
      await waitForFrontmostApp(bundleIdOrName, OPEN_APP_READY_TIMEOUT_MS)
      return
    }
    lastError = byName.error ?? lastError
  }

  throw new Error(
    `Could not activate app "${bundleIdOrName}": ${lastError || 'unknown error'}`,
  )
}

function looksLikeBundleId(value: string): boolean {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(value)
}

// AppleScript / UI scripting ─────────────────────────────────────────────────

const APPLE_SCRIPT_TIMEOUT_MS = 15_000
const APPLE_SCRIPT_MAX_OUTPUT_CHARS = 8_000

export async function runAppleScript(script: string): Promise<string> {
  // Larger timeout than execOsascript's 5s — scripts often query app state
  // (calendar events, mail messages) which can legitimately take longer.
  // Run through the serialization queue so it doesn't interleave with cliclick
  // modifier-key sequences.
  return serialize(async () => {
    // An AppleScript may have activated an app, sent a message, opened a
    // window, or otherwise changed the visible UI. Invalidate up-front (in
    // a finally), so that timeouts and partial failures don't leave stale
    // coordinates around: a script that opened a sheet and then errored is
    // exactly the case where stale lastShot would cause a wrong-target click.
    // The cost (pure data queries pay one extra screenshot) is the same as
    // the success path that was previously invalidating only on success.
    try {
      const { stdout, code, error, stderr } = await execFileNoThrow(
        'osascript',
        ['-e', script],
        { useCwd: false, timeout: APPLE_SCRIPT_TIMEOUT_MS },
      )
      if (code !== 0) {
        throw new Error(
          `osascript failed (${code}): ${(error || stderr || '').trim() || 'unknown error'}`,
        )
      }
      const trimmed = stdout.trim()
      // Soft cap on output size: a script like "get every event of calendar X"
      // can return tens of KB and blow the model's context in one call. If the
      // caller actually needs the full set, they can chunk the query.
      if (trimmed.length > APPLE_SCRIPT_MAX_OUTPUT_CHARS) {
        const head = trimmed.slice(0, APPLE_SCRIPT_MAX_OUTPUT_CHARS)
        const extra = trimmed.length - APPLE_SCRIPT_MAX_OUTPUT_CHARS
        return `${head}\n…[truncated ${extra} more chars; narrow the AppleScript query (e.g. add a date/count filter) to see the rest]`
      }
      return trimmed
    } finally {
      invalidateScreenshotContext()
    }
  })
}

export async function clickMenu(
  app: string,
  path: readonly string[],
): Promise<void> {
  if (path.length === 0) {
    throw new Error('clickMenu: path must contain at least the menu bar item')
  }
  if (path.length === 1) {
    throw new Error(
      'clickMenu: path needs the menu bar item plus at least one menu item (e.g. ["Edit", "Find"])',
    )
  }
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const bar = path[0]!
  const item = path[path.length - 1]!
  const intermediates = path.slice(1, -1)

  // Build from innermost out:
  //   click menu item "item" of menu 1 of menu item "sub2" of menu 1 of menu item "sub1" of menu 1 of menu bar item "bar" of menu bar 1
  let chain = `menu bar item "${escape(bar)}" of menu bar 1`
  for (const sub of intermediates) {
    chain = `menu item "${escape(sub)}" of menu 1 of ${chain}`
  }
  const command = `click menu item "${escape(item)}" of menu 1 of ${chain}`

  // The macOS process name often differs from the user-visible display name
  // and from bundle ids (e.g. WeChat ↔ "Weixin", NetEase ↔ "NeteaseMusic").
  // Try the alias-expanded candidate set, but only the *name-shaped* ones —
  // System Events `process "<x>"` matches process name, never bundle id.
  // Bundle-id-shaped candidates are filtered out so we don't waste a probe
  // on `process "com.tencent.xinWeChat"` which can never match.
  const candidates = expandAppIdentityCandidates(app).filter(
    candidate => !looksLikeBundleId(candidate),
  )
  const tried: string[] = candidates.length > 0 ? candidates : [app]
  let lastError: string | undefined

  // Must run through serialize(): clickMenu drives System Events keystrokes
  // internally and can race with cliclick modifier press/release sequences.
  // Invalidate up-front (finally): even on a mid-traversal failure the menu
  // may have opened, animated, or partially navigated, so any cached
  // screenshot is no longer trustworthy.
  const succeeded = await serialize(async () => {
    try {
      for (const candidate of tried) {
        const existsScript = `tell application "System Events" to exists process "${escape(candidate)}"`
        const {
          stdout: existsStdout,
          code: existsCode,
          error: existsError,
          stderr: existsStderr,
        } = await execFileNoThrow(
          'osascript',
          ['-e', existsScript],
          { useCwd: false, timeout: OSASCRIPT_TIMEOUT_MS },
        )
        if (existsCode !== 0) {
          lastError = (
            existsError ||
            existsStderr ||
            'unknown error'
          ).trim()
          return false
        }
        if (existsStdout.trim().toLowerCase() !== 'true') {
          lastError = `process "${candidate}" is not running`
          continue
        }

        const script = `tell application "System Events" to tell process "${escape(candidate)}" to ${command}`
        const { code, error, stderr } = await execFileNoThrow(
          'osascript',
          ['-e', script],
          { useCwd: false, timeout: OSASCRIPT_TIMEOUT_MS },
        )
        if (code === 0) return true
        lastError = `process "${candidate}" exists but menu command failed: ${(
          error ||
          stderr ||
          'unknown error'
        ).trim()}`
        // Once System Events confirms the process exists, a click failure is a
        // real menu-path/accessibility/state failure. Do not mask it by trying
        // another alias and reporting a later "process not running" error.
        return false
      }
      return false
    } finally {
      invalidateScreenshotContext()
    }
  })
  if (!succeeded) {
    throw new Error(
      `menu_click "${path.join(' > ')}" in "${app}" failed (tried process names: ${tried.join(', ')}): ${lastError ?? 'unknown error'}`,
    )
  }
}

export async function getFrontmostApp(): Promise<{
  bundleId: string
  displayName: string
} | null> {
  // One osascript call returning "bundleId\nname" — `expected_app` guards run
  // before every mutating action, so halving the subprocess cost here directly
  // cuts ~50–100 ms per guarded action.
  const { stdout, code } = await execOsascript(
    'tell application "System Events" to tell (first process whose frontmost is true) to return (bundle identifier as string) & linefeed & (name as string)',
  )
  if (code !== 0 || !stdout) return null
  const [bundleId, name] = stdout.split('\n')
  if (!bundleId || bundleId === 'missing value') return null
  return {
    bundleId: bundleId.trim(),
    displayName: (name ?? bundleId).trim(),
  } satisfies AppIdentity
}
