import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import type { AppSettings } from "../types"
import { MASCOT_REPLIES, type Greeting } from "../lib/mascotGreeting"

export type MascotChoice = AppSettings["composer"]["mascot"]

interface MascotFrame {
  duration: number
  cells: [number, number][]
  branches?: { weight: number; to: number }[]
  exitBranch?: number
}
// An animation with loopFrom repeats from that frame while play() was asked to loop; after
// stopLooping() it plays to the end and holds its last frame instead of returning to RestPose.
interface MascotAnimation { frames: MascotFrame[]; loopFrom?: number }
interface MascotCharacter {
  id: string
  spritesheet: { path: string; cellWidth: number; cellHeight: number }
  click?: { open?: string[] }
  animations: Record<string, MascotAnimation>
}

interface MascotSpec {
  id: Exclude<MascotChoice, "none">
  label: string
  scale: number
  cellWidth: number
  visWidth: number
  visHeight: number
  visCenterX: number
  bottomPad: number
  rightOffset: number
  // How far the widest animation (e.g. Clawd's Desktop, Rocky's Wave) reaches left of the button, in px;
  // the speech bubble starts beyond it so no animation draws over it.
  leftReach: number
}

const MASCOTS: MascotSpec[] = [
  { id: "clawd", label: "Clawd", scale: 0.37, cellWidth: 151, visWidth: 86, visHeight: 57, visCenterX: 86.5, bottomPad: 0, rightOffset: 8, leftReach: 16 },
  { id: "clippy", label: "Clippy", scale: 0.48, cellWidth: 95, visWidth: 94, visHeight: 86, visCenterX: 46.5, bottomPad: 4, rightOffset: 10, leftReach: 0 },
  { id: "rocky", label: "Rocky", scale: 0.48, cellWidth: 91, visWidth: 57, visHeight: 78, visCenterX: 56.0, bottomPad: 0, rightOffset: 11, leftReach: 14 },
]

const characterCache = new Map<string, Promise<MascotCharacter>>()
function loadCharacter(id: string): Promise<MascotCharacter> {
  let cached = characterCache.get(id)
  if (!cached) {
    cached = fetch(`/mascots/${id}/character.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load mascot ${id}`)
        return res.json() as Promise<MascotCharacter>
      })
      .catch((err) => {
        characterCache.delete(id)
        throw err
      })
    characterCache.set(id, cached)
  }
  return cached
}

interface ActiveRun { anim: MascotAnimation; index: number; exiting: boolean; looping: boolean }

class MascotPlayer {
  private frameTimer: ReturnType<typeof setTimeout> | null = null
  private exitTimer: ReturnType<typeof setTimeout> | null = null
  private current: ActiveRun | null = null
  private lastPos = ""
  private destroyed = false

  constructor(private el: HTMLElement, private c: MascotCharacter, sheetUrl: string) {
    el.style.width = `${c.spritesheet.cellWidth}px`
    el.style.height = `${c.spritesheet.cellHeight}px`
    el.style.backgroundImage = `url("${sheetUrl}")`
    el.style.backgroundRepeat = "no-repeat"
  }

  showRestPose(): void {
    const cell = !this.destroyed ? this.c.animations.RestPose?.frames[0]?.cells[0] : undefined
    if (cell) this.draw(cell)
  }

  has(name: string): boolean {
    return Boolean(this.c.animations[name])
  }

  play(name: string, loop = false): void {
    if (this.destroyed) return
    const anim = this.c.animations[name]
    if (!anim) return
    this.clearTimers()
    const totalMs = anim.frames.reduce((sum, f) => sum + f.duration, 0)
    const looping = loop && anim.loopFrom !== undefined
    const run: ActiveRun = { anim, index: 0, exiting: false, looping }
    this.current = run
    if (!looping) {
      this.exitTimer = setTimeout(() => {
        if (this.current === run) run.exiting = true
      }, Math.max(4500, totalMs))
    }
    this.show(0)
  }

  stopLooping(): void {
    if (this.current) this.current.looping = false
  }

  destroy(): void {
    this.destroyed = true
    this.current = null
    this.clearTimers()
  }

  private clearTimers(): void {
    if (this.frameTimer) { clearTimeout(this.frameTimer); this.frameTimer = null }
    if (this.exitTimer) { clearTimeout(this.exitTimer); this.exitTimer = null }
  }

  private show(index: number): void {
    const cur = this.current
    const frame = cur && !this.destroyed ? cur.anim.frames[index] : undefined
    if (!cur || !frame) { this.finish(); return }
    cur.index = index
    const cell = frame.cells[0]
    if (cell) this.draw(cell)
    this.frameTimer = setTimeout(() => this.advance(), frame.duration)
  }

