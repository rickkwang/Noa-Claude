import { Children, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AppSettings, ThemeFontFace, ThemeFonts } from "../types"
import type { AgentState } from "../agent/reducer"
import type { PermissionMode, AccountInfo } from "../agent/protocol"
import { fetchPlugins, fetchSkillsState, runPluginAction, runSkillAction, type SkillsState, type PluginAction, type PluginCatalog } from "../api"
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, Trash2, X, Keyboard, Palette, Search, Settings, Plug, SlidersHorizontal, List, RefreshCcw } from "../lib/icons"
import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from "../lib/fontFamily"
import { faceStyle, isRegularFace, loadFontFamilies, type LocalFontFamily } from "../lib/localFonts"
import { clampContrast } from "../lib/contrast"
import { activeTranslucency, supportsSidebarTranslucency } from "../lib/translucency"
import { useIsDark } from "../hooks/useIsDark"
import { findModel } from "../lib/models"
import { defaultSettings } from "../theme/settings"
import { AuthDialog } from "./AuthDialog"
import { useConfirm } from "./ConfirmDialog"
import { Markdown } from "./Markdown"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

type Page = "general" | "appearance" | "shortcuts" | "configuration" | "mcp" | "hooks" | "skills"
type Theme = AppSettings["appearance"]["theme"]
type DefaultMode = AppSettings["agent"]["permissionDefault"]

const pages: { key: Page; label: string; group: string; icon: ReactNode; rows: string[] }[] = [
  {
    key: "general",
    label: "General",
    group: "Personal",
    icon: <Settings size={16} />,
    rows: ["Account", "Default permissions", "Send shortcut", "Show context window usage", "Turn notifications", "Notification sound", "Permission requests", "Questions", "Dock badge"],
  },
  {
    key: "appearance",
    label: "Appearance",
    group: "Personal",
    icon: <Palette size={16} />,
    rows: [
      "Mode",
      "Contrast",
      "Translucent sidebar",
      "Font",
      "UI font style",
      "Content font",
      "Code font",
      "UI font size",
      "Code font size",
      "Font smoothing",
      "Output width",
      "Reduce motion",
      "Pointer cursors",
      "Reset appearance",
    ],
  },
  {
    key: "shortcuts",
    label: "Keyboard shortcuts",
    group: "Personal",
    icon: <Keyboard size={16} />,
    rows: ["New task", "Find tasks", "Settings", "Run instruction", "New line", "Reorder task", "Stop agent"],
  },
  {
    key: "configuration",
    label: "Configuration",
    group: "Coding",
    icon: <SlidersHorizontal size={16} />,
    rows: ["Model", "Reasoning effort", "Current permissions", "Configuration sources", "Permission rules"],
  },
  { key: "hooks", label: "Hooks", group: "Coding", icon: <List size={16} />, rows: ["Configured hooks"] },
  { key: "mcp", label: "MCP servers", group: "Integrations", icon: <Plug size={16} />, rows: ["Connected servers"] },
  {
    key: "skills",
    label: "Plugins",
    group: "Integrations",
    icon: <Download size={16} />,
    rows: ["Plugins", "Skills", "Marketplace", "Browse directory", "Add marketplace"],
  },
]

const sourceLabels: Record<string, string> = {
  bundled: "Bundled",
  builtin: "Built-in",
  plugin: "Plugin",
  mcp: "MCP",
  userSettings: "User",
  projectSettings: "Project",
  localSettings: "Local project",
  flagSettings: "Session",
  policySettings: "Managed",
}
const actionButton =
  "h-8 shrink-0 rounded-lg border border-[var(--border-default)] px-3 text-body hover:bg-[var(--settings-fill-hover)] disabled:opacity-40"

const permissionOptions: [DefaultMode, string][] = [
  ["inherit", "Follow Noa settings"],
  ["auto", "Auto"],
  ["default", "Manual"],
  ["acceptEdits", "Accept edits"],
  ["plan", "Plan"],
]

const shortcuts: [string, string[]][] = [
  ["New task", ["⌘", "N"]],
  ["Find tasks", ["⌘", "K"]],
  ["Settings", ["⌘", ","]],
  ["Run instruction", ["Enter"]],
  ["New line", ["Shift", "Enter"]],
  ["Reorder task", ["⌥", "↑/↓"]],
  ["Stop agent", ["Esc"]],
]

