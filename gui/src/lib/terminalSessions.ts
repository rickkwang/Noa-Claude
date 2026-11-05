// Terminal tabs live outside React: hiding the panel or switching projects keeps each shell and its screen.
import { Terminal, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { ClipboardAddon } from "@xterm/addon-clipboard"
import { Unicode11Addon } from "@xterm/addon-unicode11"

// "stalled": the screen stopped taking output (an xterm parser error ends its write loop for good).
export type TerminalStatus = "connecting" | "ready" | "reconnecting" | "exited" | "failed" | "stalled"

export interface TerminalSnapshot {
  id: string
  title: string
  status: TerminalStatus
  message?: string
}

// A terminal tab sits in the bottom panel or the right panel, and can move between them without restarting.
export type TerminalLocation = "bottom" | "right"

interface ProjectTabs {
  // Bottom-panel tabs.
  ids: string[]
  active?: string
  right?: string[]
  rightActive?: string
}

const STORAGE_KEY = "noa-agent.terminalTabs"
const RECONNECT_DELAYS = [250, 1000, 2000, 4000]
const STALL_MS = 5000

// The WebGL renderer draws block and box characters to fill their cells, so pixel art and borders join up;
// it loads off the startup path, and a terminal without it keeps the DOM renderer.
const webgl = import("@xterm/addon-webgl").then((module) => module.WebglAddon).catch(() => null)

// Colours a program picks for another background (or theme) are lifted to a readable contrast.
const MORE_CONTRAST = typeof matchMedia === "undefined" ? undefined : matchMedia("(prefers-contrast: more)")
function contrastRatio(): number {
  return MORE_CONTRAST?.matches ? 7 : 4.5
}
MORE_CONTRAST?.addEventListener("change", () => restyleTerminals())

// ANSI colours map onto the app's text tiers and five accents, so a shell prompt reads like the rest of the UI.
const ACCENTS = {
  light: { red: "#e02e2a", green: "#00a240", yellow: "#ffc300", blue: "#339cff", magenta: "#924ff7", selection: "#0000001a" },
  dark: { red: "#ff6764", green: "#40c977", yellow: "#ffd240", blue: "#339cff", magenta: "#ad7bf9", selection: "#ffffff1a" },
}

const sessions = new Map<string, TerminalSession>()
const listeners = new Set<() => void>()
let projects: Record<string, ProjectTabs> = loadTabs()
let version = 0

function loadTabs(): Record<string, ProjectTabs> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}")
    return saved && typeof saved === "object" ? saved : {}
  } catch {
    return {}
  }
}

function changed() {
  version++
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(projects)) } catch { /* Tabs still work for this page. */ }
  for (const listener of listeners) listener()
}

function cssColor(probe: HTMLElement, name: string, fallback: string): string {
  probe.style.color = ""
  probe.style.color = `var(${name}, ${fallback})`
  return getComputedStyle(probe).color || fallback
}

function terminalTheme(): ITheme {
  const probe = document.createElement("span")
  probe.style.display = "none"
  document.body.appendChild(probe)
  const accents = document.documentElement.dataset.theme === "dark" ? ACCENTS.dark : ACCENTS.light
  const foreground = cssColor(probe, "--text-primary", "#2D2D2B")
  const secondary = cssColor(probe, "--text-secondary", "#7B7974")
  const tertiary = cssColor(probe, "--text-tertiary", "#A3A19B")
  const background = cssColor(probe, "--surface-page", "#F9F9F7")
  probe.remove()
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: accents.selection,
    selectionInactiveBackground: accents.selection,
    black: tertiary,
    brightBlack: secondary,
    white: foreground,
    brightWhite: foreground,
    red: accents.red,
    brightRed: accents.red,
    green: accents.green,
    brightGreen: accents.green,
    yellow: accents.yellow,
    brightYellow: accents.yellow,
    blue: accents.blue,
    brightBlue: accents.blue,
    cyan: accents.blue,
    brightCyan: accents.blue,
    magenta: accents.magenta,
    brightMagenta: accents.magenta,
  }
}

// The terminal font setting; the code font fills in glyphs it lacks.
let fontFamily = ""

export function setTerminalFontFamily(family: string) {
  if (family === fontFamily) return
  fontFamily = family
  restyleTerminals()
}

