import * as React from 'react'
import { Box, Text, useAnimationFrame } from '../ink.js'
import { useSettings } from '../hooks/useSettings.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'

type Props = {
  startedAt: number
}

const FILLED_SEGMENT = '▰'
const EMPTY_SEGMENT = '▱'

export function CompactProgressBar({ startedAt }: Props) {
  const settings = useSettings()
  const reducedMotion = settings.prefersReducedMotion ?? false
  const [ref, tick] = useAnimationFrame(reducedMotion ? null : 250)
  const { columns } = useTerminalSize()
  // `useAnimationFrame` uses Ink's shared animation clock, which is not an
  // epoch timestamp. Read Date.now() on each render and use the animation
  // value only to schedule renders.
  void tick
  const now = Date.now()
  const elapsedMs = Math.max(0, now - startedAt)
  const width = Math.max(16, Math.min(34, columns - 10))
  const pulseWidth = Math.max(4, Math.floor(width / 3))
  const offset = reducedMotion
    ? 0
    : Math.floor(elapsedMs / 250) % (width + pulseWidth)
  const segments = Array.from({ length: width }, (_, index) => {
    const position = index + pulseWidth
    return position >= offset && position < offset + pulseWidth
      ? FILLED_SEGMENT
      : EMPTY_SEGMENT
  }).join('')
  const elapsedSeconds = Math.floor(elapsedMs / 1000)

  return (
    <Box ref={ref} flexDirection="row" marginLeft={2} marginTop={1}>
      <Text color="claudeBlue_FOR_SYSTEM_SPINNER">{segments}</Text>
      <Text dimColor> {elapsedSeconds}s</Text>
    </Box>
  )
}
