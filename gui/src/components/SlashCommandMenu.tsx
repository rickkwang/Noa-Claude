import { useEffect, useRef } from "react"
import type { ComposerCommand } from "../agent/commands"
import { Check, ChevronRight } from "../lib/icons"
import { IconAdjustments, IconBolt, IconCommand, IconSparkles } from "@tabler/icons-react"

export function SlashCommandMenu({
  items,
  index,
  title,
  disabled,
  onIndex,
  onSelect,
  onBack,
}: {
  items: ComposerCommand[]
  index: number
  title?: string
  disabled: boolean
  onIndex: (index: number) => void
  onSelect: (command: ComposerCommand) => void
  onBack?: () => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [index])
  return (
    <div className="noa-slash-menu noa-floating-panel absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-panel bg-[var(--bg-card)]">
      {title && (
        <div className="flex items-center gap-1 border-b border-[var(--divider-subtle)] px-2 py-1.5 text-caption text-[var(--sidebar-text-muted)]">
          <button
            type="button"
            aria-label="Back to commands"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onBack}
            className="rounded-md p-1 hover:bg-[var(--surface-page)]"
          >
            <ChevronRight size={13} className="rotate-180" />
          </button>
          {title}
        </div>
      )}
      <div
        ref={list}
        id="noa-slash-commands"
        role="listbox"
        aria-label={title ?? "Commands and skills"}
        className="max-h-[min(320px,45vh)] overflow-y-auto p-1"
      >
        {!items.length && (
          <p className="m-0 px-3 py-5 text-center text-body text-[var(--sidebar-text-muted)]">
            {disabled ? "Loading commands…" : "No commands found"}
          </p>
        )}
        {items.map((command, i) => {
          const Icon =
            command.value !== undefined
              ? IconAdjustments
              : command.group === "Skills"
                ? IconSparkles
                : command.action
                  ? IconCommand
                  : IconBolt
          return (
            <div key={`${command.action ?? "cli"}:${command.name}`}>
              {!title && items[i - 1]?.group !== command.group && (
                <div className="px-2 pb-1 pt-2 text-caption text-[var(--sidebar-text-muted)]">{command.group}</div>
              )}
              <button
                id={`noa-slash-option-${i}`}
                type="button"
                tabIndex={-1}
                role="option"
                aria-selected={i === index}
                aria-disabled={command.disabled || undefined}
                onMouseEnter={() => onIndex(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(command)}
                title={command.description}
                className={`noa-slash-option flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-body ${i === index ? "is-selected" : ""} ${command.disabled ? "opacity-40" : ""}`}
              >
                <Icon size={16} stroke={1.5} className="shrink-0 text-[var(--sidebar-text-muted)]" />
                <span className="max-w-[48%] shrink-0 truncate">
                  {command.value === undefined ? `/${command.name}` : command.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-caption text-[var(--sidebar-text-muted)]">
                  {command.description}
                </span>
                {command.active ? (
                  <Check size={14} className="shrink-0" />
                ) : command.action &&
                  ["model", "effort", "permissions", "skills", "help"].includes(command.action) &&
                  command.value === undefined ? (
                  <ChevronRight size={13} className="shrink-0 text-[var(--sidebar-text-muted)]" />
                ) : null}
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3 border-t border-[var(--divider-subtle)] px-3 py-1.5 text-[11px] text-[var(--sidebar-text-muted)]">
        <span>↑↓ Navigate</span>
        <span>↵ Select</span>
        <span>Tab Complete</span>
        <span className="ml-auto">Esc Close</span>
      </div>
    </div>
  )
}
