import { useEffect, useState } from "react"
import type { AppSettings } from "../../types"
import { SHORTCUT_IDS, SHORTCUT_LABELS, bindingFromEvent, defaultShortcuts, findShortcutConflict, formatBinding, type ShortcutId } from "../../lib/shortcuts"
import { Row, Section, actionButton } from "./controls"

const fixed: [string, string[]][] = [
  ["Run instruction", ["Enter"]],
  ["New line", ["Shift", "Enter"]],
  ["Reorder task", ["⌥", "↑/↓"]],
  ["Stop agent", ["Esc"]],
]

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 gap-1">
      {keys.map((key, i) => (
        <kbd
          key={`${key}-${i}`}
          className="flex h-5 min-w-5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-1.5 text-caption text-[var(--sidebar-text-muted)]"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

export function ShortcutsPage({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  const [message, setMessage] = useState("")
  const bindings = settings.shortcuts

  function update(id: ShortcutId, binding: string) {
    onChange({ ...settings, shortcuts: { ...bindings, [id]: binding } })
  }

  // Capture phase and stopImmediatePropagation keep the recorded keys from also firing the app's own shortcuts.
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setRecording(null)
        return
      }
      if (event.code === "Backspace" || event.code === "Delete") {
        if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          update(recording, "")
          setRecording(null)
          setMessage("")
        }
        return
      }
      const binding = bindingFromEvent(event)
      if (!binding) return
      const conflict = findShortcutConflict(bindings, recording, binding)
      if (conflict) {
        setMessage(`Already used by ${SHORTCUT_LABELS[conflict]}.`)
        setRecording(null)
        return
      }
      update(recording, binding)
      setRecording(null)
      setMessage("")
    }
    // Any click cancels recording, so a stale row never captures the next key press.
    const cancel = () => setRecording(null)
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("mousedown", cancel, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("mousedown", cancel, true)
    }
  }, [recording, bindings, settings])

  const isDefault = SHORTCUT_IDS.every((id) => bindings[id] === defaultShortcuts[id])

  return (
    <>
      <Section title="Shortcuts">
        {SHORTCUT_IDS.map((id) => {
          const binding = bindings[id]
          const active = recording === id
          return (
            <Row key={id} label={SHORTCUT_LABELS[id]}>
              <span className="flex shrink-0 items-center gap-2">
                {binding && !active && (
                  <button type="button" aria-label={`Clear ${SHORTCUT_LABELS[id]} shortcut`} onClick={() => update(id, "")} className="text-caption text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]">
                    Clear
                  </button>
                )}
                <button type="button" onClick={() => { setMessage(""); setRecording(active ? null : id) }} className="flex min-h-7 min-w-24 items-center justify-end rounded-md px-1 hover:bg-[var(--settings-fill-hover)]">
                  {active ? <span className="text-caption text-[var(--sidebar-text-muted)]">Press keys…</span> : binding ? <Keys keys={formatBinding(binding)} /> : <span className="text-caption text-[var(--sidebar-text-muted)]">None</span>}
                </button>
              </span>
            </Row>
          )
        })}
        {fixed.map(([label, keys]) => (
          <Row key={label} label={label}>
            <Keys keys={label === "Run instruction" && settings.composer.sendShortcut === "modifier-enter" ? [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "Enter"] : keys} />
          </Row>
        ))}
      </Section>
      <div className="flex items-center justify-between gap-4">
        <span role="status" className="text-caption text-[var(--sidebar-text-muted)]">
          {message || (recording ? "Press a shortcut with a modifier key. Esc cancels, Delete clears." : "")}
        </span>
        <button type="button" disabled={isDefault} className={actionButton} onClick={() => { setMessage(""); onChange({ ...settings, shortcuts: defaultShortcuts }) }}>
          Restore defaults
        </button>
      </div>
    </>
  )
}
