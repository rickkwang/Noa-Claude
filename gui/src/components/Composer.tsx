import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { ModelInfo, PermissionMode, SlashCommand } from "../agent/protocol"
import { ChevronDown, FileText, Folder, Monitor, Plus, Settings, X } from "../lib/icons"
import { IconArrowUp, IconShieldCheck } from "@tabler/icons-react"
import type { ReactNode } from "react"
import type { ProjectInfo } from "../api"

export const MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: "default", label: "Ask before acting", description: "Asks before editing files or running commands" },
  {
    value: "auto",
    label: "Approve for me",
    description: "Noa evaluates tool actions and asks when approval is needed",
  },
  { value: "acceptEdits", label: "Edit automatically", description: "Applies file edits without asking" },
  { value: "plan", label: "Plan mode", description: "Plans the work without making changes" },
  { value: "bypassPermissions", label: "Bypass permissions", description: "Runs tools without asking" },
]

interface ComposerProps {
  disabled: boolean
  busy: boolean
  models: ModelInfo[]
  model?: string
  mode?: PermissionMode
  commands: SlashCommand[]
  onSend: (text: string) => void
  onInterrupt: () => void
  onModel: (model: string) => void
  onMode: (mode: PermissionMode) => void
  draftKey: string
  reference?: { path: string; key: number }
  effort?: string
  onEffort: (effort: string | null) => void
  cwd: string
  projects: ProjectInfo[]
  onProject: (cwd: string) => void
  // Current git branch of the project, shown in the environment popover.
  branch?: string
  onFiles: () => void
  newTask: boolean
  contextPercent?: number
  changes?: { count: number; additions: number; deletions: number }
  onChanges: () => void
}

