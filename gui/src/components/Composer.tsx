import { SlashCommandMenu } from "./SlashCommandMenu"
import { composerCommands, findComposerCommand, filterComposerCommands, slashAtCaret, type ComposerCommand, type GuiCommandAction } from "../agent/commands"
import { loadImageDraft, saveImageDraft } from "../agent/imageDrafts"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import type { ImageAttachment, UserContent, ModelInfo, PermissionMode, SlashCommand } from "../agent/protocol"
import { Check, Edit2, FileText, RotateCcw, X } from "../lib/icons"
import { Lightbox } from "./Lightbox"
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

type MentionEntry = { name: string; path: string; directory: boolean }

// An @ token at a word boundary, from the @ through the caret. Email addresses don't match because
// the @ must follow the start of the line or whitespace.
function mentionAtCaret(value: string, caret: number): { query: string; start: number; end: number } | undefined {
  const before = value.slice(0, caret)
  const match = before.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return undefined
  const query = match[1]!
  return { query, start: caret - query.length - 1, end: caret }
}

interface ComposerProps {
  disabled: boolean
  busy: boolean
  models: ModelInfo[]
  model?: string
  mode?: PermissionMode
  commands: SlashCommand[]
  onSend: (content: UserContent) => boolean
  onCommand: (action: GuiCommandAction) => void
  onInterrupt: () => void
  onModel: (model: string) => void
  onMode: (mode: PermissionMode) => void
  draftKey: string
  reference?: { path: string; key: number }
  // Loads an existing user message back into the composer when the user clicks Edit.
  editDraft?: { text: string; images: ImageAttachment[]; key: number; label?: string }
  onCancelEdit?: () => void
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
  onCommand,
  onInterrupt,
  onModel,
  onMode,
  draftKey,
  reference,
  editDraft,
  onCancelEdit,
  effort,
  onEffort,
  cwd,
  projects,
  onProject,
  branch,
  onFiles,
  newTask,
  contextPercent,
}: ComposerProps) {
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "")
  const [references, setReferences] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${draftKey}:references`) ?? "[]")
    } catch {
      return []
    }
  })
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [imagesLoaded, setImagesLoaded] = useState(false)
  const initialDraftKey = useRef(draftKey)
  useEffect(() => {
    let cancelled = false
    loadImageDraft(initialDraftKey.current).then((saved) => {
      if (!cancelled) { setImages(saved); setImagesLoaded(true) }
    }).catch(() => {
      if (!cancelled) { setAttachmentError("Could not restore image attachments."); setImagesLoaded(true) }
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!imagesLoaded) return
    saveImageDraft(draftKey, images).catch(() => setAttachmentError("Could not save image drafts. Keep this task open until you send or copy the images."))
  }, [imagesLoaded, images, draftKey])
  const [attachmentError, setAttachmentError] = useState<string>()
  const [loadingImages, setLoadingImages] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  async function addImages(files: File[]) {
    if (!imagesLoaded) return
    setAttachmentError(undefined)
    setLoadingImages(true)
    try {
      const loaded: ImageAttachment[] = []
      for (const file of files) {
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) throw new Error("Use PNG, JPEG, GIF or WebP images.")
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MB image limit.`)
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
          reader.readAsDataURL(file)
        })
        loaded.push({ id: crypto.randomUUID(), name: file.name, dataUrl })
      }
      setImages((current) => {
        if ([...current, ...loaded].reduce((size, image) => size + image.dataUrl.length, 0) > 28 * 1024 * 1024) {
          setAttachmentError("Images exceed the 20 MB combined limit. Remove an image and try again.")
          return current
        }
        return [...current, ...loaded]
      })
    } catch (error) { setAttachmentError((error as Error).message) }
    finally { setLoadingImages(false) }
  }
  const [composing, setComposing] = useState(false)
  // macOS Electron dispatches a final Enter with isComposing=false just after compositionend.
  // The timestamp guard keeps that phantom key from sending a half-finished CJK sentence.
  const compositionEndAt = useRef(-1)
  const [imagePreview, setImagePreview] = useState<number>()
  const [caret, setCaret] = useState(0)
  const [mentionItems, setMentionItems] = useState<MentionEntry[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [mentionLoading, setMentionLoading] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserAction, setBrowserAction] = useState<GuiCommandAction>()
  const [browserFilter, setBrowserFilter] = useState<string>()
  const composerRef = useRef<HTMLDivElement>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissed, setMenuDismissed] = useState(false)
  const [browserSearch, setBrowserSearch] = useState("")
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

  // Editing a sent message replaces the draft with its text and images.
  useEffect(() => {
    if (!editDraft) return
    setText(editDraft.text)
    setImages(editDraft.images)
    setReferences([])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(editDraft.text.length, editDraft.text.length)
    })
  }, [editDraft?.key])

  const currentModel = findModel(models, model)
  const currentMode = MODE_OPTIONS.find((m) => m.value === mode)
  const effortLevels = currentModel?.supportsEffort ? (currentModel.supportedEffortLevels ?? []) : []
  const allCommands = useMemo(() => composerCommands(commands).map((command) => ({
    ...command,
    disabled: command.action === "stop" ? !busy : ["model", "effort", "permissions", "plan", "reload"].includes(command.action ?? "") ? disabled || busy : command.action ? false : disabled,
  })), [commands, disabled, busy])
  const slash = slashAtCaret(text, caret)
  const argumentCommand = slash?.argument !== undefined ? findComposerCommand(allCommands, slash.query) : undefined
  const submenu = browserAction ?? (argumentCommand?.action && ["model", "effort", "permissions"].includes(argumentCommand.action) ? argumentCommand.action : undefined)
  const slashQuery = browserOpen ? browserSearch : submenu ? slash?.argument ?? "" : slash?.argument === undefined ? slash?.query : undefined
  const choices: ComposerCommand[] = submenu === "model"
    ? models.map((m) => ({ name: m.displayName, value: m.value, aliases: [m.value], description: m.description, argumentHint: "", action: "model", group: "Models", active: m.value === currentModel?.value, disabled: disabled || busy }))
    : submenu === "effort"
      ? [{ name: "Default", value: "default", description: "Use the model default", argumentHint: "", action: "effort", group: "Reasoning effort", active: !effort, disabled: disabled || busy }, ...effortLevels.map((level) => ({ name: level, value: level, description: "", argumentHint: "", action: "effort" as const, group: "Reasoning effort", active: level === effort, disabled: disabled || busy }))]
      : submenu === "permissions"
        ? MODE_OPTIONS.filter((option) => option.value !== "auto" || currentModel?.supportsAutoMode || mode === "auto").map((option) => ({ name: option.label, value: option.value, description: option.description, argumentHint: "", action: "permissions", group: "Permissions", active: option.value === mode, disabled: disabled || busy }))
        : allCommands.filter((command) => !browserFilter || command.group === browserFilter)
  const menuItems = filterComposerCommands(choices, slashQuery ?? "")
  const menuOpen = !menuDismissed && (browserOpen || (!browserAction && inputFocused && slashQuery !== undefined))
  const menuTitle = submenu === "model" ? "Model" : submenu === "effort" ? "Reasoning effort" : submenu === "permissions" ? "Permissions" : browserFilter
  const mention = inputFocused ? mentionAtCaret(text, caret) : undefined
  const mentionOpen = !!mention && !mentionDismissed && !menuOpen && !disabled

  useEffect(() => { setMentionDismissed(false); setMentionIndex(0) }, [mention?.query])
  useEffect(() => {
    if (!mention) { setMentionItems([]); return }
    let cancelled = false
    const controller = new AbortController()
    // Debounced: typing a path shouldn't fire a git ls-files walk per keystroke.
    const timer = setTimeout(() => {
      setMentionLoading(true)
      fetch(`/api/files?cwd=${encodeURIComponent(cwd)}&search=${encodeURIComponent(mention.query)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : { entries: [] })
        .then((body: { entries?: MentionEntry[] }) => {
          if (!cancelled) setMentionItems((body.entries ?? []).filter((entry) => !entry.directory).slice(0, 50))
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setMentionLoading(false) })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
  }, [mention?.query, cwd])

  useEffect(() => { setMenuIndex(0); setMenuDismissed(false) }, [slashQuery, submenu, browserFilter, menuItems.length])
  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setMenuDismissed(true)
        setBrowserOpen(false)
        setBrowserAction(undefined)
        setBrowserSearch("")
      }
    }
    document.addEventListener("mousedown", onOutside)
    return () => document.removeEventListener("mousedown", onOutside)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMenuDismissed(true)
      setBrowserOpen(false)
      setBrowserAction(undefined)
      setBrowserSearch("")
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    window.addEventListener("keydown", onEscape, true)
    return () => window.removeEventListener("keydown", onEscape, true)
  }, [menuOpen])

  // Grow the textarea with its content, up to the CSS max-height.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  function submit() {
    const trimmed = text.trim()
    if ((!trimmed && !images.length) || disabled || loadingImages || !imagesLoaded) return
    const parsed = trimmed.match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/)
    if (parsed) {
      const command = findComposerCommand(allCommands, parsed[1]!)
      if (!command) { setAttachmentError(`Unknown command /${parsed[1]}. Use /help to browse available commands.`); return }
      if (command.action) { runGuiCommand(command, parsed[2]?.trim() ?? ""); return }
    } else if (trimmed === "/") { setMenuDismissed(false); return }
    const prompt = references.length
        ? `${trimmed}\n\nReferenced project files:\n${references.map((path) => `- ${JSON.stringify(path)}`).join("\n")}`
        : trimmed
    const content: UserContent = images.length ? [
      ...images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.dataUrl.slice(5, image.dataUrl.indexOf(";")), data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) } })),
      ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
    ] : prompt
    if (!onSend(content)) { setAttachmentError("Message was not sent. Reconnect and try again."); return }
    setAttachmentError(undefined)
    setImages([])
    setText("")
    setReferences([])
  }

  function runGuiCommand(command: ComposerCommand, value: string) {
    if (command.disabled) { setAttachmentError(busy ? "Stop the current turn before changing this setting." : "Noa is still connecting."); return }
    setAttachmentError(undefined)
    const action = command.action!
    if (["model", "effort", "permissions"].includes(action) && !value) {
      setBrowserSearch("")
      if (slash) { replaceSlash(`/${command.name} `); setBrowserOpen(false) }
      else { setBrowserAction(action); setBrowserOpen(true) }
      textareaRef.current?.focus(); return
    }
    if (action === "model") onModel(value)
    else if (action === "effort") {
      if (value !== "default" && !effortLevels.includes(value)) { setAttachmentError("Choose one of this model’s supported effort levels."); return }
      onEffort(value === "default" ? null : value)
    } else if (action === "permissions") {
      if (!MODE_OPTIONS.some((option) => option.value === value && (value !== "auto" || currentModel?.supportsAutoMode || mode === "auto"))) { setAttachmentError("Choose an available permission mode."); return }
      onMode(value as PermissionMode)
    } else if (action === "help" || action === "skills") {
      setBrowserFilter(action === "skills" ? "Skills" : undefined)
      setBrowserSearch(""); setBrowserOpen(true); setBrowserAction(undefined); setMenuDismissed(false); if (slash) replaceSlash(""); textareaRef.current?.focus(); return
    } else {
      if (value) { setAttachmentError(`/${command.name} does not take arguments.`); return }
      onCommand(action)
    }
    if (slash) replaceSlash("")
    setBrowserOpen(false); setBrowserAction(undefined); setBrowserSearch(""); setMenuDismissed(true)
  }

  function pickCommand(command: ComposerCommand, completeOnly = false) {
    if (command.disabled) return
    if (command.value !== undefined) { runGuiCommand(command, command.value); return }
    if (command.action && !completeOnly) { runGuiCommand(command, ""); return }
    if (command.type === "local" && !command.argumentHint && !completeOnly) {
      if (!onSend(`/${command.name}`)) { setAttachmentError("Message was not sent. Reconnect and try again."); return }
      if (slash) replaceSlash("")
    } else if (slash) replaceSlash(`/${command.name} `)
    else setText(`/${command.name} `)
    setBrowserOpen(false); setBrowserAction(undefined); setBrowserFilter(undefined); setBrowserSearch(""); setMenuDismissed(false)
    textareaRef.current?.focus()
  }

  function replaceSlash(next: string, focus = true) {
    if (!slash) return
    setText((value) => value.slice(0, slash.start) + next + value.slice(slash.end))
    const position = slash.start + next.length
    setCaret(position)
    if (!focus) return
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(position, position)
    })
  }

  function pickMention(entry: MentionEntry) {
    if (!mention) return
    setReferences((items) => (items.includes(entry.path) ? items : [...items, entry.path]))
    setText((value) => value.slice(0, mention.start) + value.slice(mention.end))
    setCaret(mention.start)
    setMentionDismissed(true)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(mention.start, mention.start)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    // CJK IME: Enter confirms a composition and must not send.
    if (composing || e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.defaultPrevented) return
    if (e.key === "Enter" && performance.now() - compositionEndAt.current < 500) return

    if (mentionOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        if (mentionItems.length) setMentionIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + mentionItems.length) % mentionItems.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (mentionItems.length) {
          e.preventDefault()
          pickMention(mentionItems[mentionIndex] ?? mentionItems[0]!)
          return
        }
        if (mentionLoading) { e.preventDefault(); return }
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setMentionDismissed(true)
        return
      }
    }

    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const step = e.key === "ArrowDown" ? 1 : -1
        if (menuItems.length) setMenuIndex((i) => {
          let next = i
          for (let attempts = 0; attempts < menuItems.length; attempts++) {
            next = (next + step + menuItems.length) % menuItems.length
            if (!menuItems[next]?.disabled) return next
          }
          return i
        })
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        if (menuItems[menuIndex]) pickCommand(menuItems[menuIndex], e.key === "Tab")
        else if (e.key === "Enter") submit()
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

  const modelItems: PickerItem[] = models.map((m, i) => ({
    key: m.value,
    title: m.value === "default" ? "Default" : m.displayName,
    description: m.value === "default" ? "Use the recommended model" : "",
    active: m.value === currentModel?.value,
    onSelect: () => onModel(m.value),
    heading: i === 0 ? "Select model" : undefined,
  }))

  return (
    <div ref={composerRef} className="noa-agent-composer relative">
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
      {mentionOpen && (
        <div className="noa-slash-menu noa-floating-panel absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-panel bg-[var(--bg-card)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--divider-subtle)] px-2.5 py-1.5 text-caption text-[var(--sidebar-text-muted)]">
            <span>Reference a file</span>
            {mention?.query && <span className="truncate font-mono">@{mention.query}</span>}
          </div>
          <div id="noa-file-mentions" role="listbox" aria-label="Project files" className="max-h-[min(320px,45vh)] overflow-y-auto p-1">
            {!mentionItems.length && (
              <p className="m-0 px-3 py-5 text-center text-body text-[var(--sidebar-text-muted)]">
                {mentionLoading ? "Searching…" : "No matching files"}
              </p>
            )}
            {mentionItems.map((entry, i) => {
              const cut = entry.path.lastIndexOf("/")
              return (
                <button
                  id={`noa-file-option-${i}`}
                  key={entry.path}
                  type="button"
                  role="option"
                  aria-selected={i === mentionIndex}
                  onMouseEnter={() => setMentionIndex(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickMention(entry)}
                  className={`noa-slash-option flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-body ${i === mentionIndex ? "is-selected" : ""}`}
                >
                  <FileText size={15} className="shrink-0 text-[var(--sidebar-text-muted)]" />
                  <span className="min-w-0 truncate">{entry.name}</span>
                  {cut > 0 && <span className="min-w-0 flex-1 truncate text-right text-caption text-[var(--sidebar-text-muted)]">{entry.path.slice(0, cut + 1)}</span>}
                </button>
              )
            })}
          </div>
          <div className="flex gap-3 border-t border-[var(--divider-subtle)] px-3 py-1.5 text-[11px] text-[var(--sidebar-text-muted)]">
            <span>↑↓ Navigate</span>
            <span>↵ Reference</span>
            <span className="ml-auto">Esc Close</span>
          </div>
        </div>
      )}
      {menuOpen && (
        <SlashCommandMenu
          items={menuItems}
          index={menuIndex}
          title={menuTitle}
          query={slashQuery}
          disabled={disabled}
          onIndex={setMenuIndex}
          onSelect={pickCommand}
          onQuery={(value) => {
            if (argumentCommand) {
              replaceSlash(`/${argumentCommand.name} ${value}`, false)
            } else {
              setBrowserSearch(value)
            }
          }}
          onKeyDown={onKeyDown}
        />
      )}

      <div className="noa-agent-input relative flex flex-col" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault() }} onDrop={(event) => { event.preventDefault(); void addImages(Array.from(event.dataTransfer.files)) }}>
        {editDraft && (
          <div className="flex items-center gap-2 border-b border-[var(--divider-subtle)] px-3 py-1.5 text-caption text-[var(--sidebar-text-muted)]">
            <Edit2 size={12} />
            <span className="min-w-0 flex-1 truncate">{editDraft.label ?? "Edit and resend"}</span>
            <button
              type="button"
              onClick={() => {
                setText("")
                setImages([])
                setReferences([])
                onCancelEdit?.()
              }}
              className="rounded p-0.5 hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] hover:text-[var(--text-primary)]"
              aria-label="Cancel edit"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(event) => { void addImages(Array.from(event.target.files ?? [])); event.target.value = "" }} />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((image) => (
              <div key={image.id} className="relative">
                <button
                  type="button"
                  aria-label={`Preview ${image.name}`}
                  onClick={() => {
                    const index = images.findIndex((item) => item.id === image.id)
                    if (index >= 0) setImagePreview(index)
                  }}
                  className="block cursor-zoom-in overflow-hidden rounded-lg border border-[var(--divider-subtle)] noa-press"
                >
                  <img src={image.dataUrl} alt={image.name} className="size-16 object-cover" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove image ${image.name}`}
                  onClick={() => setImages((current) => current.filter((i) => i.id !== image.id))}
                  className="absolute -right-1 -top-1 rounded-full bg-[var(--bg-card)] p-0.5 shadow-sm"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachmentError && <p role="alert" className="m-0 px-3 pt-2 text-caption text-[#C24444]">{attachmentError}</p>}
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
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => file !== null)
            if (files.length) { event.preventDefault(); void addImages(files) }
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && composerRef.current?.contains(event.relatedTarget)) return
            setInputFocused(false)
            setBrowserOpen(false)
            setBrowserAction(undefined)
            setBrowserSearch("")
          }}
          aria-autocomplete="list"
          aria-controls={mentionOpen ? "noa-file-mentions" : menuOpen ? "noa-slash-commands" : undefined}
          aria-activedescendant={mentionOpen && mentionItems[mentionIndex] ? `noa-file-option-${mentionIndex}` : menuOpen && menuItems[menuIndex] ? `noa-slash-option-${menuIndex}` : undefined}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => { setComposing(false); compositionEndAt.current = performance.now() }}
          placeholder={disabled ? "Starting Noa…" : busy ? "Add a follow-up to the queue…" : newTask ? "Do anything" : "Work with Noa"}
          aria-label="Task instruction"
          disabled={disabled}
          rows={1}
          className="w-full min-h-[44px] max-h-60 resize-none border-none bg-transparent px-3 py-0 text-body leading-5 outline-none placeholder:text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]"
        />
        {argumentCommand?.argumentHint && !submenu && <p className="m-0 px-3 pb-1 text-caption text-[var(--sidebar-text-muted)]">/{argumentCommand.name} {argumentCommand.argumentHint}</p>}
        <div className="noa-agent-footer mb-2 mt-1 flex min-h-7 items-center justify-between gap-[5px] px-2">
          <div className="flex min-w-0 items-center gap-[5px]">
            <Picker
              align="left"
              hideChevron
              iconOnly
              label={<ComposerPlusIcon />}
              ariaLabel="Add task context"
              items={[
                { key: "images", title: "Add images", description: "Choose images, paste a screenshot, or drop images here", active: false, onSelect: () => fileRef.current?.click() },
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
                    setBrowserSearch("")
                    setBrowserOpen(true)
                    setBrowserFilter(undefined)
                    setMenuDismissed(false)
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
            <button
              type="button"
              onClick={busy && !text.trim() && !images.length ? onInterrupt : submit}
              disabled={!busy && (disabled || loadingImages || !imagesLoaded || (!text.trim() && !images.length))}
              aria-label={busy && !text.trim() && !images.length ? "Stop (Esc)" : busy ? "Queue message" : "Run task"}
              title={busy && !text.trim() && !images.length ? "Stop (Esc)" : busy ? "Queue after the current turn" : "Run task"}
              data-action={busy && !text.trim() && !images.length ? "stop" : busy ? "queue" : "send"}
              className="noa-primary-action ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary,#2D2D2B)] text-[var(--surface-page,#FFFFFF)] transition-[opacity,transform] hover:opacity-90 disabled:opacity-25 noa-press"
            >
              {busy && !text.trim() && !images.length
                ? <span aria-hidden="true" className="block size-2.5 rounded-[2px] bg-current" />
                : <ComposerSendIcon />}
            </button>
          </div>
        </div>
      </div>
      {imagePreview !== undefined && images.length > 0 && (
        <Lightbox
          items={images.map((image) => ({ src: image.dataUrl, alt: image.name, name: image.name }))}
          index={Math.min(imagePreview, images.length - 1)}
          onIndex={setImagePreview}
          onClose={() => setImagePreview(undefined)}
        />
      )}
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
