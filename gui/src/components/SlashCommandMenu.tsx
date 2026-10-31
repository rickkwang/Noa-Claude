import { useEffect, useRef, type KeyboardEvent } from "react"
import type { ComposerCommand } from "../agent/commands"
import { Check, ChevronRight } from "../lib/icons"
import {
  IconActivity,
  IconBrain,
  IconBug,
  IconChartPie,
  IconCircleDashed,
  IconCirclePlus,
  IconCpu,
  IconFileText,
  IconGauge,
  IconHelpCircle,
  IconHistory,
  IconMap,
  IconPlayerStop,
  IconRefresh,
  IconSearch,
  IconServer,
  IconSettings,
  IconShield,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react"

function CommandIcon({ command, size = 18 }: { command: ComposerCommand; size?: number }) {
  const name = command.name.toLowerCase()
  const Icon =
    command.action === "new" ? IconCirclePlus
      : command.action === "resume" ? IconHistory
        : command.action === "model" ? IconCpu
          : command.action === "effort" ? IconGauge
            : command.action === "permissions" ? IconShield
              : command.action === "plan" ? IconMap
                : command.action === "settings" ? IconSettings
                  : command.action === "context" ? IconChartPie
                    : command.action === "activity" ? IconActivity
                      : command.action === "help" ? IconHelpCircle
                        : command.action === "stop" ? IconPlayerStop
                          : command.action === "reload" ? IconRefresh
                            : name.includes("review") ? IconBug
                              : name.includes("compact") ? IconCircleDashed
                                : name.includes("mcp") ? IconServer
                                  : name.includes("memor") ? IconBrain
                                    : name.includes("agent") ? IconUsers
                                      : command.group === "Skills" ? IconSparkles : IconFileText
  return <Icon size={size} stroke={1.5} className="shrink-0 text-[var(--sidebar-text-muted)]" />
}

export function SlashCommandMenu({
  items,
  index,
  title,
  query,
  disabled,
  closing,
  onIndex,
  onSelect,
  onQuery,
  onKeyDown,
}: {
  items: ComposerCommand[]
  index: number
  title?: string
  query?: string
  disabled: boolean
  closing?: boolean
  onIndex: (index: number) => void
  onSelect: (command: ComposerCommand) => void
  onQuery?: (query: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [index])
  return (
    <div data-state={closing ? "closing" : "open"} className="noa-slash-menu noa-floating-panel absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-panel bg-[var(--bg-card)]">
      {title && onQuery ? (
        <div className="flex h-9 items-center gap-2 px-3 text-[var(--sidebar-text-muted)]">
          <IconSearch size={15} stroke={1.5} className="shrink-0" />
          <input
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-controls="noa-slash-commands"
            aria-activedescendant={items[index] ? `noa-slash-option-${index}` : undefined}
            aria-label="Search commands"
            autoComplete="off"
            placeholder="Search"
            spellCheck={false}
            value={query ?? ""}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 border-0 bg-transparent text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
          />
        </div>
      ) : null}
      <div
        ref={list}
        id="noa-slash-commands"
        role="listbox"
        aria-label={title ?? "Commands and skills"}
        className="noa-slash-list scrollbar-on-scroll max-h-[min(420px,55vh)] overflow-y-auto p-1"
      >
        {!items.length && (
          <p className="m-0 px-3 py-5 text-center text-body text-[var(--sidebar-text-muted)]">
            {disabled ? "Loading commands…" : "No commands found"}
          </p>
        )}
        {items.map((command, i) => {
          return (
            <div key={`${command.action ?? "cli"}:${command.name}`}>
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
                className={`noa-slash-option flex min-h-9 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-body ${i === index ? "is-selected" : ""} ${command.disabled ? "opacity-40" : ""}`}
              >
                <CommandIcon command={command} />
                <span className={`${command.description ? "max-w-[60%] flex-none" : "min-w-0 flex-1"} truncate font-medium`}>
                  {command.name}
                </span>
                {command.description ? (
                  <span className="min-w-0 flex-1 truncate text-body text-[var(--sidebar-text-muted)]">
                    {command.description}
                  </span>
                ) : null}
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
    </div>
  )
}