function terminalFont(): { fontFamily: string; fontSize: number } {
  const root = getComputedStyle(document.documentElement)
  const size = parseFloat(root.getPropertyValue("--code-font-size"))
  const code = root.getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace"
  return {
    fontFamily: fontFamily ? `"${fontFamily.replace(/["\\]/g, "")}", ${code}` : code,
    fontSize: Number.isFinite(size) && size > 0 ? size : 12,
  }
}

function openLink(uri: string) {
  if (/^https?:\/\//i.test(uri)) window.open(uri, "_blank", "noopener")
}

function chord(event: KeyboardEvent, key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean }) {
  return event.metaKey === !!mods.meta && event.ctrlKey === !!mods.ctrl && event.shiftKey === !!mods.shift && !event.altKey && event.key === key
}

// macOS line-editing chords become the readline keys a shell understands.
const META_KEYS: Record<string, string> = { ArrowLeft: "\x01", ArrowUp: "\x01", ArrowRight: "\x05", ArrowDown: "\x05", Backspace: "\x15", Delete: "\x0b" }

class TerminalSession {
  readonly host = document.createElement("div")
  readonly term: Terminal
  readonly fit = new FitAddon()
  title: string
  status: TerminalStatus = "connecting"
  message?: string
  private socket?: WebSocket
  private opened = false
  private renderer: "deferred" | "webgl" | "dom" = "deferred"
  private received = false
  private closing = false
  private attempt = 0
  private retry?: ReturnType<typeof setTimeout>
  private pending = 0
  private written = 0
  private watchdog?: ReturnType<typeof setTimeout>

