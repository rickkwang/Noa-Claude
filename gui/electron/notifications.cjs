// Desktop notifications for Noa's runs. The main process polls the bridge's run list, so tasks that
// finish or wait for input while another task is on screen still notify.
const { Notification, app } = require('electron')
const { diffRuns } = require('./runNotices.cjs')

const NAMED_SOUNDS = new Set(['Basso', 'Glass', 'Ping', 'Pop', 'Purr', 'Tink'])
const POLL_MS = 1000

const COPY = {
  turn: ['Task finished', 'turnMode'],
  failed: ['Task failed', 'turnMode'],
  permission: ['Approval needed', 'permissions'],
  question: ['Question for you', 'questions'],
  elicitation: ['Input requested', 'questions'],
}

function createNotifier({ listRuns, getWindow }) {
  let settings = {
    turnMode: 'unfocused',
    sound: 'default',
    permissions: true,
    questions: true,
    dot: true,
  }
  let previous = null
  let timer = null
  let polling = false

  function announce(notice) {
    // Wait kinds without copy (e.g. 'other') are not announced; throwing here would drop the rest of the poll.
    if (!COPY[notice.kind]) return
    const [title, setting] = COPY[notice.kind]
    const win = getWindow()
    const focused = !!win && !win.isDestroyed() && win.isFocused()
    if (setting === 'turnMode') {
      if (settings.turnMode === 'off' || (settings.turnMode === 'unfocused' && focused)) return
    } else if (!settings[setting]) return

    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Noa',
        subtitle: title,
        body: notice.title || 'New task',
        silent: settings.sound === 'none',
        ...(NAMED_SOUNDS.has(settings.sound) ? { sound: settings.sound } : {}),
      })
      notification.on('click', () => {
        const target = getWindow()
        if (target && !target.isDestroyed()) {
          target.show()
          target.focus()
        }
      })
      notification.show()
    }
    if (settings.dot && !focused && process.platform === 'darwin') app.dock?.setBadge('•')
  }

  function clearBadge() {
    if (process.platform === 'darwin') app.dock?.setBadge('')
  }

  async function poll() {
    if (polling) return
    polling = true
    try {
      const runs = await listRuns()
      const { next, notices } = diffRuns(previous, runs)
      previous = next
      for (const notice of notices) announce(notice)
    } catch {
      // The bridge is restarting or unreachable; the next poll retries.
    } finally {
      polling = false
    }
  }

  return {
    configure(next) {
      const valid = (value, allowed) => (allowed.includes(value) ? value : undefined)
      settings = {
        turnMode: valid(next?.turnMode, ['off', 'unfocused', 'always']) ?? settings.turnMode,
        sound: valid(next?.sound, ['default', 'classic', 'none', ...NAMED_SOUNDS]) ?? settings.sound,
        permissions: typeof next?.permissions === 'boolean' ? next.permissions : settings.permissions,
        questions: typeof next?.questions === 'boolean' ? next.questions : settings.questions,
        dot: typeof next?.dot === 'boolean' ? next.dot : settings.dot,
      }
      if (!settings.dot) clearBadge()
    },
    start() {
      if (timer) return
      timer = setInterval(poll, POLL_MS)
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
    clearBadge,
  }
}

module.exports = { createNotifier }
