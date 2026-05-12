import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type SessionEntry,
  type SessionGroup,
  groupSessionsByState,
  readAllSessions,
} from '../utils/background/sessionRegistry.js'

export function useSessionPolling(intervalMs: number = 2000): {
  sessions: SessionEntry[]
  groups: SessionGroup[]
  loading: boolean
} {
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [loading, setLoading] = useState(true)

  const poll = useCallback(async () => {
    const entries = await readAllSessions()
    const filtered = entries.filter(e => e.pid !== process.pid)
    setSessions(filtered)
    setLoading(false)
  }, [])

  useEffect(() => {
    void poll()
    const id = setInterval(() => void poll(), intervalMs)
    return () => clearInterval(id)
  }, [poll, intervalMs])

  const groups = useMemo(() => groupSessionsByState(sessions), [sessions])

  return { sessions, groups, loading }
}
