import { findModel } from "../lib/models"
import { SlashCommandMenu } from "./SlashCommandMenu"
import { composerCommands, findComposerCommand, filterComposerCommands, slashAtCaret, type ComposerCommand, type GuiCommandAction } from "../agent/commands"
import { loadImageDraft, saveImageDraft } from "../agent/imageDrafts"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { startEffortMaxFill } from "./effortMaxFill"
import type { ContextUsage, ImageAttachment, RateLimitInfo, UserContent, ModelInfo, PermissionMode, SlashCommand } from "../agent/protocol"
import { RateLimitNotice } from "./RateLimitNotice"
import { FileAttachmentCard } from "./FileAttachmentCard"
import { Check, Edit2, FileText, List, Photo, Queue, RotateCcw, Steer, Terminal, X } from "../lib/icons"
import { Lightbox } from "./Lightbox"
import { useConfirm } from "./ConfirmDialog"
import { EnvironmentMenu } from "./EnvironmentMenu"
import {
  ComposerApprovalIcon,
  ComposerShieldCodeIcon,
  ComposerShieldWarningIcon,
  ComposerChevronIcon,
  ComposerComputerIcon,
  ComposerFolderIcon,
  ComposerPlusIcon,
  ComposerSendIcon,
} from "./ComposerIcons"
import type { ReactNode } from "react"
import type { ProjectInfo } from "../api"
import type { AgentState } from "../agent/reducer"
import type { AppSettings } from "../types"