export function SettingsDialog({
  navWidth,
  navResizeHandle,
  settings,
  agent,
  onRefreshSettings,
  onRefreshMcp,
  onChangeMcp,
  onReloadCommands,
  onModel,
  onEffort,
  onMode,
  onChange,
  onClose,
  onTrySkill,
  account,
  auth,
  onStartAuthentication,
  onWaitForAuthentication,
  onSubmitAuthenticationCode,
  onCloseAuthentication,
}: {
  // The main sidebar's width: the settings nav takes the sidebar's place.
  navWidth: number
  // The main sidebar's resize handle, so dragging here resizes the sidebar too.
  navResizeHandle: ReactNode
  settings: AppSettings
  agent: AgentState
  onRefreshSettings: () => void
  onRefreshMcp: () => void
  onChangeMcp: (name: string, enabled?: boolean) => void
  onReloadCommands: () => void
  onModel: (model: string) => void
  onEffort: (effort: string | null) => void
  onMode: (mode: PermissionMode) => void
  onChange: (settings: AppSettings) => void
  onClose: () => void
  onTrySkill: (name: string) => void
  account?: AccountInfo
  auth?: AgentState["auth"]
  onStartAuthentication: () => void
  onWaitForAuthentication: () => void
  onSubmitAuthenticationCode: (code: string) => void
  onCloseAuthentication: () => void
}) {
  const [page, setPage] = useState<Page>("general")
  const [query, setQuery] = useState("")
  const [authOpen, setAuthOpen] = useState(false)
  const [searchTarget, setSearchTarget] = useState<{ label: string }>()
  const dialogRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const appearance = settings.appearance
  const isDark = useIsDark(appearance.theme)
  const variant = isDark ? "dark" : "light"
  const contrast = clampContrast(appearance.contrast?.[variant], variant)
  const translucency = {
    light: activeTranslucency(appearance.translucentSidebar, false),
    dark: activeTranslucency(appearance.translucentSidebar, true),
  }
  const permissionMode = settings.agent.permissionDefault
  const modifierLabel = navigator.platform.includes("Mac") ? "⌘" : "Ctrl"
  const { confirm, dialog } = useConfirm()
  const providerLabel = account?.apiProvider ? providerDisplayName(account.apiProvider) : undefined
  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const setPermission = (permissionDefault: DefaultMode) =>
    onChange({ ...settings, agent: { ...settings.agent, permissionDefault } })
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [fontFamilies, setFontFamilies] = useState<LocalFontFamily[]>([])
  const searchTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searchResults = pages.flatMap((p) => p.rows.map((label) => ({ page: p, label })))
    .filter(({ page, label }) => searchTerms.every((term) => `${page.label} ${label}`.toLowerCase().includes(term)))
  const disconnected = agent.connection !== "ready"
  const locked = disconnected || agent.busy
  const activeModel = findModel(agent.models, agent.model)
  const modelOptions: [string, string][] = agent.models.map((m) => [m.value, m.displayName])
  if (agent.model && !activeModel) modelOptions.unshift([agent.model, agent.model])
  const effortOptions: [string, string][] = [["default", "Default"], ...(activeModel?.supportsEffort ? activeModel.supportedEffortLevels ?? [] : []).map((level): [string, string] => [level, level])]
  const hooks = agent.cliSettings?.hooks
  // Turned-off skills are hidden from the CLI's command list, so the Plugins page filters them itself.
  const allSkills = agent.commands.filter((command) => command.type === "prompt")

  useEffect(() => {
    if (disconnected) return
    if (page === "mcp") onRefreshMcp()
    if (["configuration", "hooks", "skills"].includes(page)) onRefreshSettings()
  }, [page, disconnected, onRefreshMcp, onRefreshSettings])

  useEffect(() => {
    if (!searchTarget) {
      const main = dialogRef.current?.querySelector("main")
      if (main) main.scrollTop = 0
      return
    }
    const row = [...(dialogRef.current?.querySelectorAll<HTMLElement>("[data-settings-label]") ?? [])]
      .find((element) => element.dataset.settingsLabel === searchTarget.label)
    row?.scrollIntoView({ block: "center" })
    if (!appearance.reduceMotion) row?.animate([{ backgroundColor: "var(--settings-fill-active)" }, { backgroundColor: "transparent" }], { duration: 1200 })
  }, [page, searchTarget, appearance.reduceMotion])
  // A search jump may land on a row inside Advanced, so it opens the group.
  const showAdvanced = advancedOpen || searchTarget !== undefined
  const current = pages.find((p) => p.key === page)
  const activeFonts = appearance.fonts?.[variant] ?? defaultSettings.appearance.fonts[variant]
  const updateFonts = (patch: Partial<ThemeFonts>) =>
    change({ fonts: { ...appearance.fonts, [variant]: { ...activeFonts, ...patch } } })
  const facesFor = (family: string) => fontFamilies.find((f) => f.family === family)?.faces ?? []
  const faceLabel = (face: ThemeFontFace) => faceStyle(face).replace(/([a-z])([A-Z])/g, "$1 $2")
  // Prefer the family's Regular face: the platform lists faces in an arbitrary order.
  const defaultFace = (faces: ThemeFontFace[]) => faces.find(isRegularFace) ?? faces[0]
  const familyOption = (family: string): [string, string] => [family, family]
  const withStoredFamily = (options: [string, string][], family: string) => {
    if (family && family !== SYSTEM_DEFAULT_FONT && family !== CONTENT_SAME_AS_UI && !options.some(([value]) => value === family))
      options.push(familyOption(family))
    return options
  }
  const uiFamilyOptions = withStoredFamily(
    [[SYSTEM_DEFAULT_FONT, "System default"], ...fontFamilies.map((f) => familyOption(f.family))],
    activeFonts.ui,
  )
  const contentFamilyOptions = withStoredFamily(
    [[CONTENT_SAME_AS_UI, "Same as UI font"], [SYSTEM_DEFAULT_FONT, "System default"], ...fontFamilies.map((f) => familyOption(f.family))],
    activeFonts.content,
  )
  const codeFamilyOptions = withStoredFamily(
    [[SYSTEM_DEFAULT_FONT, "System monospace"], ...fontFamilies.filter((f) => f.monospaced).map((f) => familyOption(f.family))],
    activeFonts.code,
  )
  const faceOptions = (family: string, face: ThemeFontFace | undefined, fallbackLabel: string): [string, string][] => {
    const faces = facesFor(family)
    if (!faces.length) return [["", fallbackLabel]]
    const options = faces.map((item): [string, string] => [item.postscriptName, faceLabel(item)])
    if (face && !faces.some((item) => item.postscriptName === face.postscriptName)) options.unshift([face.postscriptName, faceLabel(face)])
    return options
  }
  const faceValue = (family: string, face: ThemeFontFace | undefined) => {
    if (family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI) return ""
    return face?.postscriptName ?? defaultFace(facesFor(family))?.postscriptName ?? ""
  }
  const chooseFamily = (role: "ui" | "content" | "code", family: string) => {
    const face = family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI ? undefined : defaultFace(facesFor(family))
    if (role === "ui") updateFonts({ ui: family, uiFace: face })
    else if (role === "content") updateFonts({ content: family, contentFace: face })
    else updateFonts({ code: family, codeFace: face })
  }
  const faceSelect = ({ role, family, face }: { role: "ui" | "content" | "code"; family: string; face?: ThemeFontFace }) => (
    <Select
      value={faceValue(family, face)}
      options={faceOptions(family, face, "Regular")}
      disabled={family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI}
      onChange={(postscriptName) => chooseFace(role, postscriptName)}
    />
  )
  const fontPair = ({ role, family, face, options }: { role: "content" | "code"; family: string; face?: ThemeFontFace; options: [string, string][] }) => (
    <div className="flex shrink-0 items-center gap-2">
      <Select value={family} options={options} onChange={(next) => chooseFamily(role, next)} />
      {faceSelect({ role, family, face })}
    </div>
  )
  const chooseFace = (role: "ui" | "content" | "code", postscriptName: string) => {
    const face = facesFor(role === "ui" ? activeFonts.ui : role === "content" ? activeFonts.content : activeFonts.code)
      .find((item) => item.postscriptName === postscriptName)
    if (role === "ui") updateFonts({ uiFace: face })
    else if (role === "content") updateFonts({ contentFace: face })
    else updateFonts({ codeFace: face })
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    backRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    if (page !== "appearance") return
    let cancelled = false
    loadFontFamilies()
      .then((families) => { if (!cancelled) setFontFamilies(families) })
      .catch(() => { if (!cancelled) setFontFamilies([]) })
    return () => { cancelled = true }
  }, [page])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !authOpen) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [authOpen, onClose])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], summary, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      data-settings-surface="true"
      aria-modal="true"
      aria-label="Settings"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex bg-[var(--bg-sidebar,#FBFBF9)] text-body text-[var(--text-primary)]"
    >
      <nav className="flex shrink-0 flex-col px-2 pb-3" style={{ width: navWidth }}>
        {/* Titlebar band: back arrow sits right of the traffic lights, same row. */}
        <div
          className="flex h-11 shrink-0 items-center"
          style={{
            ...dragRegion,
            // Same clearance and lift as TopBar, so the arrow tracks the traffic lights at any zoom.
            paddingLeft: "calc(var(--noa-titlebar-inset) - 8px)",
            transform: "translateY(var(--noa-titlebar-lift, 0px))",
          }}
        >
          <button
            ref={backRef}
            onClick={onClose}
            aria-label="Back to app"
            style={noDragRegion}
            className="flex size-7 items-center justify-center rounded-md text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)]"
          >
            <ArrowLeft size={16} />
          </button>
        </div>
        {/* Settings nav: 16px semibold title, a pill search, sentence-case group label, 30px rows. */}
        <h2 className="mt-[15px] px-2 text-[16px] leading-6 font-medium">Settings</h2>
        <label className="mt-[13px] flex h-9 items-center gap-2 rounded-full bg-[var(--settings-fill-hover)] px-3 text-[var(--sidebar-text-muted)]">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
          />
        </label>
        <div className="scrollbar-on-scroll mt-2 min-h-0 flex-1 overflow-y-auto">
          {query.trim() ? (
            <>
              <button
                type="button"
                className="w-full px-2 py-2 text-left text-caption text-[var(--sidebar-text-muted)]"
                onClick={() => setQuery("")}
              >
                Clear search
              </button>
              {searchResults.length === 0 && (
                <p role="status" className="px-2 py-2 text-body text-[var(--sidebar-text-muted)]">
                  No results found
                </p>
              )}
              {searchResults.map(({ page: destination, label }) => (
                <button
                  key={`${destination.key}:${label}`}
                  type="button"
                  className="mb-px flex w-full flex-col rounded-lg px-2 py-2 text-left hover:bg-[var(--settings-fill-hover)]"
                  onClick={() => {
                    setPage(destination.key)
                    setSearchTarget({ label })
                    setQuery("")
                  }}
                >
                  <span className="text-body">{label}</span>
                  <span className="text-caption text-[var(--sidebar-text-muted)]">{destination.label}</span>
                </button>
              ))}
            </>
          ) : (
            pages.map((p, index) => (
              <div key={p.key}>
                {pages[index - 1]?.group !== p.group && (
                  <div className="mb-2 flex h-[30px] items-center px-2 text-[var(--sidebar-text-muted)]">{p.group}</div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPage(p.key)
                    setSearchTarget(undefined)
                  }}
                  aria-pressed={page === p.key}
                  className={`mb-px flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2 ${page === p.key ? "bg-[var(--settings-fill-hover)]" : "hover:bg-[var(--settings-fill-hover)]"}`}
                >
                  <span className="flex">{p.icon}</span>
                  {p.label}
                </button>
              </div>
            ))
          )}
        </div>

      </nav>

      {navResizeHandle}
      <main className="noa-settings-main scrollbar-on-scroll min-w-0 flex-1 overflow-y-auto bg-[var(--bg-primary,#FCFCFB)] px-5 pt-[120px] pb-5">
        <div key={page} className="mx-auto flex max-w-3xl flex-col gap-10">
          {page !== "skills" && <h1 className="text-[26px] leading-8 font-normal">{current?.label}</h1>}

          {page === "general" && (
            <>
              <Section title="Account">
                <Row
                  label={account?.email ?? providerLabel ?? "Noa account"}
                  description={
                    account?.email
                      ? account.organization ?? "Anthropic account"
                      : providerLabel
                        ? `Connected through ${providerLabel}`
                        : "Sign in to use Anthropic through this desktop session."
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAuthOpen(true)
                      onStartAuthentication()
                    }}
                    className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 text-body text-[var(--text-primary)] hover:bg-[var(--settings-fill-hover)]"
                  >
                    {account?.email ? "Sign in again" : "Sign in"}
                  </button>
                </Row>
              </Section>
              <Section title="Permissions">
              <Row
                label="Default permissions"
                description="By default, Noa can read and edit files in its workspace. It can ask for additional access when needed. Follow Noa settings uses permissions.defaultMode from settings.json."
              >
                <Select
                  value={permissionMode}
                  options={permissionOptions.filter(([mode]) => mode !== "auto" || activeModel?.supportsAutoMode !== false || permissionMode === "auto")}
                  onChange={(value) => setPermission(value as DefaultMode)}
                />
              </Row>
              <Row
                label="Full access"
                description="When Noa runs with full access, it can edit any file on your computer and run commands with network, without your approval. This significantly increases the risk of data loss, leaks, or unexpected behavior."
              >
                <Toggle
                  checked={settings.composer.showFullAccess}
                  onChange={async (showFullAccess) => {
                    if (showFullAccess && !(await confirm({
                      title: "Make Full access available?",
                      description: "When selected, Noa can access the internet and read and edit files without asking for approval, including potentially destructive commands. Turning this on adds Full access to the permissions menu. It does not turn Full access on.",
                      confirmLabel: "Confirm",
                      danger: true,
                    }))) return
                    onChange({ ...settings, composer: { ...settings.composer, showFullAccess } })
                  }}
                />
              </Row>
              </Section>
              <Section title="Composer">
                <Row label="Send shortcut" description="Choose when Enter sends a prompt or inserts a new line.">
                  <Select
                    value={settings.composer.sendShortcut}
                    options={[
                      ["enter", "Enter"],
                      ["modifier-enter", `${modifierLabel} + Enter always`],
                      ["modifier-enter-multiline", `${modifierLabel} + Enter for multiline prompts`],
                    ]}
                    onChange={(value) =>
                      onChange({
                        ...settings,
                        composer: { ...settings.composer, sendShortcut: value as AppSettings["composer"]["sendShortcut"] },
                      })
                    }
                  />
                </Row>
                <Row label="Follow-up behavior" description="Queue follow-ups while Noa runs, or steer the current run with them.">
                  <Select
                    value={settings.composer.followUpMode}
                    options={[
                      ["queue", "Queue"],
                      ["steer", "Steer"],
                    ]}
                    onChange={(value) =>
                      onChange({
                        ...settings,
                        composer: { ...settings.composer, followUpMode: value as AppSettings["composer"]["followUpMode"] },
                      })
                    }
                  />
                </Row>
                <Row label="Show context window usage" description="Show context usage in the composer.">
                  <Toggle
                    checked={settings.composer.showContextUsage}
                    onChange={(showContextUsage) =>
                      onChange({ ...settings, composer: { ...settings.composer, showContextUsage } })
                    }
                  />
                </Row>
              </Section>
              <Section title="Notifications">
                <Row label="Turn notifications" description="When a finished task shows a desktop notification.">
                  <Select
                    value={settings.notifications.turnMode}
                    options={[
                      ["off", "Off"],
                      ["unfocused", "When Noa is in the background"],
                      ["always", "Always"],
                    ]}
                    onChange={(value) =>
                      onChange({
                        ...settings,
                        notifications: { ...settings.notifications, turnMode: value as AppSettings["notifications"]["turnMode"] },
                      })
                    }
                  />
                </Row>
                <Row label="Notification sound" description="Sound played with desktop notifications.">
                  <Select
                    value={settings.notifications.sound}
                    options={[
                      ["default", "Default"],
                      ["classic", "Classic"],
                      ["none", "None"],
                      ["Basso", "Basso"],
                      ["Glass", "Glass"],
                      ["Ping", "Ping"],
                      ["Pop", "Pop"],
                      ["Purr", "Purr"],
                      ["Tink", "Tink"],
                    ]}
                    onChange={(sound) => onChange({ ...settings, notifications: { ...settings.notifications, sound } })}
                  />
                </Row>
                <Row label="Permission requests" description="Notify when a tool needs your approval.">
                  <Toggle
                    checked={settings.notifications.permissions}
                    onChange={(permissions) => onChange({ ...settings, notifications: { ...settings.notifications, permissions } })}
                  />
                </Row>
                <Row label="Questions" description="Notify when Noa or an MCP server asks you for input.">
                  <Toggle
                    checked={settings.notifications.questions}
                    onChange={(questions) => onChange({ ...settings, notifications: { ...settings.notifications, questions } })}
                  />
                </Row>
                <Row label="Dock badge" description="Show a dot on the Dock icon while a notification is waiting.">
                  <Toggle
                    checked={settings.notifications.dot}
                    onChange={(dot) => onChange({ ...settings, notifications: { ...settings.notifications, dot } })}
                  />
                </Row>
              </Section>

            </>
          )}

          {page === "appearance" && (
            <>
              <Section title="Visual style">
                <Row label="Mode" description="Follow the system or pick a fixed appearance.">
                  <Segmented
                    value={appearance.theme}
                    options={[
                      ["system", "System"],
                      ["light", "Light"],
                      ["dark", "Dark"],
                    ]}
                    onChange={(theme) => change({ theme: theme as Theme })}
                  />
                </Row>
                <Row label="Font" description="Family for the interface.">
                  <Select value={activeFonts.ui} options={uiFamilyOptions} onChange={(family) => chooseFamily("ui", family)} />
                </Row>
              </Section>

              <div className="flex flex-col">
                <button
                  type="button"
                  aria-expanded={showAdvanced}
                  onClick={() => setAdvancedOpen((open) => !open)}
                  className="flex min-h-10 w-fit cursor-pointer items-center gap-1 pb-1.5 text-body font-medium text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
                >
                  Advanced
                  <ChevronDown size={14} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-6">
                    <Section title={`${isDark ? "Dark" : "Light"} theme`}>
                      <Row label="UI font style" description="Face of the selected family.">
                        {faceSelect({ role: "ui", family: activeFonts.ui, face: activeFonts.uiFace })}
                      </Row>
                      <Row label="Content font" description="Typeface for messages and page content.">
                        {fontPair({ role: "content", family: activeFonts.content, face: activeFonts.contentFace, options: contentFamilyOptions })}
                      </Row>
                      <Row label="Code font" description="Typeface for code blocks and diffs, separate from the interface font.">
                        {fontPair({ role: "code", family: activeFonts.code, face: activeFonts.codeFace, options: codeFamilyOptions })}
                      </Row>
                      {supportsSidebarTranslucency() && (
                        <Row label="Translucent sidebar" description="Let the desktop material show behind the sidebar, per theme.">
                          <Toggle
                            checked={translucency[variant]}
                            onChange={(enabled) => change({ translucentSidebar: { ...translucency, [variant]: enabled } })}
                          />
                        </Row>
                      )}
                      <Row label="Contrast" description="Divider and border contrast for the active theme; light and dark keep separate values.">
                        <Slider
                          label="Contrast"
                          value={contrast}
                          onChange={(value) => change({ contrast: { ...appearance.contrast, [variant]: value } })}
                        />
                      </Row>
                    </Section>
                    <Section title="Text">
                      <Row label="UI font size" description="Base size for interface text (11–16 px).">
                        <NumberField value={appearance.uiFontSize} min={11} max={16} onChange={(uiFontSize) => change({ uiFontSize })} />
                      </Row>
                      <Row label="Code font size" description="Size for code blocks (8–24 px).">
                        <NumberField value={appearance.codeFontSize} min={8} max={24} onChange={(codeFontSize) => change({ codeFontSize })} />
                      </Row>
                      <Row label="Font smoothing" description="Smooth edges of text on screen.">
                        <Toggle checked={appearance.fontSmoothing} onChange={(fontSmoothing) => change({ fontSmoothing })} />
                      </Row>
                    </Section>
                  </div>
                )}
              </div>

              <Section title="Layout">
                <Row label="Output width" description="Maximum width of the conversation column.">
                  <Segmented
                    value={String(appearance.maxWidth)}
                    options={[
                      ["680", "Compact"],
                      ["800", "Comfortable"],
                      ["1040", "Wide"],
                    ]}
                    onChange={(maxWidth) => change({ maxWidth: Number(maxWidth) })}
                  />
                </Row>
                <Row label="Reduce motion" description="Turn off transitions and animations.">
                  <Toggle checked={appearance.reduceMotion} onChange={(reduceMotion) => change({ reduceMotion })} />
                </Row>
                <Row label="Pointer cursors" description="Show a pointer over clickable controls.">
                  <Toggle checked={appearance.usePointerCursors} onChange={(usePointerCursors) => change({ usePointerCursors })} />
                </Row>
                <Row label="Reset appearance" description="Restore the default fonts, colors, and layout."><button type="button" className={actionButton} onClick={() => onChange({ ...settings, appearance: { ...defaultSettings.appearance } })}>Reset to default</button></Row>
              </Section>
            </>
          )}

          {["configuration", "hooks", "mcp"].includes(page) && (
            <>
              <div className="flex items-center justify-between gap-4 text-body text-[var(--sidebar-text-muted)]">
                <span>{disconnected ? "Connect Noa to load settings." : "Review settings for this workspace."}</span>
                <button
                  type="button"
                  disabled={disconnected || agent.mcpPending}
                  className={actionButton}
                  onClick={() => {
                    if (page === "mcp") onRefreshMcp()
                    else onRefreshSettings()
                  }}
                >
                  <RefreshCcw size={14} className="mr-1 inline" />
                  Refresh
                </button>
              </div>
              {agent.error && (
                <p role="alert" className="text-body text-[#C24444]">
                  {agent.error}
                </p>
              )}
            </>
          )}
          {page === "configuration" && (
            <>
              <Section title="Current chat">
                <Row label="Model" description="Choose the model for this chat.">
                  <Select
                    value={activeModel?.value ?? agent.model ?? ""}
                    options={modelOptions}
                    disabled={locked || !modelOptions.length}
                    onChange={onModel}
                  />
                </Row>
                <Row label="Reasoning effort" description="Use a level supported by the current model.">
                  <Select
                    value={agent.effort ?? "default"}
                    options={effortOptions}
                    disabled={locked || effortOptions.length < 2}
                    onChange={(value) => onEffort(value === "default" ? null : value)}
                  />
                </Row>
                <Row
                  label="Current permissions"
                  description="Applies to this chat. Managed policies and model restrictions still apply."
                >
                  <Select
                    value={agent.permissionMode ?? "default"}
                    options={[
                      ...(agent.permissionMode && !permissionOptions.some(([mode]) => mode === agent.permissionMode)
                        ? [[agent.permissionMode, agent.permissionMode === "bypassPermissions" ? "Full access" : agent.permissionMode] as [string, string]]
                        : []),
                      ...permissionOptions.filter(
                        ([mode]) =>
                          mode !== "inherit" &&
                          (mode !== "auto" || activeModel?.supportsAutoMode !== false || agent.permissionMode === "auto")
                      ),
                    ]}
                    disabled={locked}
                    onChange={(value) => onMode(value as PermissionMode)}
                  />
                </Row>
              </Section>
              <Section title="Configuration sources">
                {agent.cliSettings ? (
                  agent.cliSettings.sources.length ? (
                    agent.cliSettings.sources.map(({ source, settings: values }) => (
                      <Row
                        key={source}
                        label={sourceLabels[source] ?? source}
                        description={
                          source === "policySettings"
                            ? "Managed by your organization"
                            : source === "flagSettings"
                              ? "Overrides for this session"
                              : undefined
                        }
                      >
                        <span className="shrink-0 text-caption text-[var(--sidebar-text-muted)]">
                          {Object.keys(values).length} {Object.keys(values).length === 1 ? "setting" : "settings"}
                        </span>
                      </Row>
                    ))
                  ) : (
                    <Row label="Using Noa defaults" />
                  )
                ) : (
                  <Row label={disconnected ? "Noa is disconnected" : "Loading…"} />
                )}
              </Section>
              <Section title="Permission rules">
                {!agent.cliSettings ? (
                  <Row label={disconnected ? "Noa is disconnected" : "Loading…"} />
                ) : (
                  (["allow", "ask", "deny"] as const).map((kind) => {
                    const rules = agent.cliSettings?.effective.permissions?.[kind] ?? []
                    const label = { allow: "Allow", ask: "Ask", deny: "Deny" }[kind]
                    return rules.length ? (
                      <details key={kind} data-permission-kind={kind} className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body">
                          <span className="font-medium">{label}</span>
                          <span className="flex items-center gap-2 text-caption text-[var(--sidebar-text-muted)]">
                            {rules.length} {rules.length === 1 ? "rule" : "rules"}
                            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                          </span>
                        </summary>
                        <ul className="noa-selectable m-0 max-h-64 list-none overflow-y-auto border-t border-[var(--divider-subtle)] px-4 py-1 font-mono text-caption leading-5">
                          {rules.map((rule, index) => (
                            <li
                              key={index}
                              className="whitespace-pre-wrap break-all border-b border-[var(--divider-subtle)] py-2 last:border-b-0"
                            >
                              {rule}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <Row key={kind} label={label} description="No configured rules" />
                    )
                  })
                )}
              </Section>
            </>
          )}
          {page === "mcp" && (
            <Section title="Connected servers">
              {!agent.mcpServers?.length ? (
                <Row label={agent.mcpServers ? "No MCP servers connected" : "Loading…"} />
              ) : (
                agent.mcpServers.map((server) => (
                  <Row key={server.name} label={server.name} description={server.status}>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={locked || agent.mcpPending || server.status === "disabled" || server.status === "pending"}
                        className={actionButton}
                        onClick={() => onChangeMcp(server.name)}
                      >
                        Reconnect
                      </button>
                      <button
                        type="button"
                        disabled={locked || agent.mcpPending || server.status === "pending"}
                        className={actionButton}
                        onClick={() => onChangeMcp(server.name, server.status === "disabled")}
                      >
                        {server.status === "disabled" ? "Enable" : "Disable"}
                      </button>
                    </div>
                  </Row>
                ))
              )}
            </Section>
          )}
          {page === "hooks" && (
            <Section title="Configured hooks">
              {hooks?.restricted && (
                <Row
                  label="Custom hooks restricted"
                  description="Some hooks are hidden or disabled by your current settings, policy, or safe mode."
                />
              )}
              {!hooks ? (
                <Row
                  label={agent.cliSettings ? "Hook details unavailable" : disconnected ? "Noa is disconnected" : "Loading…"}
                />
              ) : hooks.items.length === 0 ? (
                <Row label="No hooks available" />
              ) : (
                hooks.items.map((hook, index) => (
                  <details key={index} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body">
                      <span className="font-medium">{hook.event}</span>
                      <span className="flex items-center gap-2 text-caption text-[var(--sidebar-text-muted)]">
                        {hook.source} · {hook.type}
                        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                      </span>
                    </summary>
                    <div className="border-t border-[var(--divider-subtle)] px-4 py-3 text-caption text-[var(--sidebar-text-muted)]">
                      {hook.matcher && <p>Matcher: {hook.matcher}</p>}
                      {hook.timeout !== undefined && <p>Timeout: {hook.timeout}s</p>}
                      <pre className="noa-selectable m-0 mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono">
                        {hook.text}
                      </pre>
                    </div>
                  </details>
                ))
              )}
            </Section>
          )}
          {page === "skills" && <PluginsPage skills={allSkills} onReloadCommands={onReloadCommands} onOpenMcp={() => setPage("mcp")} onTrySkill={(name) => { onClose(); onTrySkill(name) }} />}

          {page === "shortcuts" && (
            <Section title="Shortcuts">
              {shortcuts.map(([label, keys]) => (
                <Row key={label} label={label}>
                  <span className="flex shrink-0 gap-1">
                    {(label === "Run instruction" && settings.composer.sendShortcut === "modifier-enter" ? [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "Enter"] : keys).map((key) => (
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
          )}
        </div>
      </main>
      {dialog}
      {authOpen && auth && (
        <AuthDialog
          auth={auth}
          account={account}
          onClose={() => {
            setAuthOpen(false)
            onCloseAuthentication()
          }}
          onRetry={onStartAuthentication}
          onWait={onWaitForAuthentication}
          onSubmitCode={onSubmitAuthenticationCode}
        />
      )}
    </div>,
    document.body,
  )
}

type PluginsTab = "plugins" | "skills" | "marketplace"
type SkillCommand = AgentState["commands"][number]

const outlineButton = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-card)] px-3.5 text-body hover:bg-[var(--settings-fill-hover)] disabled:opacity-40"
const primaryButton = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--text-primary)] px-3.5 text-body text-[var(--surface-page,#FFFFFF)] hover:opacity-90 disabled:opacity-40"
const iconButton = "rounded-md p-1.5 text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
const tileClass = "flex size-10 shrink-0 items-center justify-center border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)]"
const PAGE_SIZE = 40

function CubeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3 19.5 7.2v8.6L12 20l-7.5-4.2V7.2L12 3Z" />
      <path d="M4.5 7.2 12 11.5l7.5-4.3M12 11.5V20" />
    </svg>
  )
}
// Marketplaces that are a local folder or file have no remote to pull from.
const LOCAL_SOURCES = new Set(["directory", "file"])
const SKILL_SOURCE_LABELS: Record<string, string> = { userSettings: "Personal", projectSettings: "Project", localSettings: "Project", bundled: "System", builtin: "System", mcp: "MCP" }

const titleCase = (name: string) => (name.split(":").pop() ?? name).split(/[-_\s]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ")

// Skills that ship inside Noa cannot be switched off or removed from here.
const SYSTEM_SKILL_SOURCES = new Set(["bundled", "builtin", "mcp"])

function skillBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
}

function PluginsPage({ skills: promptCommands, onReloadCommands, onOpenMcp, onTrySkill }: { skills: SkillCommand[]; onReloadCommands: () => void; onOpenMcp: () => void; onTrySkill: (name: string) => void }) {
  const { confirm, dialog } = useConfirm()
  const [catalog, setCatalog] = useState<PluginCatalog>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<PluginsTab>("plugins")
  const [browsing, setBrowsing] = useState(false)
  const [detail, setDetail] = useState<string>()
  const [filter, setFilter] = useState("")
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [menuOpen, setMenuOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  // Enabled flags the user just flipped, shown until the CLI confirms them.
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>({})
  const [skillsState, setSkillsState] = useState<SkillsState>({ modes: {}, userSkills: [] })
  const [skillName, setSkillName] = useState<string>()
  const [skillText, setSkillText] = useState<string>()
  const [skillMenu, setSkillMenu] = useState(false)
  const [rowMenu, setRowMenu] = useState<string>()
  const [source, setSource] = useState("")
  const [sparse, setSparse] = useState("")

  const load = () => fetchPlugins().then((next) => { setCatalog(next); setLoadError(undefined) }, (e: Error) => setLoadError(e.message))
  useEffect(() => { void load() }, [])
  const loadSkills = () => fetchSkillsState().then(setSkillsState, () => {})
  useEffect(() => { void loadSkills() }, [])
  const removable = skillsState.userSkills.map((skill) => skill.name)
  // A skill that is switched off disappears from the CLI's command list, so the user's own ones are added back.
  const known = new Set(promptCommands.map((command) => command.name))
  const merged: SkillCommand[] = [
    ...promptCommands.filter((command) => !command.hidden),
    ...skillsState.userSkills.filter((skill) => !known.has(skill.name)).map((skill): SkillCommand => ({ name: skill.name, description: skill.description, argumentHint: "", type: "prompt", source: "userSettings" })),
  ]
  // Switching a skill off moves it from the command list to the appended ones; keeping each skill at the
  // place it was first shown stops the row from jumping to the bottom.
  const skillOrder = useRef(new Map<string, number>())
  for (const command of merged) if (!skillOrder.current.has(command.name)) skillOrder.current.set(command.name, skillOrder.current.size)
  const skills = [...merged].sort((a, b) => skillOrder.current.get(a.name)! - skillOrder.current.get(b.name)!)
  const skillOff = (name: string) => skillsState.modes[name] === "off"
  // A switched-off skill is only recoverable here when it is listed from the user's own folder.
  const switchable = (command: SkillCommand) => !SYSTEM_SKILL_SOURCES.has(command.source ?? "") && removable.includes(command.name)
  const currentSkill = skills.find((command) => command.name === skillName)
  const ownsSkill = skillName !== undefined && removable.includes(skillName)

  useEffect(() => {
    setSkillText(undefined)
    setSkillMenu(false)
    if (!skillName || !ownsSkill) return
    let stale = false
    runSkillAction("read", skillName).then((result) => { if (!stale) setSkillText(result.content) }, () => {})
    return () => { stale = true }
  }, [skillName, ownsSkill])

  // The switch moves at once; the file write and the command reload catch up behind it.
  const setSkillMode = async (name: string, enabled: boolean) => {
    setError(undefined)
    setSkillsState((current) => {
      const modes = { ...current.modes }
      if (enabled) delete modes[name]
      else modes[name] = "off"
      return { ...current, modes }
    })
    try {
      await runSkillAction("mode", name, enabled ? "on" : "off")
      onReloadCommands()
    } catch (e) {
      setError(`Failed to update skill\n${e instanceof Error ? e.message : String(e)}`)
    }
    await loadSkills()
  }

  const uninstallSkill = async (name: string) => {
    if (!(await confirm({
      title: `Uninstall ${titleCase(name)}?`,
      description: "This deletes the skill's folder from your skills directory.",
      confirmLabel: "Uninstall",
      danger: true,
    }))) return
    setError(undefined)
    try {
      await runSkillAction("uninstall", name)
      setSkillName(undefined)
      await loadSkills()
      onReloadCommands()
    } catch (e) {
      setError(`Failed to uninstall skill\n${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // A failure shows the CLI's message under a summary line; success reloads the catalog and the slash commands.
  const run = async (key: string, action: PluginAction, target?: string, extra?: string, failure?: string, scope?: string) => {
    setBusy(key)
    setError(undefined)
    try {
      await runPluginAction(action, target, extra, scope)
      await load()
      if (action === "install" || action === "uninstall" || action === "enable" || action === "disable") onReloadCommands()
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(failure ? `${failure}\n${message}` : message)
      return false
    } finally {
      setBusy(undefined)
    }
  }

  const available = catalog?.available ?? []
  const byId = new Map(available.map((plugin) => [plugin.pluginId, plugin]))
  const installed = (catalog?.installed ?? []).map((plugin) => {
    const [name = plugin.id, marketplace] = plugin.id.split("@")
    return { ...plugin, name, marketplace, enabled: pendingEnabled[plugin.id] ?? plugin.enabled, description: plugin.description ?? byId.get(plugin.id)?.description }
  })
  const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]))
  const needle = filter.trim().toLowerCase()
  const match = (text: string) => !needle || text.toLowerCase().includes(needle)
  const marketplaces = (catalog?.marketplaces ?? []).filter((market) => match(market.name))
  const counts = { plugins: installed.length, skills: skills.length, marketplace: catalog?.marketplaces.length ?? 0 }
  const tabs: [PluginsTab, string][] = [["plugins", "Plugins"], ["skills", "Skills"], ["marketplace", "Marketplace"]]
  const busyAny = busy !== undefined

  // Plugins installed for a session only cannot be changed from here.
  const manageable = (plugin: { scope: string }) => ["user", "project", "local"].includes(plugin.scope)

  const setPluginEnabled = async (id: string, enabled: boolean, scope: string) => {
    setPendingEnabled((current) => ({ ...current, [id]: enabled }))
    await run(`toggle:${id}`, enabled ? "enable" : "disable", id, undefined, undefined, scope)
    setPendingEnabled(({ [id]: _settled, ...rest }) => rest)
  }

  const uninstall = (id: string, name: string, scope: string) => run(`uninstall:${id}`, "uninstall", id, undefined, `Unable to uninstall ${name}. Retry to continue`, scope)

  const removeMarketplace = async (name: string) => {
    const affected = installed.filter((plugin) => plugin.marketplace === name)
    if (!(await confirm({
      title: `Remove "${name}"?`,
      description: affected.length ? (
        <>
          The following plugins will be uninstalled, and can't be re-installed unless you add this marketplace again.
          <span className="mt-2 block font-medium">{affected.map((plugin) => plugin.name).join(", ")}</span>
        </>
      ) : "Its plugins will not appear or be available for installation unless you add it again.",
      confirmLabel: affected.length ? "Uninstall & remove" : "Remove",
      danger: true,
    }))) return
    setBusy(`remove:${name}`)
    setError(undefined)
    try {
      for (const plugin of affected) await runPluginAction("uninstall", plugin.id, undefined, plugin.scope)
      await runPluginAction("marketplace-remove", name)
    } catch (e) {
      setError(`Unable to remove the marketplace. Some of its plugins may already be uninstalled. Retry to continue\n${e instanceof Error ? e.message : String(e)}`)
    } finally {
      // Whatever was uninstalled before a failure still has to leave the command list.
      await load()
      onReloadCommands()
      setBusy(undefined)
    }
  }

  // One list row: 40px tile, 14px name over a one-line 14px description, then the trailing control.
  const row = (id: string, name: string, muted: string | undefined, description: string | undefined, control: ReactNode, opts: { onOpen?: () => void; round?: boolean; tile?: ReactNode } = {}) => (
    <div key={id} data-plugin={id} className="flex items-center gap-3.5 rounded-2xl px-2 py-3.5 transition-colors hover:bg-[var(--settings-fill-hover)]">
      <button type="button" disabled={!opts.onOpen} onClick={opts.onOpen} className="flex min-w-0 flex-1 items-center gap-3.5 pr-8 text-left disabled:cursor-default">
        <span className={`${tileClass} ${opts.round ? "rounded-full" : "rounded-xl"}`}>{opts.tile ?? <CubeIcon />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-body leading-[22px] text-[var(--text-primary)]">{name}</span>
            {muted && <span className="truncate text-body text-[var(--sidebar-text-muted)]">{muted}</span>}
          </span>
          {description && <span className="line-clamp-1 text-body leading-[22px] text-[var(--sidebar-text-muted)]">{description}</span>}
        </span>
      </button>
      {control}
    </div>
  )

  const installControl = (id: string, name: string) => installedById.has(id)
    ? <span className="shrink-0 text-body text-[var(--sidebar-text-muted)]">Installed</span>
    : <button type="button" className={outlineButton} disabled={busyAny} onClick={() => run(`install:${id}`, "install", id, undefined, `Unable to install ${name}.`)}>
        {busy === `install:${id}` ? "Installing…" : "Install"}
      </button>

  const open = (id: string) => { setDetail(id); setError(undefined) }
  const empty = (title: string, hint?: string) => (
    <div className="flex flex-col items-center gap-1 py-16 text-center">
      <span className="text-body text-[var(--text-primary)]">{title}</span>
      {hint && <span className="text-body text-[var(--sidebar-text-muted)]">{hint}</span>}
    </div>
  )
  const flat = (rows: ReactNode[]) => <div className="mt-2 flex flex-col">{rows}</div>

  let body: ReactNode
  if (detail) {
    const entry = installedById.get(detail)
    const listing = byId.get(detail)
    const name = entry?.name ?? listing?.name ?? detail.split("@")[0] ?? detail
    const marketplace = entry?.marketplace ?? listing?.marketplaceName
    const servers = Object.keys(entry?.mcpServers ?? {})
    const origin = listing?.source && typeof listing.source === "object" ? (listing.source.url ?? listing.source.repo ?? listing.source.path) : undefined
    body = (
      <>
        <div className="flex items-center gap-3">
          <span className={`${tileClass} !size-12 rounded-xl`}><CubeIcon size={22} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[18px] leading-6">{name}</span>
            {marketplace && <span className="block truncate text-body text-[var(--sidebar-text-muted)]">{marketplace}</span>}
          </span>
          {entry ? (manageable(entry) ? (
            <span className="flex shrink-0 items-center gap-3">
              <Toggle checked={entry.enabled} label={entry.enabled ? "Disable plugin" : "Enable plugin"} onChange={(enabled) => void setPluginEnabled(entry.id, enabled, entry.scope)} />
              <button type="button" className={outlineButton} disabled={busyAny} onClick={() => uninstall(entry.id, name, entry.scope)}>
                {busy === `uninstall:${entry.id}` ? "Uninstalling…" : "Uninstall"}
              </button>
            </span>
          ) : null) : installControl(detail, name)}
        </div>
        {(entry?.description ?? listing?.description) && <p className="noa-selectable m-0 text-body leading-[22px]">{entry?.description ?? listing?.description}</p>}
        <Section title="Information">
          {marketplace && <Row label="Marketplace"><span className="text-body text-[var(--sidebar-text-muted)]">{marketplace}</span></Row>}
          {entry && <Row label="Version"><span className="text-body text-[var(--sidebar-text-muted)]">{entry.version}</span></Row>}
          {entry && <Row label="Scope"><span className="text-body capitalize text-[var(--sidebar-text-muted)]">{entry.scope}</span></Row>}
          {listing?.installCount !== undefined && <Row label="Installs"><span className="text-body text-[var(--sidebar-text-muted)]">{listing.installCount.toLocaleString()}</span></Row>}
          {entry?.homepage && <Row label="Website"><span className="noa-selectable max-w-[22rem] truncate text-body text-[var(--sidebar-text-muted)]">{entry.homepage}</span></Row>}
          {origin && <Row label="Source"><span className="noa-selectable max-w-[22rem] truncate text-body text-[var(--sidebar-text-muted)]">{origin}</span></Row>}
        </Section>
        {servers.length > 0 && (
          <Section title="Capabilities">
            {servers.map((server) => <Row key={server} label={server} description="MCP server" />)}
          </Section>
        )}
      </>
    )
  } else if (!catalog && tab !== "skills" && !browsing) {
    body = loadError
      ? <div className="flex flex-col items-center gap-3 py-16 text-center"><span className="text-body">Failed to load plugins</span><span className="text-body text-[var(--sidebar-text-muted)]">{loadError}</span><button type="button" className={outlineButton} onClick={() => { setLoadError(undefined); void load() }}>Retry</button></div>
      : empty("Loading plugins…")
  } else if (browsing) {
    // The CLI's available list leaves out what is installed, so fold those back in.
    const directory = [
      ...installed.map((plugin) => ({ pluginId: plugin.id, name: plugin.name, description: plugin.description })),
      ...available,
    ].sort((a, b) => a.name.localeCompare(b.name))
    const matches = directory.filter((plugin) => match(`${plugin.name} ${plugin.description ?? ""}`))
    body = (
      <>
        {matches.length
          ? flat(matches.slice(0, limit).map((plugin) => row(plugin.pluginId, plugin.name, undefined, plugin.description, installControl(plugin.pluginId, plugin.name), { onOpen: () => open(plugin.pluginId) })))
          : empty(directory.length ? "No matching plugins" : "No plugins available", directory.length ? undefined : "Add a marketplace to browse plugins.")}
        {matches.length > limit && <button type="button" className={`${outlineButton} self-center`} onClick={() => setLimit((value) => value + PAGE_SIZE)}>Load more</button>}
      </>
    )
  } else if (tab === "plugins") {
    const list = installed.filter((plugin) => match(`${plugin.name} ${plugin.description ?? ""}`))
    body = list.length ? (
      <Section>
        {list.map((plugin) => row(
          plugin.id, plugin.name, plugin.marketplace, plugin.description,
          <span className="flex shrink-0 items-center gap-1">
            {manageable(plugin) && <Toggle checked={plugin.enabled} label={plugin.enabled ? "Disable plugin" : "Enable plugin"} onChange={(enabled) => void setPluginEnabled(plugin.id, enabled, plugin.scope)} />}
            <button type="button" aria-label={`Open ${plugin.name}`} className={iconButton} onClick={() => open(plugin.id)}><ChevronRight size={16} /></button>
          </span>,
          { onOpen: () => open(plugin.id) },
        ))}
      </Section>
    ) : empty(installed.length ? "No matching plugins" : "No installed plugins", installed.length ? undefined : "Use Browse directory to install one.")
  } else if (tab === "skills") {
    const list = skills.filter((command) => match(`${command.name} ${command.description ?? ""}`))
    body = list.length ? flat(list.map((command) => {
      const description = command.rawDescription ?? command.description
      const off = skillOff(command.name)
      const own = removable.includes(command.name)
      const menuOpen = rowMenu === command.name
      return (
        <div key={command.name} data-skill={command.name} className={`group relative flex items-center gap-3.5 rounded-2xl px-2 py-3.5 transition-colors hover:bg-[var(--settings-fill-hover)] ${menuOpen ? "bg-[var(--settings-fill-hover)]" : ""}`}>
          <button type="button" onClick={() => setSkillName(command.name)} className={`flex min-w-0 flex-1 items-center gap-3.5 pr-8 text-left ${off ? "opacity-60" : ""}`}>
            <span className={`${tileClass} rounded-full`}><CubeIcon /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body leading-[22px] text-[var(--text-primary)]">{titleCase(command.name)}</span>
              <span className="block truncate text-body leading-[22px] text-[var(--sidebar-text-muted)]">{description}</span>
            </span>
          </button>
          <span className={`w-20 shrink-0 text-body text-[var(--sidebar-text-muted)] ${off ? "opacity-60" : ""}`}>{command.source ? (SKILL_SOURCE_LABELS[command.source] ?? sourceLabels[command.source] ?? command.source) : ""}</span>
          <span className={`relative flex w-6 shrink-0 justify-center transition-opacity focus-within:visible focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${menuOpen ? "visible opacity-100" : "invisible opacity-0"}`}>
            <button type="button" aria-label="Skill actions" aria-haspopup="menu" aria-expanded={menuOpen} className={iconButton} onClick={() => setRowMenu(menuOpen ? undefined : command.name)}>
              <span aria-hidden="true" className="px-0.5 text-body leading-none">•••</span>
            </button>
            {menuOpen && (
              <>
                <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setRowMenu(undefined)} />
                <div role="menu" className="absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1 shadow-[var(--shadow-dialog)]">
                  <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); setSkillName(command.name) }}>Details</button>
                  {own && (
                    <>
                      <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); void runSkillAction("reveal", command.name).catch((e: Error) => setError(e.message)) }}>Reveal in Finder</button>
                      <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); void runSkillAction("read", command.name).then((result) => navigator.clipboard.writeText(result.content ?? ""), (e: Error) => setError(e.message)) }}>Copy Markdown</button>
                      <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body text-[#C24444] hover:bg-[var(--settings-fill-hover)]" onClick={() => { setRowMenu(undefined); void uninstallSkill(command.name) }}>Uninstall</button>
                    </>
                  )}
                </div>
              </>
            )}
          </span>
          <span className="flex w-8 shrink-0 justify-end">
            {switchable(command) && <Toggle checked={!off} label={off ? "Enable skill" : "Disable skill"} onChange={(enabled) => void setSkillMode(command.name, enabled)} />}
          </span>
        </div>
      )
    })) : empty(skills.length ? "No matching skills" : "No skills available")
  } else {
    body = marketplaces.length ? flat(marketplaces.map((market) => {
      const local = LOCAL_SOURCES.has(market.source)
      return (
        <div key={market.name} className="flex items-center gap-3.5 px-2 py-3.5">
          <span className={`${tileClass} rounded-xl !border-transparent !bg-[var(--settings-fill-hover)]`}><Download size={18} /></span>
          <span className="min-w-0 flex-1 pr-8">
            <span className="block truncate text-body leading-[22px] text-[var(--text-primary)]">{market.name}</span>
            <span className="block text-body leading-[22px] text-[var(--sidebar-text-muted)]">{available.filter((plugin) => plugin.marketplaceName === market.name).length} plugins</span>
            <span className="block truncate text-body leading-[22px] text-[var(--sidebar-text-muted)]">{market.repo ?? market.url ?? market.path ?? market.installLocation ?? market.source}</span>
          </span>
          <button
            type="button"
            className={outlineButton}
            title={local ? "Only Git marketplaces can be upgraded" : undefined}
            disabled={busyAny || local}
            onClick={() => run(`update:${market.name}`, "marketplace-update", market.name, undefined, "Unable to upgrade the marketplace.")}
          >
            {busy === `update:${market.name}` ? "Upgrading…" : "Upgrade"}
          </button>
          <button type="button" aria-label={`Remove ${market.name}`} title="Remove marketplace" className={iconButton} disabled={busyAny} onClick={() => void removeMarketplace(market.name)}>
            <Trash2 size={17} />
          </button>
        </div>
      )
    })) : empty(catalog?.marketplaces.length ? "No matching marketplaces" : "No marketplaces found", catalog?.marketplaces.length ? undefined : "Add one to browse and install plugins.")
  }

  const inDetail = detail !== undefined
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-8 font-normal">Plugins</h1>
          {inDetail ? (
            <button type="button" className="mt-1.5 inline-flex items-center gap-1 text-body text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]" onClick={() => setDetail(undefined)}>
              <ChevronLeft size={14} />
              {browsing ? "Directory" : "Plugins"}
            </button>
          ) : (
            <p className="m-0 mt-1.5 text-body text-[var(--sidebar-text-muted)]">Manage plugins, skills, and marketplaces</p>
          )}
        </div>
        {!inDetail && (
          <div className="relative flex shrink-0 gap-2 pt-1">
            <button type="button" className={outlineButton} onClick={() => { setBrowsing((value) => !value); setFilter(""); setLimit(PAGE_SIZE) }}>{browsing ? "Back" : "Browse directory"}</button>
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} className={primaryButton} onClick={() => setMenuOpen((value) => !value)}>
              Add
              <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <>
                <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="absolute right-0 top-full z-20 mt-1.5 flex min-w-48 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1 shadow-[var(--shadow-dialog)]">
                  <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setMenuOpen(false); setAdding(true); setTab("marketplace"); setBrowsing(false) }}>Add marketplace</button>
                  <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setMenuOpen(false); onOpenMcp() }}>Add MCP server</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {!inDetail && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1" role="tablist">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={!browsing && tab === key}
                onClick={() => { setTab(key); setBrowsing(false); setFilter("") }}
                className={`h-7 rounded-[10px] px-2.5 text-body ${!browsing && tab === key ? "bg-[var(--settings-fill-hover)] text-[var(--text-primary)]" : "text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"}`}
              >
                {label} <span className="ms-0.5">{counts[key]}</span>
              </button>
            ))}
          </div>
          <label className="flex h-8 w-60 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3 text-[var(--sidebar-text-muted)]">
            <Search size={15} />
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setLimit(PAGE_SIZE) }}
              placeholder={browsing ? "Search directory" : tab === "marketplace" ? "Search marketplaces" : tab === "skills" ? "Search skills" : "Search plugins"}
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
            />
          </label>
        </div>
      )}
      {adding && !inDetail && (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] px-4 py-3.5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await run("add", "marketplace-add", source.trim(), sparse, "Failed to add marketplace")) {
              setAdding(false)
              setSource("")
              setSparse("")
            }
          }}
        >
          <span className="text-body font-medium">Add plugin marketplace</span>
          <span className="text-body text-[var(--sidebar-text-muted)]">Add from a GitHub repo, Git URL, or local folder.</span>
          {([
            ["Source", source, setSource, "owner/repo or git@github.com:org/repo.git", true],
            ["Sparse paths", sparse, setSparse, "plugins/example (optional)", false],
          ] as const).map(([label, value, set, placeholder, focus]) => (
            <label key={label} className="flex flex-col gap-1.5 text-body text-[var(--text-secondary)]">
              {label}
              <input
                autoFocus={focus}
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
                disabled={busy === "add"}
                className="h-9 rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
              />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" className={outlineButton} disabled={busy === "add"} onClick={() => { setAdding(false); setError(undefined) }}>Cancel</button>
            <button type="submit" className={primaryButton} disabled={!source.trim() || busy === "add"}>{busy === "add" ? "Adding…" : "Add marketplace"}</button>
          </div>
        </form>
      )}
      {currentSkill && createPortal(
        <div
          className="noa-confirm-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(event) => { if (event.target === event.currentTarget) setSkillName(undefined) }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setSkillName(undefined) } }}
        >
          <div role="dialog" aria-modal="true" aria-label={titleCase(currentSkill.name)} className="noa-confirm-dialog flex max-h-[85vh] w-full max-w-[560px] flex-col gap-3 rounded-2xl bg-[var(--bg-card)] p-5 font-ui">
            <div className="flex items-center justify-between">
              <span className={`${tileClass} rounded-full`}><CubeIcon /></span>
              <span className="relative flex items-center gap-1">
                {switchable(currentSkill) && <Toggle checked={!skillOff(currentSkill.name)} label={skillOff(currentSkill.name) ? "Enable skill" : "Disable skill"} onChange={(enabled) => void setSkillMode(currentSkill.name, enabled)} />}
                {removable.includes(currentSkill.name) && (
                  <>
                    <button type="button" aria-label="Skill actions" aria-haspopup="menu" className={iconButton} onClick={() => setSkillMenu((value) => !value)}>
                      <span aria-hidden="true" className="px-0.5 text-body leading-none">•••</span>
                    </button>
                    {skillMenu && (
                      <>
                        <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setSkillMenu(false)} />
                        <div role="menu" className="absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1 shadow-[var(--shadow-dialog)]">
                          <button type="button" role="menuitem" className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)]" onClick={() => { setSkillMenu(false); void runSkillAction("reveal", currentSkill.name).catch((e: Error) => setError(e.message)) }}>Reveal in Finder</button>
                          <button type="button" role="menuitem" disabled={skillText === undefined} className="h-8 rounded-lg px-2.5 text-left text-body hover:bg-[var(--settings-fill-hover)] disabled:opacity-40" onClick={() => { setSkillMenu(false); void navigator.clipboard.writeText(skillText ?? "") }}>Copy Markdown</button>
                        </div>
                      </>
                    )}
                  </>
                )}
                <button type="button" aria-label="Close" className={iconButton} onClick={() => setSkillName(undefined)}><X size={16} /></button>
              </span>
            </div>
            <h2 className="m-0 flex items-baseline gap-2 text-[18px] font-medium leading-6">
              {titleCase(currentSkill.name)}
              <span className="text-[16px] font-normal text-[var(--sidebar-text-muted)]">Skill</span>
              {skillOff(currentSkill.name) && <span className="rounded-md border border-[var(--border-default)] px-1.5 text-caption font-normal text-[var(--sidebar-text-muted)]">Disabled</span>}
            </h2>
            <p className="noa-selectable m-0 whitespace-pre-wrap break-words text-body leading-[22px] text-[var(--sidebar-text-muted)]">{currentSkill.rawDescription ?? currentSkill.description}</p>
            {skillText !== undefined && skillBody(skillText) && (
              <div className="noa-selectable min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border-default)] px-4 py-3 text-body">
                <Markdown text={skillBody(skillText)} />
              </div>
            )}
            <div className="mt-1 flex items-center justify-between">
              {removable.includes(currentSkill.name) ? (
                <button type="button" className="h-8 rounded-[10px] bg-[color-mix(in_srgb,#C24444_12%,transparent)] px-3.5 text-body text-[#C24444] hover:bg-[color-mix(in_srgb,#C24444_18%,transparent)]" onClick={() => void uninstallSkill(currentSkill.name)}>Uninstall</button>
              ) : <span />}
              <button type="button" className={primaryButton} disabled={skillOff(currentSkill.name)} onClick={() => onTrySkill(currentSkill.name)}>Try now</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {error && (
        <p role="alert" className="noa-selectable m-0 whitespace-pre-wrap rounded-xl bg-[color-mix(in_srgb,#C24444_10%,transparent)] px-3 py-2 text-body text-[#C24444]">{error}</p>
      )}
      {body}
      {dialog}
    </>
  )
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  const rows = Children.toArray(children)
  return (
    // A settings group: a 40px header row above an outlined 16px-radius card whose dividers inset 16px.
    <section data-settings-label={title} className="flex flex-col">
      {title && <h3 className="flex min-h-10 items-center pb-1.5 text-balance text-body font-medium">{title}</h3>}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-card,#FFFFFF)_30%,transparent)]">
        {rows.map((row, i) => (
          <div key={i} className="relative">
            {i < rows.length - 1 && <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-[var(--divider-subtle)]" />}
            {row}
          </div>
        ))}
      </div>
    </section>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div data-settings-label={label} className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-chat-sm leading-[18px] font-medium">{label}</span>
        {description && <span className="text-caption leading-4 text-[var(--sidebar-text-muted)]">{description}</span>}
      </div>
      {children}
    </div>
  )
}

function NumberField({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  // Local draft so intermediate typing ("1" on the way to "12") is not rejected by the controlled value.
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const next = Number(draft)
    if (draft.trim() === "" || !Number.isFinite(next)) return setDraft(String(value))
    const clamped = Math.min(max, Math.max(min, Math.round(next)))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={1}
      inputMode="numeric"
      onChange={(e) => {
        setDraft(e.target.value)
        // Spinner arrows and in-range typing apply at once; out-of-range text waits for blur to clamp.
        const next = Number(e.target.value)
        if (e.target.value.trim() !== "" && Number.isInteger(next) && next >= min && next <= max) onChange(next)
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-8 w-16 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-body text-[var(--text-primary)] outline-none"
    />
    <span className="text-caption text-[var(--sidebar-text-muted)]">px</span>
    </div>
  )
}

function Slider({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  return (
    <div className="flex h-9 min-w-[12rem] shrink-0 items-center gap-2.5">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="noa-theme-slider"
      />
      <span className="w-9 text-end text-body tabular-nums">{value}</span>
    </div>
  )
}

function Select({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 appearance-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] pr-8 pl-3 text-body text-[var(--text-primary)] outline-none disabled:opacity-40"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--sidebar-text-muted)]" />
    </div>
  )
}

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <div className="flex shrink-0 gap-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`h-8 rounded-lg px-3 ${
            value === v ? "bg-[var(--settings-fill-active)] text-[var(--text-primary)]" : "text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${checked ? "bg-[var(--accent-color)]" : "bg-[var(--settings-switch-off,#D8D6CF)]"}`}
    >
      <span
        aria-hidden="true"
        className={`size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[cubic-bezier(0,0,0.2,1)] ${checked ? "translate-x-[14px]" : "translate-x-[2px]"}`}
      />
    </button>
  )
}

function providerDisplayName(provider: string): string {
  const labels: Record<string, string> = {
    firstParty: "Anthropic",
    openaiCompatible: "OpenAI-compatible",
    bedrock: "Amazon Bedrock",
    vertex: "Google Vertex",
    foundry: "Microsoft Foundry",
  }
  return labels[provider] ?? provider
}