  // A new tab waits for its first fit, so the shell draws its first prompt at the panel's real size.
  // A tab restored after a reload attaches at once, before the bridge gives up on its shell.
  constructor(readonly id: string, readonly cwd: string, private readonly onNewTab: () => void, connectNow: boolean) {
    this.host.className = "noa-terminal-host"
    this.title = cwd.split("/").pop() || cwd
    this.term = new Terminal({
      allowProposedApi: true,
      minimumContrastRatio: contrastRatio(),
      cursorStyle: "bar",
      cursorBlink: true,
      letterSpacing: 0,
      lineHeight: 1.2,
      linkHandler: { activate: (_event, uri) => openLink(uri) },
      theme: terminalTheme(),
      ...terminalFont(),
    })
    this.term.loadAddon(new ClipboardAddon())
    this.term.loadAddon(this.fit)
    this.term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)))
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = "11"
    this.term.attachCustomKeyEventHandler((event) => this.key(event))
    this.term.onData((data) => this.send({ type: "input", data }))
    this.term.onResize(({ cols, rows }) => this.send({ type: "resize", cols, rows }))
    this.term.onTitleChange((title) => {
      if (!title.trim()) return
      this.title = title.trim()
      changed()
    })
    if (connectNow) this.connect()
  }

  // False keeps xterm from handling the key, so app shortcuts (⌘J, ⌘K, …) still reach the window.
  private key(event: KeyboardEvent): boolean {
    if (event.type !== "keydown") return true
    if (chord(event, "t", { meta: true })) {
      event.preventDefault()
      this.onNewTab()
      return false
    }
    if (chord(event, "C", { ctrl: true, shift: true }) || chord(event, "Insert", { ctrl: true })) {
      event.preventDefault()
      const selection = this.term.getSelection()
      if (selection) void navigator.clipboard.writeText(selection).catch(() => {})
      return false
    }
    if (chord(event, "V", { ctrl: true, shift: true }) || chord(event, "Insert", { shift: true })) {
      event.preventDefault()
      void navigator.clipboard.readText().then((text) => { if (text) this.term.paste(text) }).catch(() => {})
      return false
    }
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && META_KEYS[event.key]) {
      event.preventDefault()
      this.send({ type: "input", data: META_KEYS[event.key] })
      return false
    }
    if (event.code === "Backquote" && event.ctrlKey && !event.metaKey && !event.altKey) return false
    return !event.metaKey
  }

  private connect() {
    clearTimeout(this.retry)
    const params = new URLSearchParams({ cwd: this.cwd, id: this.id, cols: String(this.term.cols), rows: String(this.term.rows) })
    const socket = new WebSocket(new URL(`/terminal?${params}`, window.location.href).toString().replace(/^http/, "ws"))
    this.socket = socket
    socket.onmessage = (event) => {
      let message: { type?: string; data?: string; buffer?: string; shell?: string; code?: number; message?: string }
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.type === "attached") {
        this.attempt = 0
        // A reattach replays the bridge's copy of recent output over a clean screen.
        if (this.received) this.term.reset()
        if (message.buffer) this.write(message.buffer)
        this.received = true
        this.setStatus("ready")
      } else if (message.type === "data" && message.data) {
        this.received = true
        this.write(message.data)
      } else if (message.type === "exit") {
        this.setStatus("exited", message.code ? `Shell exited with code ${message.code}` : "Shell exited")
      } else if (message.type === "error") {
        this.setStatus("failed", message.message)
      }
    }
    socket.onclose = () => {
      if (this.socket !== socket || this.closing || this.status === "exited" || this.status === "failed" || this.status === "stalled") return
      const delay = RECONNECT_DELAYS[this.attempt++]
      if (delay === undefined) {
        this.setStatus("failed", "Couldn’t reconnect")
        return
      }
      this.setStatus("reconnecting")
      this.retry = setTimeout(() => this.connect(), delay)
    }
  }

  private write(data: string) {
    this.pending++
    this.term.write(data, () => {
      this.pending--
      this.written++
      if (this.status === "stalled") this.setStatus("ready")
    })
    this.watch()
  }

  // Output queued for a while with none of it drawn means the write loop is dead; say so instead of a blank screen.
  private watch() {
    if (this.watchdog || this.status === "stalled") return
    const written = this.written
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined
      if (this.pending === 0 || this.closing) return
      // A hidden window's timers are throttled, xterm's included; only a visible one can tell a dead loop.
      if (this.written === written && !document.hidden) this.setStatus("stalled", "The terminal stopped drawing output.")
      else this.watch()
    }, STALL_MS)
  }

  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private setStatus(status: TerminalStatus, message?: string) {
    this.status = status
    this.message = message
    changed()
  }

  reconnect() {
    this.attempt = 0
    this.setStatus("connecting")
    this.connect()
  }

  // xterm can only measure once its element is in the document.
  mount(container: HTMLElement) {
    if (this.host.parentElement !== container) container.replaceChildren(this.host)
    if (!this.opened) {
      this.term.open(this.host)
      this.opened = true
    }
    this.resize()
    if (!this.socket && !this.closing) this.connect()
    void this.useWebgl()
  }

  // Once the terminal has a size; a lost GPU context falls back to the DOM renderer for good.
  private async useWebgl() {
    if (this.renderer !== "deferred" || !this.opened || this.host.clientWidth === 0) return
    this.renderer = "webgl"
    const Addon = await webgl
    if (this.closing) return
    if (!Addon) {
      this.renderer = "dom"
      return
    }
    try {
      const addon = new Addon()
      addon.onContextLoss(() => {
        addon.dispose()
        this.renderer = "dom"
      })
      this.term.loadAddon(addon)
    } catch {
      this.renderer = "dom"
    }
  }

  resize() {
    if (!this.opened || !this.host.isConnected || this.host.clientWidth === 0 || this.host.clientHeight === 0) return
    this.fit.fit()
  }

  restyle() {
    this.term.options.theme = terminalTheme()
    this.term.options.minimumContrastRatio = contrastRatio()
    Object.assign(this.term.options, terminalFont())
    this.resize()
  }

  focus() {
    this.term.focus()
  }

  dispose() {
    this.closing = true
    clearTimeout(this.retry)
    clearTimeout(this.watchdog)
    this.send({ type: "close" })
    this.socket?.close()
    this.term.dispose()
    this.host.remove()
  }

  snapshot(): TerminalSnapshot {
    return { id: this.id, title: this.title, status: this.status, message: this.message }
  }
}

function sessionFor(cwd: string, id: string, fresh = false): TerminalSession {
  let session = sessions.get(id)
  if (!session) {
    session = new TerminalSession(id, cwd, () => openTerminal(cwd, terminalLocation(cwd, id) ?? "bottom"), !fresh)
    sessions.set(id, session)
  }
  return session
}