  private advance(): void {
    const cur = this.current
    const frame = cur && !this.destroyed ? cur.anim.frames[cur.index] : undefined
    if (!cur || !frame) { this.finish(); return }
    let next = cur.exiting ? (cur.index === cur.anim.frames.length - 1 ? cur.anim.frames.length : (frame.exitBranch ?? cur.index + 1)) : cur.index + 1
    if (!cur.exiting && frame.branches) {
      let roll = Math.random() * 100
      for (const b of frame.branches) {
        if (roll <= b.weight) { next = b.to; break }
        roll -= b.weight
      }
    }
    if (next >= cur.anim.frames.length && cur.anim.loopFrom !== undefined) {
      if (cur.looping) this.show(cur.anim.loopFrom)
      else { this.clearTimers(); this.current = null }
    } else if (next >= cur.anim.frames.length) this.finish()
    else this.show(next)
  }

  private finish(): void {
    this.clearTimers()
    this.current = null
    this.showRestPose()
  }

  private draw(cell: [number, number]): void {
    const { cellWidth: w, cellHeight: h } = this.c.spritesheet
    const pos = `-${cell[0] * w}px -${cell[1] * h}px`
    if (pos === this.lastPos) return
    this.lastPos = pos
    this.el.style.backgroundPosition = pos
  }
}

// Outline of a rounded bubble whose bottom-right corner swells into a short, blunt tail, drawn as one
// path so the outline has no seams. Coordinates sit on the 1px stroke's centerline.
function bubblePath(width: number, height: number): string {
  const k = 11.5, left = 0.5, top = 0.5, right = width - 0.5, bottom = height - 0.5
  return [
    `M${left + k} ${top}`, `H${right - k}`, `A${k} ${k} 0 0 1 ${right} ${top + k}`,
    `V${bottom - 11}`,
    // A wide base that starts leaving the edges well before the corner keeps the swell blunt. The tip points
    // about 25° below horizontal, toward the mascot, and its tangent runs across that direction so it stays round.
    `C${right} ${bottom - 5} ${right + 1.96} ${bottom - 1.87} ${right + 0.9} ${bottom + 0.4}`,
    `C${right - 0.16} ${bottom + 2.67} ${right - 5} ${bottom} ${right - 11} ${bottom}`,
    `H${left + k}`, `A${k} ${k} 0 0 1 ${left} ${bottom - k}`,
    `V${top + k}`, `A${k} ${k} 0 0 1 ${left + k} ${top}`, "Z",
  ].join(" ")
}

