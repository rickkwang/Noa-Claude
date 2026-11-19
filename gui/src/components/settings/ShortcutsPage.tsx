import { useEffect, useState } from "react"
import type { AppSettings } from "../../types"
import {
  SHORTCUT_IDS,
  SHORTCUT_LABELS,
  bindingFromEvent,
  composerShortcutRows,
  defaultShortcuts,
  findShortcutConflict,
  formatBinding,
  type ShortcutId,
} from "../../lib/shortcuts"
import { Row, Section, actionButton } from "./controls"

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
  const [status, setStatus] = useState<{ text: string; danger?: boolean } | null>(null)
  const bindings = settings.shortcuts
  const composerRows = composerShortcutRows(settings.composer.sendShortcut)

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
        setStatus(null)
        return
      }
      if (event.code === "Backspace" || event.code === "Delete") {
        if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          update(recording, "")
          setRecording(null)
          setStatus(null)
        }
        return
      }
      const binding = bindingFromEvent(event)
      if (!binding) return
      const conflict = findShortcutConflict(bindings, recording, binding)
      if (conflict) {
        setStatus({ text: `Already used by ${SHORTCUT_LABELS[conflict]}.`, danger: true })
        return
      }
      update(recording, binding)
      setRecording(null)
      setStatus(null)
    }
    // Any click outside the active trigger cancels recording, so a stale row never captures the next key press.
    const cancel = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`[data-shortcut-trigger="${recording}"]`)) return
      setRecording(null)
      setStatus(null)
    }
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
      <Section title="Global shortcuts">
        {SHORTCUT_IDS.map((id) => {
          const binding = bindings[id]
          const active = recording === id
          return (
            <Row key={id} label={SHORTCUT_LABELS[id]}>
              <span className="flex shrink-0 items-center gap-2">
                {binding && !active && (
                  <button
                    type="button"
                    aria-label={`Clear ${SHORTCUT_LABELS[id]} shortcut`}
                    onClick={() => {
                      update(id, "")
                      setStatus(null)
                    }}
                    className="rounded px-1 text-caption text-[var(--sidebar-text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/35"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  data-shortcut-trigger={id}
                  aria-pressed={active}
                  onClick={() => {
                    setStatus(null)
                    setRecording(active ? null : id)
                  }}
                  className={`inline-flex h-7 min-w-24 items-center justify-center rounded-[10px] border bg-[var(--bg-card)] px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/35 ${
                    active
                      ? "border-[var(--accent-color)] text-[var(--accent-color)] ring-2 ring-[var(--accent-color)]/25"
                      : "border-[var(--border-default)] hover:bg-[var(--settings-fill-hover)]"
                  }`}
                >
                  {active ? (
                    <span className="text-caption font-medium">Press keys…</span>
                  ) : binding ? (
                    <Keys keys={formatBinding(binding)} />
                  ) : (
                    <span className="text-caption text-[var(--sidebar-text-muted)]">None</span>
                  )}
                </button>
              </span>
            </Row>
          )
        })}
      </Section>

      <Section title="Composer & navigation">
        {composerRows.map((row) => (
          <Row key={row.label} label={row.label} description={row.description}>
            <Keys keys={row.keys} />
          </Row>
        ))}
      </Section>

      <div className="flex items-center justify-between gap-4">
        <span
          role="status"
          className={`text-caption ${status?.danger ? "text-[var(--text-danger)]" : "text-[var(--sidebar-text-muted)]"}`}
        >
          {status?.text || (recording ? "Press a shortcut with a modifier key. Esc cancels, Delete clears." : "")}
        </span>
        <button
          type="button"
          disabled={isDefault}
          className={actionButton}
          onClick={() => {
            setStatus(null)
            setRecording(null)
            onChange({ ...settings, shortcuts: defaultShortcuts })
          }}
        >
          Restore defaults
        </button>
      </div>
    </>
  )
}
