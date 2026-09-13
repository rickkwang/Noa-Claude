import { clearCommandMemoizationCaches } from '../../commands.js'
import { clearSystemPromptSectionCache } from '../../constants/systemPromptSections.js'
import {
  isAutoMemoryEnabled,
  isAutoMemoryPausedForSession,
  setAutoMemoryPausedForSession,
} from '../../memdir/paths.js'
import type { LocalCommandCall } from '../../types/command.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'

export const call: LocalCommandCall = async (args, _context) => {
  const arg = args.trim().toLowerCase()
  const paused = isAutoMemoryPausedForSession()

  let next: boolean
  switch (arg) {
    case '':
      next = !paused
      break
    case 'pause':
    case 'on':
      next = true
      break
    case 'resume':
    case 'off':
      next = false
      break
    default:
      return {
        type: 'text',
        value: `Unknown argument "${arg}". Usage: /pause-memory [pause|resume]`,
      }
  }

  if (next === paused) {
    return {
      type: 'text',
      value: next
        ? 'Auto-memory is already paused for this session.'
        : 'Auto-memory is already running.',
    }
  }

  setAutoMemoryPausedForSession(next)
  // The memory section is cached under a fixed name ('memory'), so unlike the
  // output-style section it can't key itself out of the cache — drop the
  // rendered sections so the next turn re-runs loadMemoryPrompt(). Recomputing
  // identical text still hits the API prompt cache; only the changed section
  // costs anything.
  clearSystemPromptSectionCache()
  // Memory also reaches the model through getMemoryFiles() → the memdir
  // entrypoint behind the same gate; drop that scan so any new injection
  // reads nothing. getUserContext is deliberately NOT cleared: its output is
  // messages[0], the head of the API prompt-cache prefix, and regenerating it
  // turns the whole conversation into cache_creation next turn (the
  // date_change attachment in utils/attachments.ts exists for exactly this
  // reason). Memory already sitting in messages[0] therefore stays until
  // /clear or compact — the message below says so.
  clearMemoryFileCaches()
  // /remember and /dream gate their isEnabled() on isAutoMemoryEnabled(), and
  // the command list is memoized.
  clearCommandMemoizationCaches()

  if (next) {
    return {
      type: 'text',
      value:
        'Auto-memory paused for this session. Nothing new is read from or written to the memory directory; memory already in this conversation stays until /clear or compact. Resumes with /pause-memory resume or a new session.',
    }
  }
  return {
    type: 'text',
    value: isAutoMemoryEnabled()
      ? 'Auto-memory resumed for this session.'
      : 'Session pause lifted, but auto-memory stays off — it is disabled by CLAUDE_CODE_DISABLE_AUTO_MEMORY or autoMemoryEnabled in settings.json.',
  }
}
