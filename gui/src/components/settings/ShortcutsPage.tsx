import type { AppSettings } from "../../types"
import { Row, Section } from "./controls"

const shortcuts: [string, string[]][] = [
  ["New task", ["⌘", "N"]],
  ["Find tasks", ["⌘", "K"]],
  ["Settings", ["⌘", ","]],
  ["Run instruction", ["Enter"]],
  ["New line", ["Shift", "Enter"]],
  ["Reorder task", ["⌥", "↑/↓"]],
  ["Stop agent", ["Esc"]],
]

export function ShortcutsPage({ sendShortcut }: { sendShortcut: AppSettings["composer"]["sendShortcut"] }) {
  return (
    <Section title="Shortcuts">
      {shortcuts.map(([label, keys]) => (
        <Row key={label} label={label}>
          <span className="flex shrink-0 gap-1">
            {(label === "Run instruction" && sendShortcut === "modifier-enter" ? [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "Enter"] : keys).map((key) => (
              <kbd
                key={key}
                className="flex h-5 min-w-5 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-1.5 text-caption text-[var(--sidebar-text-muted)]"
              >
                {key}
              </kbd>
            ))}
          </span>
        </Row>
      ))}
    </Section>
  )
}
