import { memo, useEffect, useRef, useState } from "react"
import type { AppSettings } from "../types"

export type MascotChoice = AppSettings["composer"]["mascot"]

interface MascotFrame {
  duration: number
  cells: [number, number][]
  branches?: { weight: number; to: number }[]
  exitBranch?: number
}
interface MascotAnimation { frames: MascotFrame[] }
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
}

const MASCOTS: MascotSpec[] = [
  { id: "clawd", label: "Clawd", scale: 0.37, cellWidth: 151, visWidth: 86, visHeight: 57, visCenterX: 86.5, bottomPad: 0, rightOffset: 8 },
  { id: "clippy", label: "Clippy", scale: 0.48, cellWidth: 95, visWidth: 94, visHeight: 86, visCenterX: 46.5, bottomPad: 4, rightOffset: 10 },
  { id: "rocky", label: "Rocky", scale: 0.48, cellWidth: 91, visWidth: 57, visHeight: 78, visCenterX: 56.0, bottomPad: 0, rightOffset: 11 },
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

interface ActiveRun { anim: MascotAnimation; index: number; exiting: boolean }

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

  play(name: string): void {
    if (this.destroyed) return
    const anim = this.c.animations[name]
    if (!anim) return
    this.clearTimers()
    const totalMs = anim.frames.reduce((sum, f) => sum + f.duration, 0)
    const run: ActiveRun = { anim, index: 0, exiting: false }
    this.current = run
    this.exitTimer = setTimeout(() => {
      if (this.current === run) run.exiting = true
    }, Math.max(4500, totalMs))
    this.show(0)
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
    if (next >= cur.anim.frames.length) this.finish()
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

function MascotItem({ spec }: { spec: MascotSpec }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<MascotPlayer | null>(null)
  const poolRef = useRef<string[]>([])
  const lastAnimRef = useRef<string | undefined>(undefined)
  const [ready, setReady] = useState(false)

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

  const handleClick = () => {
    const player = playerRef.current
    const pool = poolRef.current
    if (!player || !pool.length) return
    const fresh = pool.length > 1 && lastAnimRef.current ? pool.filter((n) => n !== lastAnimRef.current) : pool
    const next = fresh[Math.floor(Math.random() * fresh.length)]
    if (!next) return
    lastAnimRef.current = next
    player.play(next)
  }

  const centerOffsetX = (spec.cellWidth / 2 - spec.visCenterX) * spec.scale
  return (
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
  )
}

export const ComposerMascots = memo(function ComposerMascots({ visible, choice = "clawd" }: { visible: boolean; choice?: MascotChoice }) {
  if (!visible || choice === "none") return null
  const spec = MASCOTS.find((m) => m.id === choice) ?? MASCOTS[0]!
  return (
    <div aria-label="Composer mascot" style={{ right: spec.rightOffset }} className="pointer-events-none absolute bottom-full z-10 flex items-end select-none">
      <MascotItem key={spec.id} spec={spec} />
    </div>
  )
})
