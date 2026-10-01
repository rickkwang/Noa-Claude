import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from '../../ink.js'
import type { ClickEvent } from '../../ink/events/click-event.js'

export function MoreRow({ direction, count, onPress, suffix = '' }: {
  direction: 'above' | 'below'
  count: number
  suffix?: string
  onPress?: (event: ClickEvent) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const action = useRef(onPress)
  action.current = onPress
  useEffect(() => {
    setHovered(false)
    setPressed(false)
    return () => { clearTimeout(timer.current); timer.current = undefined }
  }, [count])
  if (count <= 0) return null
  const arrow = direction === 'above' ? '↑' : '↓'
  return <Box paddingLeft={1} alignSelf="flex-start" onMouseEnter={onPress ? () => setHovered(true) : undefined} onMouseLeave={() => setHovered(false)} onClick={onPress ? (event: ClickEvent) => {
    event.stopImmediatePropagation()
    if (timer.current !== undefined) return
    setPressed(true)
    timer.current = setTimeout(() => {
      timer.current = undefined
      setPressed(false)
      action.current?.(event)
    }, 150)
  } : undefined}>
    <Text dimColor={!pressed} inverse={pressed}>{' '}{hovered && !pressed ? <Text inverse>{arrow}</Text> : arrow}{` ${count} more${suffix} `}</Text>
  </Box>
}

export function useMoreRowClickGuard() {
  const lastPress = useRef({ row: -1, at: -Infinity })
  return {
    pressed(event: ClickEvent) { lastPress.current = { row: event.row, at: Date.now() } },
    blocks(event: ClickEvent) { return event.row === lastPress.current.row && Date.now() - lastPress.current.at < 1000 },
  }
}
