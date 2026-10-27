/**
 * Logo easter egg: plays the 3D logo animation over the whole screen, like
 * pi's. The banner opens it with openLogoEgg(); FullscreenLayout renders
 * <LogoEggOverlay /> as an opaque layer above the transcript, prompt and
 * status line, which stay mounted underneath. Escape or a click starts the
 * exit animation (a second press skips it). Frames come from eggScene.ts.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { BaseText, Box } from '../../ink.js'
import useStdin from '../../ink/hooks/use-stdin.js'
import type { InputEvent } from '../../ink/events/input-event.js'
import type { WheelEvent } from '../../ink/events/wheel-event.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { stringWidth } from '../../ink/stringWidth.js'
import instances from '../../ink/instances.js'
import { oscColor, type TerminalQuerier } from '../../ink/terminal-querier.js'
import { parseOscRgb } from '../../utils/systemTheme.js'
import { createEggScene, DARK_PALETTE, LIGHT_PALETTE, type EggCell, type EggPalette, type RGB } from './eggScene.js'

const FRAME_MS = 1000 / 30
// How long to wait for the terminal to report its colors before falling back to the theme.
const COLOR_QUERY_TIMEOUT_MS = 100

export type LogoEgg = {
  logo: string[]
  /** One solid color for every cube. */
  color: RGB
  /** Screen cell of the logo's top-left corner; the egg flies out of and back into it. */
  origin: { column: number; row: number }
}

type OpenEgg = LogoEgg & { id: number; screen: string[]; palette: EggPalette }

let current: OpenEgg | null = null
let opening = false
let nextId = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => listener())

/**
 * Asks the terminal for its real foreground/background (OSC 10/11), as pi does:
 * the egg blends text, stars and fog toward the background and only draws its
 * halo on light ones, so a theme name (which 'auto' may resolve wrong) isn't
 * enough. Falls back to the theme's palette when the terminal doesn't answer.
 */
async function queryPalette(querier: TerminalQuerier | null, fallback: EggPalette): Promise<EggPalette> {
  if (!querier) return fallback
  const toRgb = (data: string | undefined): RGB | undefined => {
    const rgb = data ? parseOscRgb(data) : undefined
    return rgb && [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255)]
  }
  const query = Promise.all([querier.send(oscColor(10)), querier.send(oscColor(11)), querier.flush()])
  const timeout = new Promise<undefined>(resolve => setTimeout(resolve, COLOR_QUERY_TIMEOUT_MS))
  const result = await Promise.race([query, timeout])
  const foreground = toRgb(result?.[0]?.data) ?? fallback.foreground
  const background = toRgb(result?.[1]?.data) ?? fallback.background
  const muted: RGB = [0, 1, 2].map(i => Math.round(foreground[i]! * 0.55 + background[i]! * 0.45)) as RGB
  return { foreground, background, muted }
}

export async function openLogoEgg(egg: LogoEgg, querier: TerminalQuerier | null, fallbackLight: boolean): Promise<void> {
  if (current || opening) return
  opening = true
  try {
    const palette = await queryPalette(querier, fallbackLight ? LIGHT_PALETTE : DARK_PALETTE)
    // Snapshot the frame the egg is about to cover, so all of it can dissolve.
    const screen = instances.get(process.stdout)?.snapshotAnsiLines() ?? []
    current = { ...egg, id: nextId++, screen, palette }
    emit()
  } finally {
    opening = false
  }
}

function closeLogoEgg(): void {
  current = null
  emit()
}

export function useLogoEgg(): LogoEgg | null {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}

const hex = ([r, g, b]: RGB) => `#${[r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`

// Adjacent cells with the same colors share one <BaseText>, which keeps the Ink tree small.
// BaseText, not the themed Text: its backgroundColor only takes theme keys and
// silently drops raw hex, which would erase the halo and faded cell backgrounds.
// A wide glyph's filler cell has an empty char and adds nothing.
function renderRow(row: (EggCell | null)[], key: number): React.ReactNode {
  const runs: React.ReactNode[] = []
  let text = ''
  let color: string | undefined
  let bg: string | undefined
  const flush = (index: number) => {
    if (text === '') return
    runs.push(<BaseText key={`${key}-${index}`} color={color} backgroundColor={bg}>{text}</BaseText>)
    text = ''
  }
  row.forEach((cell, index) => {
    const char = cell ? cell.char : ' '
    if (char === '') return
    const next = cell ? hex(cell.color) : undefined
    const nextBg = cell?.bg ? hex(cell.bg) : undefined
    if (next !== color || nextBg !== bg) {
      flush(index)
      color = next
      bg = nextBg
    }
    text += char
  })
  flush(row.length)
  return <Box key={key}>{runs}</Box>
}

export function LogoEggOverlay() {
  const egg = useLogoEgg() as OpenEgg | null
  if (!egg) return null
  return <EggPlayer key={egg.id} egg={egg} />
}

function EggPlayer({ egg }: { egg: OpenEgg }) {
  const { columns, rows } = useTerminalSize()
  const scene = useMemo(() => createEggScene(egg.logo, egg.color, egg.origin, egg.screen, stringWidth, egg.palette), [egg])
  const startRef = useRef(performance.now())
  const seconds = () => (performance.now() - startRef.current) / 1000
  // Only forces a re-render each frame; the frame itself is computed from the clock.
  const [, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      if (scene.isDone(seconds())) {
        clearInterval(id)
        closeLogoEgg()
      } else {
        setFrame(frame => frame + 1)
      }
    }, FRAME_MS)
    return () => {
      clearInterval(id)
      // Unmounted mid-animation (layout remount, leaving fullscreen): release the
      // store too, or the prompt cursor and banner ripple stay suppressed for good.
      closeLogoEgg()
    }
  }, [scene])

  // The egg owns the keyboard while it plays: prepend so this runs before the
  // prompt's and keybindings' listeners, then swallow every key.
  const { internal_eventEmitter } = useStdin()
  useEffect(() => {
    if (!internal_eventEmitter) return
    const onInput = (event: InputEvent) => {
      if (event.key.escape || (event.key.ctrl && event.input === 'c')) scene.close(seconds())
      event.stopImmediatePropagation()
    }
    internal_eventEmitter.prependListener('input', onInput)
    return () => {
      internal_eventEmitter.removeListener('input', onInput)
    }
  }, [internal_eventEmitter, scene])


  // Claim the wheel too: an unclaimed one would scroll the transcript under the
  // egg, and the exit would re-form the old snapshot and then jump.
  const swallowWheel = (event: WheelEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const frame = scene.render(columns, rows, seconds())

  return (
    <Box position="absolute" top={0} left={0} width={columns} height={rows} flexDirection="column" opaque={true} onClick={() => scene.close(seconds())} onWheel={swallowWheel}>
      {frame.map((row, index) => renderRow(row, index))}
    </Box>
  )
}
