import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { ModelInfo, PermissionMode, SlashCommand } from "../agent/protocol"
import { Check, FileText, RotateCcw, X } from "../lib/icons"
import { IconShieldCheck } from "@tabler/icons-react"
import {
  ComposerApprovalIcon,
  ComposerChevronIcon,
  ComposerComputerIcon,
  ComposerFolderIcon,
  ComposerPlusIcon,
  ComposerSendIcon,
  ComposerSettingsIcon,
} from "./ComposerIcons"
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
    title: m.value === "default" ? "Default" : m.displayName,
    description: m.value === "default" ? "Use the recommended model" : "",
    active: m.value === currentModel?.value,
    onSelect: () => onModel(m.value),
    heading: i === 0 ? "Select model" : undefined,
  }))
  const effortLevels = currentModel?.supportsEffort ? (currentModel.supportedEffortLevels ?? []) : []

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
        <div className="noa-agent-environment flex items-center gap-2 text-chat-sm text-[var(--sidebar-text)]">
          <Picker
            align="left"
            hideChevron
            label={
              <>
                <ComposerFolderIcon />
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
          <span className="flex h-7 items-center gap-1.5 whitespace-nowrap px-2">
            <ComposerComputerIcon />
            This computer
          </span>
          <div ref={envRef} className="relative ml-auto">
            <button
              type="button"
              onClick={() => setEnvOpen((open) => !open)}
              aria-label="Configure local environment"
              aria-expanded={envOpen}
              className="flex size-7 items-center justify-center rounded-full noa-sidebar-hover-surface-subtle"
            >
              <ComposerSettingsIcon />
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
          <div className="flex min-w-0 items-center gap-[5px]">
            <Picker
              align="left"
              hideChevron
              iconOnly
              label={<ComposerPlusIcon />}
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
                  {mode === "default" || !mode ? <ComposerApprovalIcon /> : <IconShieldCheck size={16} stroke={1.5} />}
                  <span className="noa-agent-mode-label">{currentMode?.label ?? "Permissions"}</span>
                </>
              }
              ariaLabel={currentMode?.label ?? "Permissions"}
              compactPadding
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
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {contextPercent !== undefined && (
              <svg
                role="img"
                aria-label={`Context usage ${Math.round(contextPercent)}%`}
                width={12}
                height={12}
                viewBox="0 0 12 12"
                className="shrink-0 text-[var(--sidebar-text-muted)]"
              >
                <title>{`Context usage: ${Math.round(contextPercent)}%`}</title>
                <circle cx={6} cy={6} r={5} stroke="currentColor" strokeWidth={2} fill="none" opacity={0.16} />
                <circle
                  cx={6}
                  cy={6}
                  r={5}
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  fill="none"
                  pathLength={100}
                  strokeDasharray={100}
                  strokeDashoffset={100 - Math.min(100, Math.max(0, contextPercent))}
                  opacity={contextPercent > 0 ? 1 : 0}
                  transform="rotate(-90 6 6)"
                />
              </svg>
            )}
            <Picker
              ariaLabel="Model and reasoning effort"
              modelPicker
              label={
                <>
                  <span className="noa-agent-model-name max-w-[112px] truncate text-[var(--text-primary)]">
                    {currentModel?.displayName ?? model ?? "Model"}
                  </span>
                  {currentModel?.supportsEffort && effort && currentModel.supportedEffortLevels?.includes(effort) && (
                    <span className="noa-agent-effort-label capitalize text-[var(--sidebar-text-muted)]">{effort}</span>
                  )}
                </>
              }
              disabled={disabled || busy || models.length === 0}
              items={modelItems}
              header={effortLevels.length > 0 ? (toggleModels) => (
                <EffortSlider
                  levels={effortLevels}
                  effort={effort ?? null}
                  modelName={currentModel?.displayName ?? ""}
                  onEffort={onEffort}
                  onToggleModels={toggleModels}
                />
              ) : undefined}
            />
            {busy ? (
              <button
                type="button"
                onClick={onInterrupt}
                aria-label="Stop (Esc)"
                title="Stop (Esc)"
                className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary,#2D2D2B)] text-[var(--surface-page,#FFFFFF)] noa-press"
              >
                <span aria-hidden="true" className="block size-2.5 rounded-[2px] bg-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={disabled || !text.trim()}
                aria-label="Run task"
                className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary,#2D2D2B)] text-[var(--surface-page,#FFFFFF)] transition-opacity hover:opacity-90 disabled:opacity-25 noa-press"
              >
                <ComposerSendIcon />
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

function EffortSlider({
  levels,
  effort,
  modelName,
  onEffort,
  onToggleModels,
}: {
  levels: string[]
  effort: string | null
  modelName: string
  onEffort: (effort: string | null) => void
  onToggleModels: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const last = levels.length - 1
  // No explicit effort (or one this model lacks) means the model default, shown as "Default" with no thumb.
  const selected = effort ? levels.indexOf(effort) : -1
  const pct = selected >= 0 && last > 0 ? (selected / last) * 100 : 0
  const label = selected >= 0 ? levels[selected]!.charAt(0).toUpperCase() + levels[selected]!.slice(1) : "Default"

  const pick = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - 14) / Math.max(1, rect.width - 28)))
    const level = levels[Math.round(ratio * last)]!
    if (level !== effort) onEffort(level)
  }

  return (
    <div className="noa-model-picker-header">
      <div className="noa-model-picker-controls">
        <button type="button" onClick={onToggleModels} aria-label="Select model" className="noa-model-picker-view">
          <span className="noa-model-picker-labels">
            <span
              className={`text-[13px] font-medium ${selected >= 0 ? "text-[var(--accent-color)]" : "text-[var(--sidebar-text-muted)]"}`}
            >
              {label}
            </span>
            <span className="noa-model-picker-model">{modelName}</span>
            <ComposerChevronIcon width={12} height={12} />
          </span>
        </button>
        <button
          type="button"
          aria-label="Use default effort"
          title="Use default effort"
          disabled={selected < 0}
          onClick={() => onEffort(null)}
          className="noa-model-picker-reset"
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="noa-model-picker-slider">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Reasoning effort"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={Math.max(0, selected)}
          aria-valuetext={label}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            pick(e.clientX)
          }}
          onPointerMove={(e) => {
            if (e.buttons) pick(e.clientX)
          }}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"].includes(e.key)) e.preventDefault()
            if (e.key === "ArrowRight" || e.key === "ArrowUp") onEffort(levels[Math.min(last, selected + 1)]!)
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") onEffort(levels[Math.max(0, selected - 1)]!)
          }}
          className="noa-model-picker-track relative flex cursor-pointer touch-none select-none items-center rounded-full bg-[var(--effort-track)]"
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent-color)]" style={{ width: selected >= 0 ? `calc(14px + (100% - 28px) * ${pct / 100})` : 0 }} />
          {levels.map((level, i) => (
            <span
              key={level}
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--effort-dot)]"
              style={{ left: `calc(14px + (100% - 28px) * ${last > 0 ? i / last : 0})` }}
            />
          ))}
          {selected >= 0 && (
            <span
              className="absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--effort-thumb)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
              style={{ left: `calc(14px + (100% - 28px) * ${pct / 100})` }}
            />
          )}
        </div>
      </div>
    </div>
  )
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
  header,
  modelPicker,
  compactPadding,
}: {
  label: ReactNode
  items: PickerItem[]
  disabled?: boolean
  tone?: "danger"
  align?: "left"
  hideChevron?: boolean
  ariaLabel?: string
  iconOnly?: boolean
  modelPicker?: boolean
  compactPadding?: boolean
  header?: (toggleModels: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [showingModels, setShowingModels] = useState(false)
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
        onClick={() => {
          setShowingModels(false)
          setOpen((o) => !o)
        }}
        className={`flex h-7 min-w-0 items-center gap-1 whitespace-nowrap rounded-full ${iconOnly ? "w-7 justify-center p-0" : compactPadding ? "px-1.5" : "px-2"} text-chat-sm font-normal leading-[18px] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)] disabled:opacity-50 ${
          tone === "danger" ? "text-[#C24444]" : "text-[var(--sidebar-text,#52514E)]"
        }`}
      >
        {label}
        {!hideChevron && <ComposerChevronIcon className="shrink-0 text-[var(--sidebar-text-muted)]" />}
      </button>
      {open && (
        <div
          className={`${modelPicker ? "noa-model-picker" : ""} noa-floating-panel absolute bottom-full ${align === "left" ? "left-0" : "right-0"} z-30 mb-2 max-h-[55vh] w-64 max-w-[80vw] overflow-auto rounded-panel p-1 ${header ? "bg-[var(--effort-menu)]" : "bg-[var(--bg-card,#FFFFFF)]"}`}
        >
          {!showingModels && header?.(() => setShowingModels(true))}
          <div className={modelPicker ? "noa-model-picker-list" : undefined} hidden={!!header && !showingModels}>
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
                  className={modelPicker ? "noa-model-picker-option" : `flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left ${
                    item.active
                      ? "bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)]"
                      : "hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)]"
                  }`}
                >
                  <span className={modelPicker ? "noa-model-picker-option-label" : "text-body font-medium"}>
                    {item.title}
                    {modelPicker && item.active && <Check size={16} aria-hidden="true" />}
                  </span>
                  {item.description && (
                    <span className="break-words text-caption text-[var(--sidebar-text-muted,#898781)]">
                      {item.description}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