// Noa-styled composer: a rounded card with a hairline ring, slash menu, model and mode pickers.
export function Composer({
  disabled,
  busy,
  models,
  model,
  mode,
  commands,
  onSend,
  onInterrupt,
  onModel,
  onMode,
  draftKey,
  reference,
  effort,
  onEffort,
  cwd,
  projects,
  onProject,
  branch,
  onFiles,
  newTask,
  contextPercent,
  changes,
  onChanges,
}: ComposerProps) {
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "")
  const [references, setReferences] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${draftKey}:references`) ?? "[]")
    } catch {
      return []
    }
  })
  const [composing, setComposing] = useState(false)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const envRef = useRef<HTMLDivElement>(null)
  const [envOpen, setEnvOpen] = useState(false)
  useEffect(() => {
    if (!envOpen) return
    const close = (event: MouseEvent) => {
      if (!envRef.current?.contains(event.target as Node)) setEnvOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setEnvOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [envOpen])

  useEffect(() => {
    if (text) localStorage.setItem(draftKey, text)
    else localStorage.removeItem(draftKey)
  }, [text, draftKey])
  useEffect(() => {
    if (references.length) localStorage.setItem(`${draftKey}:references`, JSON.stringify(references))
    else localStorage.removeItem(`${draftKey}:references`)
  }, [references, draftKey])

  useEffect(() => {
    if (!reference) return
    setReferences((items) => (items.includes(reference.path) ? items : [...items, reference.path]))
    textareaRef.current?.focus()
  }, [reference])

  // Slash menu: shown while the input is a single "/word" token.
  const slashQuery = text.match(/^\/(\S*)$/)?.[1]
  const menuItems = useMemo(() => {
    if (slashQuery === undefined) return []
    const q = slashQuery.toLowerCase()
    return commands.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8)
  }, [commands, slashQuery])
  const menuOpen = slashQuery !== undefined && menuItems.length > 0 && !menuDismissed

  useEffect(() => {
    setMenuIndex(0)
    setMenuDismissed(false)
  }, [slashQuery])

  // Grow the textarea with its content, up to the CSS max-height.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed || disabled || busy) return
    onSend(
      references.length
        ? `${trimmed}\n\nReferenced project files:\n${references.map((path) => `- ${JSON.stringify(path)}`).join("\n")}`
        : trimmed,
    )
    setText("")
    setReferences([])
  }

  function pickCommand(command: SlashCommand) {
    setText(`/${command.name} `)
    textareaRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // CJK IME: Enter confirms a composition and must not send.
    if (composing || e.nativeEvent.isComposing || e.keyCode === 229) return

    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const step = e.key === "ArrowDown" ? 1 : -1
        setMenuIndex((i) => (i + step + menuItems.length) % menuItems.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        pickCommand(menuItems[menuIndex]!)
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setMenuDismissed(true)
        return
      }
    }

    if (e.key === "Escape" && busy) {
      e.preventDefault()
      onInterrupt()
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const currentModel = findModel(models, model)
  const currentMode = MODE_OPTIONS.find((m) => m.value === mode)
  const modelItems: PickerItem[] = models.map((m, i) => ({
    key: m.value,
    title: m.displayName,
    description: m.description,
    active: m.value === currentModel?.value,
    onSelect: () => onModel(m.value),
    heading: i === 0 ? "Model" : undefined,
  }))
  if (currentModel?.supportsEffort) {
    modelItems.push({
      key: "effort-default",
      title: "Default effort",
      description: "Use the model's default",
      active: !effort,
      onSelect: () => onEffort(null),
      heading: "Reasoning effort",
    })
    for (const level of currentModel.supportedEffortLevels ?? [])
      modelItems.push({
        key: `effort-${level}`,
        title: level.charAt(0).toUpperCase() + level.slice(1),
        description: "",
        active: effort === level,
        onSelect: () => onEffort(level),
      })
  }

  return (
    <div className="noa-agent-composer relative">
      {changes && changes.count > 0 && !newTask && (
        <div className="mb-3 flex justify-center">
          <button
            onClick={onChanges}
            title="Workspace changes; line totals cover tracked files"
            className="noa-press flex items-center gap-1.5 rounded-2xl border border-[var(--divider-subtle)] bg-[var(--surface-page)] px-3 py-1.5 text-body text-[var(--sidebar-text)]"
          >
            {changes.count} files changed
            {changes.additions > 0 && <span className="text-[#16A34A]">+{changes.additions}</span>}
            {changes.deletions > 0 && <span className="text-[#EF654B]">-{changes.deletions}</span>}
          </button>
        </div>
      )}
      {newTask && (
        <div className="noa-agent-environment flex items-center gap-4 text-body text-[var(--sidebar-text)]">
          <Picker
            align="left"
            label={
              <>
                <Folder size={15} />
                <span className="max-w-36 truncate">{cwd.split("/").pop()}</span>
              </>
            }
            items={projects
              .filter((p) => !p.missing)
              .map((p) => ({
                key: p.path,
                title: p.name,
                description: p.path,
                active: p.path === cwd,
                onSelect: () => onProject(p.path),
              }))}
          />
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Monitor size={15} />
            This computer
          </span>
          <div ref={envRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setEnvOpen((open) => !open)}
              aria-label="Configure local environment"
              aria-expanded={envOpen}
              className="block rounded-md p-1 noa-sidebar-hover-surface-subtle"
            >
              <Settings size={16} />
            </button>
            {envOpen && (
              <div
                role="dialog"
                aria-label="Configure local environment"
                className="noa-floating-panel absolute bottom-full right-0 z-30 mb-2 w-64 rounded-panel bg-[var(--bg-card,#FFFFFF)] p-1 text-left text-body"
              >
                <p className="m-0 px-2.5 pb-1 pt-1.5 text-caption text-[var(--sidebar-text-muted,#898781)]">
                  Configure local environment
                </p>
                <div
                  className="flex h-8 items-center justify-between px-2.5 text-[var(--sidebar-text-muted,#898781)]"
                  title="Worktrees are not available in Noa yet"
                >
                  New worktree
                  <span aria-hidden="true" className="h-4 w-7 rounded-full bg-[var(--divider-subtle)] opacity-60" />
                </div>
                <div className="flex h-8 items-center justify-between gap-3 px-2.5">
                  Branch
                  <span className="min-w-0 truncate text-[var(--sidebar-text-muted,#898781)]">
                    {branch ?? "No git repo"}
                  </span>
                </div>
                <div className="flex h-8 items-center justify-between px-2.5 text-[var(--sidebar-text-muted,#898781)]">
                  Environment
                  <span>No environment</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {menuOpen && (
        <div className="noa-floating-panel absolute bottom-full left-0 right-0 z-30 mb-2 max-h-80 overflow-y-auto rounded-panel bg-[var(--bg-card,#FFFFFF)] p-1">
          {menuItems.map((command, i) => (
            <button
              key={command.name}
              type="button"
              aria-selected={i === menuIndex}
              onMouseEnter={() => setMenuIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pickCommand(command)
              }}
              className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left ${
                i === menuIndex ? "bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)]" : ""
              }`}
            >
              <span className="text-body font-medium">
                /{command.name}
                {command.argumentHint && (
                  <span className="text-[var(--sidebar-text-muted,#898781)]"> {command.argumentHint}</span>
                )}
              </span>
              <span className="line-clamp-2 text-caption text-[var(--sidebar-text-muted,#898781)]">
                {command.description}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="noa-agent-input relative flex flex-col">
        {references.length === 0 && <div aria-hidden="true" className="h-3.5 shrink-0" />}
        {references.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pb-1.5 pt-2">
            {references.map((path) => (
              <span
                key={path}
                className="flex max-w-full items-center gap-1 rounded-md bg-[var(--surface-page)] px-2 py-1 text-caption"
              >
                <FileText size={12} />
                <span className="truncate" title={path}>
                  {path}
                </span>
                <button
                  aria-label={`Remove reference ${path}`}
                  onClick={() => setReferences((items) => items.filter((item) => item !== path))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder={disabled ? "Starting Noa…" : newTask ? "Do anything" : "Work with Noa"}
          aria-label="Task instruction"
          disabled={disabled}
          rows={1}
          className="w-full min-h-[44px] max-h-60 resize-none border-none bg-transparent px-3 py-0 text-body leading-5 outline-none placeholder:text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]"
        />
        <div className="noa-agent-footer mb-2 mt-1 flex min-h-7 items-center justify-between gap-[5px] px-2">
          <div className="flex min-w-0 items-center gap-1">
            <Picker
              align="left"
              hideChevron
              iconOnly
              label={<Plus size={20} />}
              ariaLabel="Add task context"
              items={[
                {
                  key: "files",
                  title: "Reference project files",
                  description: "Browse files and add a path to this task",
                  active: false,
                  onSelect: onFiles,
                },
                {
                  key: "commands",
                  title: "Commands",
                  description: "Browse Noa commands and skills",
                  active: false,
                  onSelect: () => {
                    setText("/")
                    textareaRef.current?.focus()
                  },
                },
              ]}
            />
            <Picker
              align="left"
              hideChevron
              label={
                <>
                  <IconShieldCheck size={16} stroke={1.5} />
                  <span className="noa-agent-mode-label">{currentMode?.label ?? "Permissions"}</span>
                </>
              }
              ariaLabel={currentMode?.label ?? "Permissions"}
              disabled={disabled || busy}
              tone={mode === "bypassPermissions" ? "danger" : undefined}
              items={MODE_OPTIONS.filter(
                (m) => m.value !== "auto" || currentModel?.supportsAutoMode || mode === "auto",
              ).map((m) => ({
                key: m.value,
                title: m.label,
                description: m.description,
                active: m.value === mode,
                onSelect: () => onMode(m.value),
              }))}
            />
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {contextPercent !== undefined && (
              <span
                role="img"
                aria-label={`Context usage ${Math.round(contextPercent)}%`}
                title={`Context usage: ${Math.round(contextPercent)}%`}
                className="size-3.5 shrink-0 rounded-full"
                style={{
                  background: `conic-gradient(var(--sidebar-text-muted) ${Math.min(100, contextPercent)}%, var(--divider-subtle) 0)`,
                }}
              >
                <span className="m-[2.5px] block size-[9px] rounded-full bg-[var(--surface-page)]" />
              </span>
            )}
            <Picker
              ariaLabel="Model and reasoning effort"
              label={
                <>
                  <span className="noa-agent-model-name max-w-[112px] truncate text-[var(--text-primary)]">
                    {currentModel?.displayName ?? model ?? "Model"}
                  </span>
                  {currentModel?.supportsEffort && effort && (
                    <span className="noa-agent-effort-label capitalize text-[var(--sidebar-text-muted)]">{effort}</span>
                  )}
                </>
              }
              disabled={disabled || busy || models.length === 0}
              items={modelItems}
            />
            {busy ? (
              <button
                type="button"
                onClick={onInterrupt}
                aria-label="Stop (Esc)"
                title="Stop (Esc)"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary,#2D2D2B)] text-[var(--surface-page,#FFFFFF)] noa-press"
              >
                <span aria-hidden="true" className="block size-2.5 rounded-[2px] bg-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !text.trim()}
                aria-label="Run task"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary,#2D2D2B)] text-[var(--surface-page,#FFFFFF)] transition-opacity hover:opacity-90 disabled:opacity-25 noa-press"
              >
                <IconArrowUp size={18} stroke={1.8} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// The agent reports full model IDs (claude-opus-5-5) while the list uses aliases (opus, default).
function findModel(models: ModelInfo[], model: string | undefined): ModelInfo | undefined {
  if (!model) return undefined
  const exact = models.find((m) => m.value === model)
  if (exact) return exact
  const family = model.match(/(?:^|[-/])(opus|sonnet|haiku|fable)(?:-|$)/)?.[1]
  return family ? models.find((m) => m.value === family || m.value === `${family}[1m]`) : undefined
}

interface PickerItem {
  key: string
  title: string
  description: string
  active: boolean
  onSelect: () => void
  heading?: string
}

function Picker({
  label,
  items,
  disabled,
  tone,
  align,
  hideChevron,
  ariaLabel,
  iconOnly,
}: {
  label: ReactNode
  items: PickerItem[]
  disabled?: boolean
  tone?: "danger"
  align?: "left"
  hideChevron?: boolean
  ariaLabel?: string
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-h-7 min-w-0 items-center gap-1 whitespace-nowrap rounded-full ${iconOnly ? "w-7 justify-center p-0" : "px-2"} text-body font-normal leading-[18px] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] disabled:opacity-50 ${
          tone === "danger" ? "text-[#C24444]" : "text-[var(--sidebar-text,#52514E)]"
        }`}
      >
        {label}
        {!hideChevron && <ChevronDown size={11} />}
      </button>
      {open && (
        <div
          className={`noa-floating-panel absolute bottom-full ${align === "left" ? "left-0" : "right-0"} z-30 mb-2 max-h-[55vh] w-64 max-w-[80vw] overflow-auto rounded-panel bg-[var(--bg-card,#FFFFFF)] p-1`}
        >
          {items.map((item) => (
            <div key={item.key}>
              {item.heading && (
                <div className="px-2.5 pb-1 pt-2 text-caption text-[var(--sidebar-text-muted)]">{item.heading}</div>
              )}
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  item.onSelect()
                  setOpen(false)
                }}
                aria-pressed={item.active}
                className={`flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left ${
                  item.active
                    ? "bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)]"
                    : "hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]"
                }`}
              >
                <span className="text-body font-medium">{item.title}</span>
                {item.description && (
                  <span className="break-words text-caption text-[var(--sidebar-text-muted,#898781)]">
                    {item.description}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
