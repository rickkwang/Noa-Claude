import { Children, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AppSettings } from "../types"
import type { AgentState } from "../agent/reducer"
import type { PermissionMode, AccountInfo } from "../agent/protocol"
import { ArrowLeft, ChevronDown, Keyboard, Palette, Search, Settings, Plug, SlidersHorizontal, List, RefreshCcw } from "../lib/icons"
import { SYSTEM_DEFAULT_FONT, UI_FONT_STYLES } from "../lib/fontFamily"
import { findModel } from "../lib/models"
import { defaultSettings } from "../theme/settings"
import { AuthDialog } from "./AuthDialog"

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
    rows: ["Account", "Default permissions", "Send shortcut", "Show context window usage"],
  },
  {
    key: "appearance",
    label: "Appearance",
    group: "Personal",
    icon: <Palette size={16} />,
    rows: [
      "Mode",
      "Font",
      "Font style",
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
    label: "Skills & plugins",
    group: "Integrations",
    icon: <List size={16} />,
    rows: ["Available skills and commands", "Configured plugins"],
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
  "h-8 shrink-0 rounded-lg border border-[var(--divider-subtle)] px-3 text-body hover:bg-[var(--settings-fill-hover)] disabled:opacity-40"

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
  const permissionMode = settings.agent.permissionDefault
  const providerLabel = account?.apiProvider ? providerDisplayName(account.apiProvider) : undefined
  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const setPermission = (permissionDefault: DefaultMode) =>
    onChange({ ...settings, agent: { ...settings.agent, permissionDefault } })
  const [localFonts, setLocalFonts] = useState<string[]>([])
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
  const skills = agent.commands.filter((command) => !command.hidden && command.type === "prompt")
  const plugins = Object.entries(agent.cliSettings?.effective.enabledPlugins ?? {})

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
  const current = pages.find((p) => p.key === page)
  const fontOptions: [string, string][] = [
    [SYSTEM_DEFAULT_FONT, "System default"],
    ...localFonts.map((f) => [f, f] as [string, string]),
  ]
  if (appearance.fontFamily !== SYSTEM_DEFAULT_FONT && !localFonts.includes(appearance.fontFamily))
    fontOptions.push([appearance.fontFamily, appearance.fontFamily])
  const codeFontOptions: [string, string][] = [
    [SYSTEM_DEFAULT_FONT, "System monospace"],
    ...localFonts.map((font) => [font, font] as [string, string]),
  ]
  if (appearance.codeFontFamily !== SYSTEM_DEFAULT_FONT && !localFonts.includes(appearance.codeFontFamily))
    codeFontOptions.push([appearance.codeFontFamily, appearance.codeFontFamily])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    backRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    if (page !== "appearance") return
    const query = (window as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    query?.()
      .then((fonts) => setLocalFonts([...new Set(fonts.map((f) => f.family))].sort()))
      .catch(() => setLocalFonts([]))
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
      className="fixed inset-0 z-50 flex bg-[var(--bg-primary,#FCFCFB)] text-body text-[var(--text-primary)]"
    >
      <nav className="flex shrink-0 flex-col bg-[var(--bg-sidebar,#FBFBF9)] px-2 pb-3" style={{ width: navWidth }}>
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
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
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
      <div aria-hidden="true" className="w-[0.5px] shrink-0 bg-[var(--divider-subtle,#E6E2DA)]" />
      <main className="min-w-0 flex-1 overflow-y-auto px-5 pt-[120px] pb-5">
        <div key={page} className="mx-auto flex max-w-3xl flex-col gap-10">
          <h1 className="text-[26px] leading-8 font-normal">{current?.label}</h1>

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
                    className="h-8 rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-card)] px-3 text-body text-[var(--text-primary)] hover:bg-[var(--settings-fill-hover)]"
                  >
                    {account?.email ? "Sign in again" : "Sign in"}
                  </button>
                </Row>
              </Section>
              <Section title="Permissions">
              <Row
                label="Default permissions"
                description="The mode new tasks start in. Follow Noa settings uses permissions.defaultMode from settings.json."
              >
                <Select
                  value={permissionMode}
                  options={permissionOptions}
                  onChange={(value) => setPermission(value as DefaultMode)}
                />
              </Row>
              </Section>
              <Section title="Composer">
                <Row label="Send shortcut" description="Choose when Enter sends a message or inserts a new line.">
                  <Select
                    value={settings.composer.sendShortcut}
                    options={[
                      ["enter", "Enter"],
                      ["modifier-enter", `${navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} + Enter`],
                    ]}
                    onChange={(value) =>
                      onChange({
                        ...settings,
                        composer: { ...settings.composer, sendShortcut: value as AppSettings["composer"]["sendShortcut"] },
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
                <Row label="Font" description="Typeface for the interface.">
                  <Select
                    value={appearance.fontFamily}
                    options={fontOptions}
                    onChange={(fontFamily) => change({ fontFamily })}
                  />
                </Row>
                <Row label="Font style" description="Weight and italic for the interface font.">
                  <Select
                    value={appearance.uiFontStyle}
                    options={Object.entries(UI_FONT_STYLES).map(([v, s]) => [v, s.label] as [string, string])}
                    onChange={(uiFontStyle) => change({ uiFontStyle: uiFontStyle as AppSettings["appearance"]["uiFontStyle"] })}
                  />
                </Row>
              </Section>

              <Section title="Fonts">
                <Row label="Code font" description="Typeface for code blocks and diffs, separate from the interface font.">
                  <Select
                    value={appearance.codeFontFamily}
                    options={codeFontOptions}
                    onChange={(codeFontFamily) => change({ codeFontFamily })}
                  />
                </Row>
                <Row label="UI font size" description="Base size for interface text (11–16 px).">
                  <NumberField
                    value={appearance.uiFontSize}
                    min={11}
                    max={16}
                    onChange={(uiFontSize) => change({ uiFontSize })}
                  />
                </Row>
                <Row label="Code font size" description="Size for code blocks (8–24 px).">
                  <NumberField
                    value={appearance.codeFontSize}
                    min={8}
                    max={24}
                    onChange={(codeFontSize) => change({ codeFontSize })}
                  />
                </Row>
                <Row label="Font smoothing" description="Smooth edges of text on screen.">
                  <Toggle checked={appearance.fontSmoothing} onChange={(fontSmoothing) => change({ fontSmoothing })} />
                </Row>
              </Section>

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

          {["configuration", "hooks", "mcp", "skills"].includes(page) && (
            <>
              <div className="flex items-center justify-between gap-4 text-body text-[var(--sidebar-text-muted)]">
                <span>{disconnected ? "Connect Noa to load settings." : "Review settings for this workspace."}</span>
                <button
                  type="button"
                  disabled={disconnected || agent.mcpPending}
                  className={actionButton}
                  onClick={() => {
                    if (page === "mcp") onRefreshMcp()
                    else {
                      onRefreshSettings()
                      if (page === "skills") onReloadCommands()
                    }
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
                        ? [[agent.permissionMode, agent.permissionMode] as [string, string]]
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
          {page === "skills" && (
            <>
              <Section title="Available skills and commands">
                {skills.length ? (
                  skills.map((command) => (
                    <details key={command.name} data-skill={command.name} className="group">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block text-body font-medium">/{command.name}</span>
                          <span className="mt-0.5 line-clamp-2 text-caption leading-4 text-[var(--sidebar-text-muted)]">
                            {command.rawDescription ?? command.description}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-caption text-[var(--sidebar-text-muted)]">
                          {command.rawDescription !== undefined && command.source
                            ? (sourceLabels[command.source] ?? command.source)
                            : null}
                          <ChevronDown size={14} className="mt-0.5 transition-transform group-open:rotate-180" />
                        </span>
                      </summary>
                      <div className="noa-selectable max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-[var(--divider-subtle)] px-4 py-3 text-body leading-5">
                        {command.rawDescription ?? command.description}
                      </div>
                    </details>
                  ))
                ) : (
                  <Row label="No skills available" />
                )}
              </Section>
              <Section title="Configured plugins">
                {!agent.cliSettings ? (
                  <Row label="Loading…" />
                ) : plugins.length ? (
                  plugins.map(([name, enabled]) => (
                    <Row key={name} label={name} description={enabled ? "Enabled" : "Disabled"} />
                  ))
                ) : (
                  <Row label="No plugins configured" />
                )}
              </Section>
            </>
          )}

          {page === "shortcuts" && (
            <Section title="Shortcuts">
              {shortcuts.map(([label, keys]) => (
                <Row key={label} label={label}>
                  <span className="flex shrink-0 gap-1">
                    {(label === "Run instruction" && settings.composer.sendShortcut === "modifier-enter" ? [navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "Enter"] : keys).map((key) => (
                      <kbd
                        key={key}
                        className="flex h-5 min-w-5 items-center justify-center rounded-md border border-[var(--divider-subtle)] bg-[var(--bg-card)] px-1.5 text-caption text-[var(--sidebar-text-muted)]"
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  const rows = Children.toArray(children)
  return (
    // A settings group: a 40px header row above an outlined 16px-radius card whose dividers inset 16px.
    <section data-settings-label={title} className="flex flex-col">
      <h3 className="flex min-h-10 items-center pb-1.5 text-balance text-body font-medium">{title}</h3>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--bg-card,#FFFFFF)_30%,transparent)]">
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
      className="h-8 w-16 rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-card)] px-2 text-body text-[var(--text-primary)] outline-none"
    />
    <span className="text-caption text-[var(--sidebar-text-muted)]">px</span>
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
        className="h-8 appearance-none rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-card)] pr-8 pl-3 text-body text-[var(--text-primary)] outline-none disabled:opacity-40"
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--accent-color)]" : "bg-[var(--settings-switch-off,#D8D6CF)]"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`}
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