function SpeechBubble({ children, style, leaving, onDismiss }: { children: ReactNode; style: CSSProperties; leaving: boolean; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number }>()
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setSize({ width: element.offsetWidth, height: element.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      role="status"
      onClick={onDismiss}
      style={style}
      data-leaving={leaving || undefined}
      className="noa-mascot-bubble pointer-events-auto absolute isolate w-max max-w-[240px] cursor-default text-balance px-3 py-1.5 text-left text-[length:var(--text-chat-sm)] leading-5 text-[color-mix(in_srgb,var(--text-primary)_86%,transparent)]"
    >
      {size && (
        <svg aria-hidden="true" width={size.width} height={size.height} className="absolute inset-0 -z-10 overflow-visible">
          <path d={bubblePath(size.width, size.height)} fill="var(--surface-page, #F9F9F7)" stroke="var(--border-default)" strokeWidth="1" />
        </svg>
      )}
      {children}
    </div>
  )
}

// After a minute without a click or key in the window Clawd dozes off, focused or not; two minutes later the snoring
// stops on the last frame. Any click or key while asleep makes it stretch awake.
const DOZE_AFTER_MS = 60_000
const SNORE_MS = 120_000

// The page greets on its own at most once every half hour; clicking the mascot always answers.
const AUTO_GREET_INTERVAL_MS = 30 * 60_000
const BUBBLE_MS = 10_000
let lastAutoGreetAt = -Infinity

function MascotItem({ spec, greeting, typing }: { spec: MascotSpec; greeting?: Greeting; typing: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MascotPlayer | null>(null)
  const poolRef = useRef<string[]>([])
  const lastAnimRef = useRef<string | undefined>(undefined)
  const lastReplyRef = useRef<string | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [bubble, setBubble] = useState<string>()
  const [leaving, setLeaving] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wokeAt = useRef(-Infinity)
  // Fade out before unmounting, so the bubble leaves as softly as it arrives.
  const hide = () => {
    clearTimeout(hideTimer.current)
    setLeaving(true)
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => { setBubble(undefined); setLeaving(false) }, 180)
  }

  const say = (text: string, animation?: string) => {
    const player = playerRef.current
    const reduced = document.documentElement.dataset.reduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (player && animation && !reduced) player.play(player.has(animation) ? animation : player.has("Waving") ? "Waving" : "Wave")
    clearTimeout(leaveTimer.current)
    setLeaving(false)
    setBubble(text)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(hide, BUBBLE_MS)
  }

  useEffect(() => {
    if (!ready || !greeting || performance.now() - lastAutoGreetAt < AUTO_GREET_INTERVAL_MS) return
    const timer = setTimeout(() => {
      lastAutoGreetAt = performance.now()
      say(greeting.text, greeting.animation)
    }, 600)
    return () => clearTimeout(timer)
  }, [ready, greeting]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (typing) hide() }, [typing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { clearTimeout(hideTimer.current); clearTimeout(leaveTimer.current) }, [])

  useEffect(() => {
    let cancelled = false
    if (!stageRef.current) return
    void loadCharacter(spec.id).then((character) => {
      if (cancelled) return
      const sheetUrl = `/mascots/${spec.id}/${character.spritesheet.path}`
      const img = new Image()
      img.onload = () => {
        if (cancelled || !stageRef.current) return
        const player = new MascotPlayer(stageRef.current, character, sheetUrl)
        playerRef.current = player
        poolRef.current = (character.click?.open ?? []).filter((n) => Boolean(character.animations[n]))
        player.showRestPose()
        setReady(true)
      }
      img.src = sheetUrl
    }).catch(() => {})
    return () => {
      cancelled = true
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [spec.id])

  useEffect(() => {
    const player = playerRef.current
    if (!ready || !player?.has("Snooze")) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let asleep = false
    const reduced = () => document.documentElement.dataset.reduceMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const arm = () => {
      clearTimeout(timer)
      timer = asleep
        ? setTimeout(() => player.stopLooping(), SNORE_MS)
        : setTimeout(() => {
          if (reduced()) return
          asleep = true
          hide()
          player.play("Snooze", true)
          arm()
        }, DOZE_AFTER_MS)
    }
    const onInput = () => {
      if (asleep) {
        asleep = false
        wokeAt.current = performance.now()
        player.play("Stretching")
      }
      arm()
    }
    const opts = { capture: true, passive: true }
    window.addEventListener("pointerdown", onInput, opts)
    window.addEventListener("keydown", onInput, opts)
    arm()
    return () => {
      clearTimeout(timer)
      window.removeEventListener("pointerdown", onInput, opts)
      window.removeEventListener("keydown", onInput, opts)
    }
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = () => {
    const player = playerRef.current
    const pool = poolRef.current
    // The pointerdown that woke Clawd already started its stretch; let it finish.
    if (performance.now() - wokeAt.current < 1000) return
    if (!player || !pool.length) return
    const fresh = pool.length > 1 && lastAnimRef.current ? pool.filter((n) => n !== lastAnimRef.current) : pool
    const next = fresh[Math.floor(Math.random() * fresh.length)]
    if (!next) return
    lastAnimRef.current = next
    player.play(next)
    const replies = MASCOT_REPLIES.filter((reply) => reply !== lastReplyRef.current)
    const reply = replies[Math.floor(Math.random() * replies.length)]!
    lastReplyRef.current = reply
    say(reply)
  }

  const centerOffsetX = (spec.cellWidth / 2 - spec.visCenterX) * spec.scale
  return (
    <>
    {bubble && (
      <SpeechBubble
        leaving={leaving}
        onDismiss={hide}
        style={{ right: Math.round(spec.visWidth * spec.scale) + spec.leftReach + 6, bottom: Math.round(spec.visHeight * spec.scale) + 8 }}
      >
        {bubble}
      </SpeechBubble>
    )}
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
      aria-label={`${spec.label} mascot — click to play animation`}
      style={{ width: Math.round(spec.visWidth * spec.scale), height: Math.round(spec.visHeight * spec.scale) }}
      className={`pointer-events-auto relative shrink-0 cursor-pointer border-0 bg-transparent p-0 transition-opacity duration-200 focus:outline-none ${ready ? "opacity-100" : "opacity-0"}`}
    >
      <div
        ref={stageRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: `calc(50% + ${centerOffsetX}px)`,
          bottom: -(spec.bottomPad * spec.scale),
          transform: `translateX(-50%) scale(${spec.scale})`,
          transformOrigin: "bottom center",
          pointerEvents: "none",
          imageRendering: "pixelated",
        }}
      />
    </button>
    </>
  )
}

export const ComposerMascots = memo(function ComposerMascots({ visible, choice = "clawd", greeting, typing = false }: { visible: boolean; choice?: MascotChoice; greeting?: Greeting; typing?: boolean }) {
  if (!visible || choice === "none") return null
  const spec = MASCOTS.find((m) => m.id === choice) ?? MASCOTS[0]!
  return (
    <div aria-label="Composer mascot" style={{ right: spec.rightOffset }} className="pointer-events-none absolute bottom-full z-10 flex items-end select-none">
      <MascotItem key={spec.id} spec={spec} greeting={greeting} typing={typing} />
    </div>
  )
})
