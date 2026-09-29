import { useEffect, useRef, useState } from 'react'
import { getBgJobShort } from '../utils/background/bgJob.js'
import { listJobs } from '../utils/background/jobs.js'

const POLL_MS = 2000
/** How long a change is highlighted in the footer. */
const FLASH_MS = 2500

export type AgentsNudge = {
  /** Background sessions (other than this one) waiting on the user. */
  needsInput: number
  /** Just changed: `awaiting` when the waiting count moved, `done` when sessions finished. */
  flash: 'awaiting' | 'done' | 'none'
  /** With flash `done` and nobody waiting: how many just finished. */
  justDone: number
}

/**
 * Background sessions for the "← N agents" footer hint. Polls the jobs dir
 * (a readdir plus a few small JSON reads) and, like upstream, highlights a
 * change for a moment: the count in warning color when it moves, or
 * "← N done" when sessions finish while none is waiting.
 */
export function useAgentsNeedingInput(): AgentsNudge {
  const [nudge, setNudge] = useState<AgentsNudge>({ needsInput: 0, flash: 'none', justDone: 0 })
  const prev = useRef<{ needsInput?: number; done?: number }>({})
  useEffect(() => {
    const self = getBgJobShort()
    let cancelled = false
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    const flash = (kind: 'awaiting' | 'done', needsInput: number, justDone: number) => {
      clearTimeout(flashTimer)
      setNudge({ needsInput, flash: kind, justDone })
      flashTimer = setTimeout(() => setNudge(n => ({ ...n, flash: 'none', justDone: 0 })), FLASH_MS)
    }
    const poll = async () => {
      const jobs = (await listJobs()).filter(j => j.short !== self)
      if (cancelled) return
      const needsInput = jobs.filter(j => j.alive && j.tempo === 'blocked').length
      const done = jobs.filter(j => j.state === 'done').length
      const before = prev.current
      prev.current = { needsInput, done }
      const moved = before.needsInput !== undefined && needsInput !== before.needsInput
      const finished = before.done !== undefined && done > before.done ? done - before.done : 0
      if (needsInput === 0 && finished > 0) return flash('done', 0, finished)
      if (needsInput > 0 && moved) return flash('awaiting', needsInput, 0)
      setNudge(n => (n.needsInput === needsInput ? n : { ...n, needsInput }))
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      clearTimeout(flashTimer)
    }
  }, [])
  return nudge
}