const MODE_OPTIONS: { value: PermissionMode; label: string; description: string }[] = [
  { value: "auto", label: "Auto", description: "Noa handles permission decisions" },
  { value: "default", label: "Manual", description: "Always ask before making changes" },
  { value: "acceptEdits", label: "Accept edits", description: "Automatically accept all file edits" },
  { value: "plan", label: "Plan", description: "Create a plan before making changes" },
  { value: "bypassPermissions", label: "Full access", description: "Noa can edit any file and run commands without asking" },
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
  connection: AgentState["connection"]
  readOnly?: boolean
  /** A fork is replacing this session; sends are not held, since the composer remounts for the fork. */
  forking?: boolean
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
  quote?: { text: string; key: number }
  onQuoteConsumed?: () => void
  // Files dropped anywhere on the conversation pane.
  dropped?: { files: File[]; key: number }
  onDroppedConsumed?: () => void
  // Loads an existing user message back into the composer when the user clicks Edit.
  // Text dropped into the draft from outside, e.g. a skill invocation chosen in settings.
  prefill?: { text: string; key: number }
  onPrefillConsumed?: () => void
  editDraft?: { text: string; images: ImageAttachment[]; key: number; label?: string; queued?: boolean; silent?: boolean }
  /** Takes back a draft the app put here (after an undone rewind), unless the user has edited it since. */
  withdrawDraft?: { text: string; key: number }
  onCancelEdit?: () => void
  effort?: string
  onEffort: (effort: string | null) => void
  cwd: string
  projects: ProjectInfo[]
  onProject: (cwd: string) => void
  // Current git branch of the project, shown in the environment popover.
  branch?: string
  // Called after the environment menu checks out or creates a branch.
  onBranchChange: () => void
  // The project checkout when the task runs in a worktree of it; `cwd` is then the worktree.
  worktreeOf?: string
  // Starts or discards the worktree (new tasks only); rejects with a message the menu shows.
  onWorktree: (on: boolean) => Promise<void>
  newTask: boolean
  sendShortcut?: AppSettings["composer"]["sendShortcut"]
  followUpMode?: AppSettings["composer"]["followUpMode"]
  // Full access is hidden from the permission menu until the user opts in from settings.
  showFullAccess?: boolean
  contextUsage?: ContextUsage
  // Usage-limit notice: shown in the environment strip for new tasks, above the composer otherwise.
  rateLimit?: RateLimitInfo
  onDismissRateLimit?: () => void
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

// Noa-styled composer: a rounded card with a hairline ring, slash menu, model and mode pickers.
function persistDraft({ key, text }: { key: string; text: string }) {
  try {
    if (text) localStorage.setItem(key, text)
    else localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}

export const Composer = memo(function Composer({
  connection,
  readOnly,
  forking,
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
  quote,
  onQuoteConsumed,
  dropped,
  onDroppedConsumed,
  prefill,
  onPrefillConsumed,
  editDraft,
  withdrawDraft,
  onCancelEdit,
  effort,
  onEffort,
  cwd,
  projects,
  onProject,
  branch,
  onBranchChange,
  worktreeOf,
  onWorktree,
  newTask,
  contextUsage,
  sendShortcut = "enter",
  followUpMode = "queue",
  showFullAccess = false,
  rateLimit,
  onDismissRateLimit,
}: ComposerProps) {
  const disabled = connection !== "ready"
  // Permission mode and effort can change mid-turn. The model stays fixed while busy: the CLI records
  // a switch by appending transcript messages, which must not land inside a running turn.
  const modelDisabled = !!readOnly || (connection !== "ready" && connection !== "connecting")
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? "")
  const [references, setReferences] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${draftKey}:references`) ?? "[]")
    } catch {
      return []
    }
  })
  // Files and folders dropped from outside, kept as absolute paths and shown as cards beside the images.
  const [files, setFiles] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${draftKey}:files`) ?? "[]")
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
  const [contextOpen, setContextOpen] = useState(false)
  const contextRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!contextOpen) return
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!contextRef.current?.contains(event.target as Node)) setContextOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setContextOpen(false)
    }
    document.addEventListener("pointerdown", closeOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [contextOpen])
  useEffect(() => setContextOpen(false), [draftKey])
  const [attachmentError, setAttachmentError] = useState<string>()
  const [loadingImages, setLoadingImages] = useState(false)
  const [pendingImages, setPendingImages] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  async function addImages(files: File[]) {
    if (!imagesLoaded) return
    setAttachmentError(undefined)
    setLoadingImages(true)
    setPendingImages(files.length)
    try {
      const loaded: ImageAttachment[] = []
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type)) throw new Error("Use PNG, JPEG, GIF or WebP images.")
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
    finally { setLoadingImages(false); setPendingImages(0) }
  }
  // Images become attachments; any other file or folder is attached by its absolute path.
  useEffect(() => {
    if (!dropped) return
    const isImage = (file: File) => IMAGE_TYPES.includes(file.type)
    const paths = dropped.files.filter((file) => !isImage(file)).map((file) => window.noaDesktop?.getPathForFile?.(file))
    const found = paths.filter((path): path is string => !!path)
    if (found.length) setFiles((items) => [...items, ...found.filter((path) => !items.includes(path))])
    const droppedImages = dropped.files.filter(isImage)
    // addImages clears the error first, so report unusable files after it starts.
    if (droppedImages.length) void addImages(droppedImages)
    if (paths.some((path) => !path)) setAttachmentError("Use PNG, JPEG, GIF or WebP images.")
    onDroppedConsumed?.()
    textareaRef.current?.focus()
  }, [dropped?.key])
  function removeImage(image: ImageAttachment) {
    setImages((current) => current.filter((candidate) => candidate.id !== image.id))
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

  // The draft is saved shortly after typing pauses rather than on every keystroke. A pending save
  // is flushed when the draft key changes, on unmount, and when the window is closed.
  const pendingDraft = useRef<{ key: string; text: string } | null>(null)
  useEffect(() => {
    const previous = pendingDraft.current
    if (previous && previous.key !== draftKey) persistDraft(previous)
    pendingDraft.current = { key: draftKey, text }
    const timer = setTimeout(() => {
      if (pendingDraft.current) persistDraft(pendingDraft.current)
      pendingDraft.current = null
    }, 300)
    return () => clearTimeout(timer)
  }, [text, draftKey])
  useEffect(() => {
    const flush = () => {
      if (pendingDraft.current) persistDraft(pendingDraft.current)
      pendingDraft.current = null
    }
    window.addEventListener("pagehide", flush)
    return () => { window.removeEventListener("pagehide", flush); flush() }
  }, [])
  useEffect(() => {
    if (references.length) localStorage.setItem(`${draftKey}:references`, JSON.stringify(references))
    else localStorage.removeItem(`${draftKey}:references`)
  }, [references, draftKey])
  useEffect(() => {
    if (files.length) localStorage.setItem(`${draftKey}:files`, JSON.stringify(files))
    else localStorage.removeItem(`${draftKey}:files`)
  }, [files, draftKey])

  useEffect(() => {
    if (!reference) return
    setReferences((items) => (items.includes(reference.path) ? items : [...items, reference.path]))
    textareaRef.current?.focus()
  }, [reference])

  useEffect(() => {
    if (!quote) return
    setText(value => `${value}${value.trim() ? "\n\n" : ""}${quote.text.split("\n").map(line => `> ${line}`).join("\n")}\n\n`)
    onQuoteConsumed?.()
    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(element.value.length, element.value.length)
    })
  }, [quote?.key])

  useEffect(() => {
    // Waits until the composer can take input, so the text is not dropped while it is still connecting.
    if (!prefill || disabled) return
    setText((current) => {
      const draft = current.trim()
      if (!draft) return prefill.text
      // A draft that is only a slash command is replaced; any other draft keeps its text after the new command.
      if (/^\/\S*$/.test(draft)) return prefill.text
      return `${prefill.text}${current.replace(/^\s+/, "")}`
    })
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    // Consumed once, so a later remount for another task does not insert it again.
    onPrefillConsumed?.()
  }, [prefill?.key, disabled])

  // Editing a sent message replaces the draft with its text and images.
  useEffect(() => {
    if (!editDraft) return
    setText(editDraft.text)
    setImages(editDraft.images)
    setReferences([])
    setFiles([])
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(editDraft.text.length, editDraft.text.length)
    })
  }, [editDraft?.key])

  // A request made before this composer mounted (another task's) is not for this draft.
  const withdrawnKey = useRef(withdrawDraft?.key)
  useEffect(() => {
    if (!withdrawDraft || withdrawnKey.current === withdrawDraft.key) return
    withdrawnKey.current = withdrawDraft.key
    if (text !== withdrawDraft.text) return
    setText("")
    setImages([])
    onCancelEdit?.()
  }, [withdrawDraft?.key])

  const currentModel = findModel(models, model)
  const modelLabelKey = `noa-agent.modelLabel:${cwd}`
  const savedModelLabel = useMemo(() => {
    try { return localStorage.getItem(modelLabelKey) } catch { return null }
  }, [modelLabelKey, disabled])
  useEffect(() => {
    if (disabled || !model) return
    try { localStorage.setItem(modelLabelKey, currentModel?.displayName ?? model) } catch {}
  }, [disabled, modelLabelKey, model, currentModel?.displayName])
  const currentMode = MODE_OPTIONS.find((m) => m.value === (mode ?? "default"))
  // Auto stays listed (greyed out) when the model can't run it; it is hidden only while the model list is loading.
  const autoUnsupported = !!currentModel && !currentModel.supportsAutoMode
  const permissionModes = MODE_OPTIONS.filter(
    (option) =>
      (option.value !== "auto" || currentModel !== undefined || mode === "auto") &&
      (option.value !== "bypassPermissions" || showFullAccess || mode === "bypassPermissions"),
  )
  const { confirm, dialog } = useConfirm()
  // Bypass skips every approval, so entering it needs an explicit confirmation.
  const selectMode = async (value: PermissionMode) => {
    if (value === "bypassPermissions" && mode !== "bypassPermissions" && !(await confirm({
      title: "Bypass permissions?",
      description: "Noa can access the internet and read and edit files without asking for approval, including potentially destructive commands, until you switch modes.",
      confirmLabel: "Confirm",
      danger: true,
    }))) return
    onMode(value)
  }
  const modeUnavailable = (value: PermissionMode) => (value === "bypassPermissions" && connection !== "ready") || (value === "auto" && autoUnsupported && mode !== "auto")
  // Switching to a model that can't run auto drops back to Manual. Startup and resume keep the chosen mode.
  const previousModel = useRef(currentModel?.value)
  useEffect(() => {
    const switched = previousModel.current !== undefined && currentModel?.value !== undefined && previousModel.current !== currentModel.value
    previousModel.current = currentModel?.value ?? previousModel.current
    if (switched && mode === "auto" && autoUnsupported) onMode("default")
  }, [currentModel?.value])
  const effortLevels = currentModel?.supportsEffort ? (currentModel.supportedEffortLevels ?? []) : []
  const allCommands = useMemo(() => composerCommands(commands).map((command) => ({
    ...command,
    disabled: command.action === "stop" ? !busy : ["model", "reload"].includes(command.action ?? "") ? disabled || busy : ["effort", "permissions", "plan"].includes(command.action ?? "") ? disabled : command.action ? false : disabled,
  })), [commands, disabled, busy])
  const slash = slashAtCaret(text, caret)
  const argumentCommand = slash?.argument !== undefined ? findComposerCommand(allCommands, slash.query) : undefined
  const submenu = browserAction ?? (argumentCommand?.action && ["model", "effort", "permissions"].includes(argumentCommand.action) ? argumentCommand.action : undefined)
  const slashQuery = browserOpen ? browserSearch : submenu ? slash?.argument ?? "" : slash?.argument === undefined ? slash?.query : undefined
  const choices: ComposerCommand[] = submenu === "model"
    ? models.map((m) => ({ name: m.displayName, value: m.value, aliases: [m.value], description: m.description, argumentHint: "", action: "model", group: "Models", active: m.value === currentModel?.value, disabled: disabled || busy }))
    : submenu === "effort"
      ? [{ name: "Default", value: "default", description: "Use the model default", argumentHint: "", action: "effort", group: "Reasoning effort", active: !effort, disabled }, ...effortLevels.map((level) => ({ name: level, value: level, description: "", argumentHint: "", action: "effort" as const, group: "Reasoning effort", active: level === effort, disabled }))]
      : submenu === "permissions"
        ? permissionModes.map((option) => ({ name: option.label, value: option.value, description: modeUnavailable(option.value) ? "Not available for the selected model" : option.description, argumentHint: "", action: "permissions", group: "Permissions", active: option.value === mode, disabled: disabled || modeUnavailable(option.value) }))
        : allCommands.filter((command) => !browserFilter || command.group === browserFilter)
  const menuItems = filterComposerCommands(choices, slashQuery ?? "")
  const menuOpen = !menuDismissed && (browserOpen || (!browserAction && inputFocused && slashQuery !== undefined))
  const menuTitle = submenu === "model" ? "Model" : submenu === "effort" ? "Reasoning effort" : submenu === "permissions" ? "Permissions" : browserFilter
  const mention = inputFocused ? mentionAtCaret(text, caret) : undefined
  const mentionOpen = !!mention && !mentionDismissed && !menuOpen && !disabled
  const mentionPresence = usePresence(mentionOpen)
  const slashMenuPresence = usePresence(menuOpen)

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

  // Typing never waits for the CLI to start; a send made while it is still connecting
  // is held and goes out as soon as the connection is ready.
  const [sendWhenReady, setSendWhenReady] = useState(false)
  useEffect(() => {
    if (!sendWhenReady) return
    if (connection === "closed" || forking) setSendWhenReady(false)
    // Wait for attachments still being read, or submit() would return early and drop the held send.
    else if (!disabled && !loadingImages && imagesLoaded) { setSendWhenReady(false); submit() }
  }, [sendWhenReady, connection, disabled, forking, loadingImages, imagesLoaded])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed && !images.length && !files.length) return
    if (disabled) { if (connection === "connecting" && !readOnly && !forking) setSendWhenReady(true); return }
    if (loadingImages || !imagesLoaded) return
    const parsed = trimmed.match(/^\/([\w:.-]+)(?:\s+([\s\S]*))?$/)
    if (parsed) {
      const command = findComposerCommand(allCommands, parsed[1]!)
      if (!command) { setAttachmentError(`Unknown command /${parsed[1]}. Use /help to browse available commands.`); return }
      if (command.action) { runGuiCommand(command, parsed[2]?.trim() ?? ""); return }
    } else if (trimmed === "/") { setMenuDismissed(false); return }
    const prompt = [
      trimmed,
      references.length ? `Referenced project files:\n${references.map((path) => `- ${JSON.stringify(path)}`).join("\n")}` : "",
      files.length ? `Attached files:\n${files.map((path) => `- ${JSON.stringify(path)}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n")
    const content: UserContent = images.length ? [
      ...images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.dataUrl.slice(5, image.dataUrl.indexOf(";")), data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) } })),
      ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
    ] : prompt
    if (!onSend(content)) { setAttachmentError("Message was not sent. Reconnect and try again."); return }
    setAttachmentError(undefined)
    setImages([])
    setText("")
    setReferences([])
    setFiles([])
  }

  function runGuiCommand(command: ComposerCommand, value: string) {
    if (editDraft?.queued) {
      setAttachmentError("This command cannot be queued. Cancel editing to run it.")
      return
    }
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
      if (!permissionModes.some((option) => option.value === value) || modeUnavailable(value as PermissionMode)) { setAttachmentError("Choose an available permission mode."); return }
      void selectMode(value as PermissionMode)
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
      if (e.key === "Tab" || e.key === "Enter" && !e.shiftKey && menuItems[menuIndex]) {
        e.preventDefault()
        if (menuItems[menuIndex]) pickCommand(menuItems[menuIndex], e.key === "Tab")
        return
      }
    }

    if (e.key === "Escape" && busy) {
      e.preventDefault()
      onInterrupt()
      return
    }

    // "modifier-enter-multiline": a single-line draft sends on plain Enter; once it spans lines, Enter needs the modifier.
    const plainEnterSends = sendShortcut === "enter" || (sendShortcut === "modifier-enter-multiline" && !text.includes("\n"))
    if (e.key === "Enter" && !e.shiftKey && (plainEnterSends || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  const modelItems: PickerItem[] = models.map((m, i) => ({
    key: m.value,
    title: m.value === "default" ? "Default" : m.displayName,
    active: m.value === currentModel?.value,
    disabled: busy && m.value !== currentModel?.value,
    onSelect: () => onModel(m.value),
    heading: i === 0 ? "Select model" : undefined,
  }))

  return (
    <div ref={composerRef} data-new-task={newTask || undefined} className="noa-agent-composer relative">
      {newTask && (
        <div className="noa-agent-environment flex items-center gap-2 text-chat-sm">
          {rateLimit && onDismissRateLimit ? <RateLimitNotice info={rateLimit} inline onDismiss={onDismissRateLimit} /> : <>
          <Picker
            align="left"
            hideChevron
            label={
              <>
                <ComposerFolderIcon />
                <span className="min-w-0 truncate">{(worktreeOf ?? cwd).split("/").pop()}</span>
              </>
            }
            items={projects
              .filter((p) => !p.missing)
              .map((p) => ({
                key: p.path,
                title: p.name,
                description: p.path,
                active: p.path === (worktreeOf ?? cwd),
                onSelect: () => onProject(p.path),
              }))}
          />
          {/* Cloud execution is unsupported, so there is nothing to choose: a static label instead of a one-item menu. */}
          <span className="flex h-7 items-center gap-1 px-2 text-[12px] leading-[18px] text-[var(--sidebar-text,#52514E)]">
            <ComposerComputerIcon />This computer
          </span>
          <EnvironmentMenu cwd={cwd} branch={branch} onBranchChange={onBranchChange} worktree={!!worktreeOf} canToggleWorktree={newTask} onWorktree={onWorktree} />
          </>}
        </div>
      )}
      {!newTask && rateLimit && onDismissRateLimit && (
        <div className="mb-2">
          <RateLimitNotice info={rateLimit} onDismiss={onDismissRateLimit} />
        </div>
      )}
      {mentionPresence.mounted && (
        <div data-state={mentionPresence.closing ? "closing" : "open"} className="noa-slash-menu noa-floating-panel absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-panel bg-[var(--bg-card)]">
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
          <div className="flex gap-3 border-t border-[var(--divider-subtle)] px-3 py-1.5 text-caption text-[var(--sidebar-text-muted)]">
            <span>↑↓ Navigate</span>
            <span>↵ Reference</span>
            <span className="ml-auto">Esc Close</span>
          </div>
        </div>
      )}
      {slashMenuPresence.mounted && (
        <SlashCommandMenu
          items={menuItems}
          index={menuIndex}
          title={menuTitle}
          query={slashQuery}
          disabled={disabled}
          closing={slashMenuPresence.closing}
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

      <div className="noa-agent-input relative flex flex-col">
        {editDraft && !editDraft.silent && (
          <div className="flex items-center gap-2 border-b border-[var(--divider-subtle)] px-3 py-1.5 text-caption text-[var(--sidebar-text-muted)]">
            <Edit2 size={12} />
            <span className="min-w-0 flex-1 truncate">{editDraft.label ?? "Edit and resend"}</span>
            <button
              type="button"
              onClick={() => {
                setText("")
                setImages([])
                setReferences([])
                setFiles([])
                onCancelEdit?.()
              }}
              className="rounded p-0.5 hover:bg-[var(--fill-hover)] hover:text-[var(--text-primary)]"
              aria-label="Cancel edit"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(event) => { void addImages(Array.from(event.target.files ?? [])); event.target.value = "" }} />
        {(images.length > 0 || files.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {files.map((path) => (
              <FileAttachmentCard key={path} path={path} onRemove={() => setFiles((items) => items.filter((item) => item !== path))} />
            ))}
            {images.map((image) => (
              <div key={image.id} className="noa-attachment relative">
                <button
                  type="button"
                  aria-label={`Preview ${image.name}`}
                  onClick={() => {
                    const index = images.findIndex((item) => item.id === image.id)
                    if (index >= 0) setImagePreview(index)
                  }}
                  className="block size-[122px] cursor-zoom-in overflow-hidden rounded-2xl"
                >
                  <img src={image.dataUrl} alt={image.name} className="size-full object-cover" />
                </button>
                <span aria-hidden="true" className="noa-attachment-ring" />
                <button
                  type="button"
                  aria-label={`Remove image ${image.name}`}
                  onClick={() => removeImage(image)}
                  className="noa-attachment-remove"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {pendingImages > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Adding images">
            {Array.from({ length: pendingImages }, (_, index) => (
              <div key={index} className="noa-attachment-pending size-[122px] rounded-2xl border border-[var(--border-default)]" />
            ))}
          </div>
        )}
        {sendWhenReady && <p className="m-0 px-3 pt-2 text-caption text-[var(--sidebar-text-muted)]">Sends when Noa is ready…</p>}
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
          placeholder={readOnly ? "Running in a terminal" : connection === "closed" ? "Noa disconnected" : disabled ? "Starting Noa…" : busy ? followUpMode === "steer" ? "Add a follow-up…" : "Add a follow-up to the queue…" : newTask ? "Do anything" : "Work with Noa"}
          aria-label="Task instruction"
          disabled={!!readOnly && disabled}
          rows={1}
          className="w-full min-h-[44px] max-h-[min(25dvh,var(--composer-editor-max-height,25dvh))] resize-none border-none bg-transparent px-3 py-0 text-[13px] leading-5 outline-none placeholder:text-[color-mix(in_srgb,var(--text-primary)_50%,transparent)]"
        />
        {argumentCommand?.argumentHint && !submenu && <p className="m-0 px-3 pb-1 text-caption text-[var(--sidebar-text-muted)]">/{argumentCommand.name} {argumentCommand.argumentHint}</p>}
        <div className="noa-agent-footer mb-2 mt-1 flex min-h-7 items-center justify-between gap-1 px-2">
          <div className="flex min-w-0 items-center gap-1">
            <Picker
              align="left"
              hideChevron
              iconOnly
              label={<ComposerPlusIcon />}
              ariaLabel="Add task context"
              items={[
                { key: "images", title: "Add photos", icon: <Photo size={16} />, active: false, onSelect: () => fileRef.current?.click() },
                {
                  key: "files",
                  title: "Files and folders",
                  icon: <FileText size={16} />,
                  active: false,
                  onSelect: () => {
                    const el = textareaRef.current
                    const at = el?.selectionStart ?? text.length
                    const lead = at > 0 && !/\s/.test(text[at - 1]!) ? " " : ""
                    setText(text.slice(0, at) + lead + "@" + text.slice(at))
                    const next = at + lead.length + 1
                    setCaret(next)
                    setMentionDismissed(false)
                    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next, next) })
                  },
                },
                {
                  key: "skills",
                  title: "Skills",
                  icon: <List size={16} />,
                  active: false,
                  onSelect: () => {
                    setBrowserSearch("")
                    setBrowserOpen(true)
                    setBrowserFilter("Skills")
                    setMenuDismissed(false)
                    textareaRef.current?.focus()
                  },
                },
                {
                  key: "commands",
                  title: "Commands",
                  icon: <Terminal size={16} />,
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
              menuTitle="Add"
            />
            <Picker
              align="left"
              hideChevron
              label={
                <>
                  {MODE_ICONS[mode ?? "default"]}
                  <span className="noa-agent-mode-label">{currentMode?.label ?? "Permissions"}</span>
                </>
              }
              ariaLabel={currentMode?.label ?? "Permissions"}
              compactPadding
              disabled={modelDisabled}
              tone={mode === "bypassPermissions" ? "danger" : undefined}
              items={permissionModes.map((m) => ({
                key: m.value,
                title: m.label,
                description: modeUnavailable(m.value) ? "Not available for the selected model" : m.description,
                active: m.value === mode,
                disabled: modeUnavailable(m.value),
                icon: MODE_ICONS[m.value],
                danger: m.value === "bypassPermissions",
                onSelect: () => void selectMode(m.value),
              }))}
              menuTitle="Permissions · this session"
            />
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1">
            {/* A new task has only the baseline prompt, whose sliver reads as a loading spinner. */}
            {contextUsage && !newTask && (
              <span
                ref={contextRef}
                className="relative inline-flex shrink-0 items-center text-[var(--sidebar-text-muted)]"
              >
                <button
                  type="button"
                  aria-label={`Context usage ${Math.round(contextUsage.percentage)}%`}
                  aria-expanded={contextOpen}
                  onClick={() => setContextOpen(open => !open)}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[var(--fill-hover)] aria-expanded:bg-[var(--fill-hover)] focus-visible:outline focus-visible:outline-1"
                >
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 12 12"
                  className="shrink-0"
                  aria-hidden="true"
                >
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
                    strokeDashoffset={100 - Math.min(100, Math.max(0, contextUsage.percentage))}
                    opacity={contextUsage.percentage > 0 ? 1 : 0}
                    transform="rotate(-90 6 6)"
                  />
                </svg>
                </button>
                <span
                  role="tooltip"
                  className={`absolute bottom-full left-1/2 z-40 mb-2.5 w-[280px] -translate-x-1/2 flex-col gap-2 whitespace-nowrap rounded-[14px] bg-[var(--bg-card)] px-4 py-3 text-caption tabular-nums text-[var(--text-primary)] shadow-[var(--shadow-dialog)] ${contextOpen ? "flex" : "hidden"}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span>Context window</span>
                    <span className="text-[var(--sidebar-text-muted)]">
                      {compactTokens(contextUsage.totalTokens)} / {compactTokens(contextUsage.maxTokens)}
                      <span className="ms-2">{Math.round(contextUsage.percentage)}%</span>
                    </span>
                  </span>
                  <UsageBar percentage={contextUsage.percentage} />
                  {([
                    ["five_hour", "5-hour limit"],
                    ["seven_day", "Weekly limit"],
                  ] as const).map(([key, label]) => {
                    const window = contextUsage.rateLimits?.[key]
                    if (!window) return null
                    const pct = window.utilization * 100
                    return (
                      <span key={key} className="mt-1 flex flex-col gap-2">
                        <span className="flex items-baseline justify-between gap-3">
                          <span>{label}</span>
                          <span className="text-[var(--sidebar-text-muted)]">
                            Resets {formatReset(window.resets_at, key === "seven_day")}
                            <span className="ms-2">{Math.round(pct)}%</span>
                          </span>
                        </span>
                        <UsageBar percentage={pct} />
                      </span>
                    )
                  })}
                  {contextUsage.rateLimitsError && (
                    <span className="max-w-full whitespace-normal text-[var(--sidebar-text-muted)]">{contextUsage.rateLimitsError}</span>
                  )}
                </span>
              </span>
            )}
            <Picker
              ariaLabel="Model and reasoning effort"
              modelPicker
              label={
                <>
                  <span className="noa-agent-model-name max-w-[112px] truncate text-[var(--text-primary)]">
                    {currentModel?.displayName ?? model ?? (disabled ? savedModelLabel : undefined) ?? "Model"}
                  </span>
                  {currentModel?.supportsEffort && effort && currentModel.supportedEffortLevels?.includes(effort) && (
                    <span className="noa-agent-effort-label capitalize text-[var(--text-tertiary)]">{effort}</span>
                  )}
                </>
              }
              disabled={modelDisabled || models.length === 0}
              items={modelItems}
              header={effortLevels.length > 0 ? (toggleModels, active) => (
                <EffortSlider
                  levels={effortLevels}
                  effort={effort ?? null}
                  modelName={currentModel?.displayName ?? ""}
                  active={active}
                  onEffort={onEffort}
                  onToggleModels={toggleModels}
                />
              ) : undefined}
            />
            <button
              type="button"
              onClick={busy && !editDraft?.queued && !text.trim() && !images.length && !files.length ? onInterrupt : submit}
              disabled={(!busy || editDraft?.queued) && (connection === "closed" || forking || !!readOnly && disabled || sendWhenReady || loadingImages || !imagesLoaded || (!text.trim() && !images.length && !files.length))}
              aria-label={editDraft?.queued ? "Save queued message" : busy && !text.trim() && !images.length && !files.length ? "Stop (Esc)" : busy ? followUpMode === "steer" ? "Steer" : "Queue message" : "Run task"}
              title={editDraft?.queued ? "Save queued message; queue stays paused" : busy && !text.trim() && !images.length && !files.length ? "Stop (Esc)" : busy ? followUpMode === "steer" ? "Submit without interrupting the model" : "Queue after the current turn" : "Run task"}
              data-action={busy && !text.trim() && !images.length && !files.length ? "stop" : busy ? followUpMode : "send"}
              className="noa-primary-action ml-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary,#2D2D2B)] text-[var(--surface-page,#FFFFFF)] transition-[opacity,transform] hover:opacity-90 disabled:opacity-50 noa-press"
            >
              {busy && !editDraft?.queued && !text.trim() && !images.length && !files.length
                ? <span aria-hidden="true" className="block size-[11px] rounded-[1.25px] bg-current" />
                : busy && !editDraft?.queued ? followUpMode === "steer" ? <Steer size={16} /> : <Queue size={16} /> : <ComposerSendIcon width={16} height={16} />}
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
      {dialog}
    </div>
  )
})

function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${+(tokens / 1000).toFixed(1)}K`
  return String(tokens)
}

interface PickerItem {
  key: string
  title: string
  description?: string
  active: boolean
  onSelect: () => void
  heading?: string
  icon?: ReactNode
  leading?: ReactNode
  danger?: boolean
  disabled?: boolean
}

const MODE_ICONS: Partial<Record<PermissionMode, ReactNode>> = {
  default: <ComposerApprovalIcon />,
  auto: <ComposerShieldCodeIcon />,
  acceptEdits: <Edit2 size={16} />,
  plan: <List size={16} />,
  bypassPermissions: <ComposerShieldWarningIcon />,
}

// Spring presets for the effort slider: thumb travel, and the thumb's grow/shrink under hover or press.
const THUMB_TRAVEL = { stiffness: 300, damping: 27 }
const THUMB_GROW = { stiffness: 420, damping: 38 }
const THUMB_SETTLE = { stiffness: 220, damping: 26 }
const THUMB_PRESSED_SCALE = 32 / 28

function createSpring(initial: number, apply: (value: number) => void) {
  let value = initial
  let velocity = 0
  let frame = 0
  const stop = () => {
    cancelAnimationFrame(frame)
    frame = 0
  }
  const jump = (next: number) => {
    stop()
    value = next
    velocity = 0
    apply(next)
  }
  const to = (target: number, { stiffness, damping }: { stiffness: number; damping: number }) => {
    stop()
    if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return jump(target)
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.064, Math.max(0, now - last) / 1000)
      last = now
      const substeps = Math.max(1, Math.ceil(dt / 0.004))
      for (let i = 0; i < substeps; i++) {
        velocity += (-stiffness * (value - target) - damping * velocity) * (dt / substeps)
        value += velocity * (dt / substeps)
      }
      if (Math.abs(velocity) < 0.001 && Math.abs(value - target) < 1e-4) return jump(target)
      apply(value)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }
  return { jump, to, stop, get value() { return value } }
}

function EffortSlider({
  levels,
  effort,
  modelName,
  active,
  onEffort,
  onToggleModels,
}: {
  levels: string[]
  effort: string | null
  modelName: string
  active: boolean
  onEffort: (effort: string | null) => void
  onToggleModels: () => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const last = levels.length - 1
  // No explicit effort (or one this model lacks) means the model default, shown as "Default" with no thumb.
  const selected = effort ? levels.indexOf(effort) : -1
  const target = selected >= 0 && last > 0 ? selected / last : 0
  const label = selected >= 0 ? levels[selected]!.charAt(0).toUpperCase() + levels[selected]!.slice(1) : "Default"
  const drag = useRef<{ x: number; y: number; grab: number; moving: boolean } | null>(null)
  const hovered = useRef(false)
  const mounted = useRef(false)
  const isMax = last > 0 && selected === last
  const maxPresence = usePresence(isMax, 300)
  // Reaching the top level by hand plays the burst and sweeps the fill in; arriving already there just shows it.
  const [burst, setBurst] = useState(0)
  const commit = (level: string | null) => {
    if (level !== null && last > 0 && level === levels[last] && level !== effort) setBurst((k) => k + 1)
    onEffort(level)
  }

  const springs = useMemo(() => {
    const set = (name: string) => (value: number) => trackRef.current?.style.setProperty(name, String(value))
    return { pos: createSpring(0, set("--effort-pos")), scale: createSpring(1, set("--effort-scale")) }
  }, [])
  useLayoutEffect(() => () => { springs.pos.stop(); springs.scale.stop() }, [springs])
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      springs.pos.jump(target)
      springs.scale.jump(1)
    } else if (!drag.current?.moving) springs.pos.to(target, THUMB_TRAVEL)
  }, [springs, target])

  const fraction = (clientX: number, grab = 0) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left - 14 - grab) / Math.max(1, rect.width - 28)))
  }
  const thumbCenter = () => {
    const rect = trackRef.current!.getBoundingClientRect()
    return rect.left + 14 + (rect.width - 28) * springs.pos.value
  }
  const choose = (ratio: number) => {
    const level = levels[Math.round(ratio * last)]!
    if (level !== effort) commit(level)
  }
  const growThumb = (grown: boolean) => springs.scale.to(grown ? THUMB_PRESSED_SCALE : 1, grown ? THUMB_GROW : THUMB_SETTLE)
  const release = (e: ReactPointerEvent) => {
    const state = drag.current
    drag.current = null
    hovered.current = selected >= 0 && Math.abs(e.clientX - thumbCenter()) <= 17
    growThumb(hovered.current)
    if (state?.moving) springs.pos.to(Math.round(springs.pos.value * last) / Math.max(1, last), THUMB_TRAVEL)
  }

  return (
    <div className="noa-model-picker-header">
      <div className="noa-model-picker-controls" data-active={active}>
        <button type="button" onClick={onToggleModels} aria-label="Select model" className="noa-model-picker-view">
          <span className="noa-model-picker-labels">
            <span
              className={`text-body font-medium ${selected >= 0 ? "text-[var(--accent-color)]" : "text-[var(--sidebar-text-muted)]"}`}
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
          onClick={() => commit(null)}
          className="noa-model-picker-reset"
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="noa-model-picker-slider" data-active={active}>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={active ? 0 : -1}
          aria-label="Reasoning effort"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={Math.max(0, selected)}
          aria-valuetext={label}
          data-empty={selected < 0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            const onThumb = selected >= 0 && Math.abs(e.clientX - thumbCenter()) <= 17
            drag.current = { x: e.clientX, y: e.clientY, grab: onThumb ? e.clientX - thumbCenter() : 0, moving: false }
            growThumb(true)
            if (!onThumb) choose(fraction(e.clientX))
          }}
          onPointerMove={(e) => {
            const state = drag.current
            if (!state) {
              const over = selected >= 0 && Math.abs(e.clientX - thumbCenter()) <= 17
              if (over !== hovered.current) {
                hovered.current = over
                growThumb(over)
              }
              return
            }
            if (!state.moving && (e.clientX - state.x) ** 2 + (e.clientY - state.y) ** 2 < 16) return
            state.moving = true
            const ratio = fraction(e.clientX, state.grab)
            springs.pos.jump(ratio)
            choose(ratio)
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={() => {
            if (drag.current || !hovered.current) return
            hovered.current = false
            growThumb(false)
          }}
          onKeyDown={(e) => {
            if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown"].includes(e.key)) e.preventDefault()
            if (e.key === "ArrowRight" || e.key === "ArrowUp") commit(levels[Math.min(last, selected + 1)]!)
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") commit(levels[Math.max(0, selected - 1)]!)
          }}
          className="noa-model-picker-track"
        >
          <div className="noa-model-picker-range">
            {maxPresence.mounted && active && <EffortMaxEffects closing={maxPresence.closing} reveal={burst > 0} />}
          </div>
          {levels.map((level, i) => (
            <span
              key={level}
              className="noa-model-picker-tick"
              data-selected={i <= selected}
              style={{ left: `calc(14px + (100% - 28px) * ${last > 0 ? i / last : 0})` }}
            />
          ))}
          {burst > 0 && (
            <span key={burst} aria-hidden="true" className="noa-model-picker-burst">
              {Array.from({ length: 16 }, (_, i) => <span key={i} />)}
            </span>
          )}
          <span className="noa-model-picker-thumb" />
        </div>
      </div>
    </div>
  )
}

function trackParticleHash(index: number, salt: number) {
  const n = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return n - Math.floor(n)
}

function randomParticle(next: () => number) {
  const x = next()
  const y = next()
  return { scale: 0.8 + next() * 1.2, dx: Math.round((x - 0.5) * 8), y: Math.round(12 + (y - 0.5) * 14) }
}

function TrackParticle({ index, animate }: { index: number; animate: boolean }) {
  const [state, setState] = useState(() => {
    let salt = 1
    return randomParticle(() => trackParticleHash(index, salt++))
  })
  useEffect(() => {
    if (!animate) return
    let timer = 0
    const tick = () => {
      const next = randomParticle(Math.random)
      setState(next)
      timer = window.setTimeout(tick, 1600 * next.scale)
    }
    const frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [animate])
  return (
    <span
      className="noa-model-picker-particle"
      style={{
        left: `calc(${Math.round(4 + trackParticleHash(index, 14) * 92)}% + ${state.dx}px)`,
        top: state.y,
        opacity: 0.4 + trackParticleHash(index, 11) * 0.6,
        transform: `translate(-50%, -50%) scale(${0.5 + trackParticleHash(index, 12) * 0.45})`,
        transitionDuration: `${1.6 * state.scale}s`,
      }}
    />
  )
}

// Top effort level: drifting gradient fill plus sparkles inside the filled track.
function EffortMaxEffects({ closing, reveal }: { closing: boolean; reveal: boolean }) {
  const host = useRef<HTMLSpanElement>(null)
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  useLayoutEffect(() => {
    const el = host.current
    const track = el?.closest<HTMLElement>(".noa-model-picker-track")
    const measure = () => track?.style.setProperty("--effort-track-w", `${track.offsetWidth}px`)
    measure()
    const observer = track ? new ResizeObserver(measure) : undefined
    if (track) observer?.observe(track)
    const stop = el ? startEffortMaxFill(el, still) : undefined
    return () => {
      observer?.disconnect()
      stop?.()
    }
  }, [still])
  return (
    <span aria-hidden="true" className="noa-model-picker-max" data-state={closing ? "closing" : "open"}>
      <span className="noa-model-picker-max-fill" data-reveal={reveal && !still}>
        <span className="noa-model-picker-max-mask">
          <span ref={host} className="noa-model-picker-max-canvas" />
        </span>
      </span>
      <span className="noa-model-picker-particles">
        {Array.from({ length: 14 }, (_, i) => <TrackParticle key={i} index={i} animate={!still && !closing} />)}
      </span>
    </span>
  )
}

// Slider and model list share one panel: the panel height eases between them while each view slides and fades.
function PickerViews({ showingModels, slider, children }: { showingModels: boolean; slider: ReactNode; children: ReactNode }) {
  const sliderView = useRef<HTMLDivElement>(null)
  const listView = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const views = [sliderView.current!, listView.current!]
    views[0]!.toggleAttribute("inert", showingModels)
    views[1]!.toggleAttribute("inert", !showingModels)
    const measure = () => setHeight(views[showingModels ? 1 : 0]!.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    views.forEach((view) => observer.observe(view))
    return () => observer.disconnect()
  }, [showingModels])
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="noa-model-picker-views" data-ready={ready} style={{ height }}>
      <div ref={sliderView} className="noa-model-picker-view-pane">{slider}</div>
      <div ref={listView} className="noa-model-picker-view-pane noa-model-picker-list-motion" data-active={showingModels}>
        {children}
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
  menuTitle,
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
  menuTitle?: string
  header?: (toggleModels: () => void, active: boolean) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const presence = usePresence(open)
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

  const list = (
    <div className={modelPicker ? "noa-model-picker-list" : undefined}>
            {items.map((item) => (
      <div key={item.key}>
        {item.heading && (
          <div className="px-2.5 pb-1 pt-2 text-caption text-[var(--sidebar-text-muted)]">{item.heading}</div>
        )}
        <button
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onSelect()
            setOpen(false)
          }}
          aria-pressed={item.active}
          className={modelPicker ? "noa-model-picker-option" : item.icon ? `noa-approval-item${item.danger ? " is-danger" : ""}` : `flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left ${
            item.active
              ? "bg-[var(--fill-hover)]"
              : "hover:bg-[var(--fill-hover)]"
          }`}
        >
          {item.icon && <span className="noa-approval-icon">{item.icon}</span>}
          <span className={item.icon ? "noa-approval-text" : "contents"}>
            <span className={modelPicker ? "noa-model-picker-option-label" : item.icon ? undefined : "text-body font-medium"}>
              {item.leading ? <span className="flex min-w-0 items-center gap-2">{item.leading}<span className="truncate">{item.title}</span></span> : item.title}
              {modelPicker && item.active && <Check size={16} aria-hidden="true" />}
            </span>
            {item.description && (
              <span className={item.icon ? "noa-approval-desc" : `break-words text-caption text-[var(--sidebar-text-muted,#898781)]${modelPicker ? " mt-0.5" : ""}`}>
                {item.description}
              </span>
            )}
          </span>
          {item.icon && item.active && <Check size={16} className="noa-approval-check" aria-hidden="true" />}
        </button>
      </div>
    ))}
    </div>
  )

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
        className={`flex h-7 min-w-0 items-center gap-1 whitespace-nowrap rounded-full ${iconOnly ? "w-7 justify-center p-0" : compactPadding ? "px-1.5" : "px-2"} text-[12px] font-normal leading-[18px] transition-colors hover:bg-[var(--fill-hover)] disabled:opacity-40 ${
          tone === "danger" ? "text-[#C24444]" : "text-[var(--sidebar-text,#52514E)]"
        }`}
      >
        {label}
        {!hideChevron && <ComposerChevronIcon className="size-4 shrink-0" />}
      </button>
      {presence.mounted && (
        <div
          data-state={presence.closing ? "closing" : "open"}
          className={menuTitle
            ? `noa-approval-menu absolute bottom-full ${align === "left" ? "left-0" : "right-0"} z-30 mb-2 max-h-[55vh] overflow-auto`
            : `${modelPicker ? "noa-model-picker" : ""} noa-floating-panel absolute bottom-full ${align === "left" ? "left-0" : "right-0"} z-30 mb-2 max-h-[55vh] w-64 max-w-[80vw] overflow-auto rounded-panel p-1 ${header ? "bg-[var(--effort-menu)]" : "bg-[var(--bg-card,#FFFFFF)]"}`}
        >
          {menuTitle && <div className="noa-approval-title">{menuTitle}</div>}
          {header ? (
            <PickerViews showingModels={showingModels} slider={header(() => setShowingModels(true), !showingModels)}>
              {list}
            </PickerViews>
          ) : list}
        </div>
      )}
    </div>
  )
}

function usePresence(open: boolean, duration = 90) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (!mounted) return
    const timer = setTimeout(() => setMounted(false), duration)
    return () => clearTimeout(timer)
  }, [duration, mounted, open])
  return { mounted, closing: mounted && !open }
}

function UsageBar({ percentage }: { percentage: number }) {
  return (
    <span className="block h-1 overflow-hidden rounded-full bg-[var(--border-default)]">
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, percentage))}%`,
          background: percentage >= 75 ? "#e8a93b" : "#3b7ddd",
        }}
      />
    </span>
  )
}

function formatReset(epochSeconds: number, withDay: boolean): string {
  const date = new Date(epochSeconds * 1000)
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  return withDay ? `${date.toLocaleDateString([], { weekday: "short" })} ${time}` : `at ${time}`
}