function project(cwd: string): ProjectTabs {
  return projects[cwd] ?? { ids: [] }
}

function update(cwd: string, next: ProjectTabs) {
  projects = { ...projects, [cwd]: next }
  changed()
}

// The tab after a removed one takes its place, as browsers do.
function without(ids: string[], active: string | undefined, id: string): { ids: string[]; active?: string } {
  const index = ids.indexOf(id)
  const rest = ids.filter((tab) => tab !== id)
  return { ids: rest, active: active === id ? rest[Math.min(index, rest.length - 1)] : active }
}

export function terminalSession(cwd: string, id: string): TerminalSession {
  return sessionFor(cwd, id)
}

export function terminalTabs(cwd: string, location: TerminalLocation = "bottom"): { ids: string[]; active?: string } {
  const tabs = project(cwd)
  return location === "bottom" ? { ids: tabs.ids, active: tabs.active } : { ids: tabs.right ?? [], active: tabs.rightActive }
}

export function terminalLocation(cwd: string, id: string): TerminalLocation | undefined {
  const tabs = project(cwd)
  return tabs.ids.includes(id) ? "bottom" : tabs.right?.includes(id) ? "right" : undefined
}

function place(tabs: ProjectTabs, location: TerminalLocation, ids: string[], active?: string): ProjectTabs {
  return location === "bottom" ? { ...tabs, ids, active } : { ...tabs, right: ids, rightActive: active }
}

export function openTerminal(cwd: string, location: TerminalLocation = "bottom"): string {
  const id = crypto.randomUUID()
  const current = terminalTabs(cwd, location)
  sessionFor(cwd, id, true)
  update(cwd, place(project(cwd), location, [...current.ids, id], id))
  return id
}

export function selectTerminal(cwd: string, id: string) {
  const location = terminalLocation(cwd, id)
  if (location) update(cwd, place(project(cwd), location, terminalTabs(cwd, location).ids, id))
}

export function closeTerminal(cwd: string, id: string) {
  const location = terminalLocation(cwd, id)
  sessions.get(id)?.dispose()
  sessions.delete(id)
  if (!location) return
  const rest = without(terminalTabs(cwd, location).ids, terminalTabs(cwd, location).active, id)
  update(cwd, place(project(cwd), location, rest.ids, rest.active))
}

// The shell keeps running; only the panel that shows it changes.
export function moveTerminal(cwd: string, id: string, to: TerminalLocation) {
  const from = terminalLocation(cwd, id)
  if (!from || from === to) return
  const rest = without(terminalTabs(cwd, from).ids, terminalTabs(cwd, from).active, id)
  const moved = place(project(cwd), from, rest.ids, rest.active)
  update(cwd, place(moved, to, [...terminalTabs(cwd, to).ids, id], id))
}

// An exited or unreachable shell starts again in the same tab.
export function restartTerminal(cwd: string, id: string) {
  const location = terminalLocation(cwd, id)
  sessions.get(id)?.dispose()
  sessions.delete(id)
  if (!location) return
  const tabs = terminalTabs(cwd, location)
  const next = crypto.randomUUID()
  sessionFor(cwd, next, true)
  update(cwd, place(project(cwd), location, tabs.ids.map((tab) => tab === id ? next : tab), tabs.active === id ? next : tabs.active))
}

export function snapshotTerminals(cwd: string, location: TerminalLocation = "bottom"): TerminalSnapshot[] {
  return terminalTabs(cwd, location).ids.map((id) => sessionFor(cwd, id).snapshot())
}

export function subscribeTerminals(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function terminalsVersion(): number {
  return version
}

let restyleFrame = 0
// Theme and font settings are root CSS variables; every open terminal follows them.
export function restyleTerminals() {
  cancelAnimationFrame(restyleFrame)
  restyleFrame = requestAnimationFrame(() => { for (const session of sessions.values()) session.restyle() })
}

// WebGL glyph textures can come back from system sleep corrupted (wrong glyphs) while the context survives.
if (typeof window !== "undefined") {
  window.noaDesktop?.onSystemResume?.(() => { for (const session of sessions.values()) session.term.clearTextureAtlas() })
}

// Colours are written to the root element's style; a system light/dark switch only flips data-theme.
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(restyleTerminals).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
}
