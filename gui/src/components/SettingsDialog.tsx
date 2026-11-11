import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AppSettings } from "../types"
import type { AgentState } from "../agent/reducer"
import type { PermissionMode, AccountInfo, ControlRequest } from "../agent/protocol"
import { ArrowLeft, Download, Keyboard, Palette, Search, Settings, Plug, SlidersHorizontal, List } from "../lib/icons"
import { findModel } from "../lib/models"
import type { ProviderDraft } from "../lib/providerCatalog"
import { useConfirm } from "./ConfirmDialog"
import { AuthDialog } from "./AuthDialog"
import { AppearancePage } from "./settings/AppearancePage"
import { ConfigurationEditor } from "./settings/ConfigurationEditor"
import { ConfigurationPage, HooksPage, McpPage, RefreshBar } from "./settings/ConfigurationPages"
import { GeneralPage } from "./settings/GeneralPage"
import { PluginsPage } from "./settings/PluginsPage"
import { ProvidersPage } from "./settings/ProvidersPage"
import { ShortcutsPage } from "./settings/ShortcutsPage"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

type Page = "general" | "appearance" | "shortcuts" | "configuration" | "providers" | "mcp" | "hooks" | "skills"

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
    rows: ["Model", "Reasoning effort", "Current permissions", "Configuration sources", "Permission rules", "Edit permission rules"],
  },
  { key: "providers", label: "Providers", group: "Coding", icon: <Plug size={16} />, rows: ["Providers", "API key", "Base URL"] },
  { key: "hooks", label: "Hooks", group: "Coding", icon: <List size={16} />, rows: ["Configured hooks"] },
  { key: "mcp", label: "MCP servers", group: "Integrations", icon: <Plug size={16} />, rows: ["Connected servers", "Manage server configurations"] },
  {
    key: "skills",
    label: "Plugins",
    group: "Integrations",
    icon: <Download size={16} />,
    rows: ["Plugins", "Skills", "Marketplace", "Browse directory", "Add marketplace"],
  },
]

export function SettingsDialog({
  navWidth,
  navResizeHandle,
  settings,
  agent,
  onRefreshSettings,
  request,
  onReconnect,
  onRefreshMcp,
  onChangeMcp,
  onReloadCommands,
  onModel,
  onProvider,
  onSaveProvider,
  onFetchProviderModels,
  onDeleteProvider,
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
  signIn,
}: {
  // The main sidebar's width: the settings nav takes the sidebar's place.
  navWidth: number
  // The main sidebar's resize handle, so dragging here resizes the sidebar too.
  navResizeHandle: ReactNode
  settings: AppSettings
  agent: AgentState
  request: (request: ControlRequest) => Promise<any>
  onReconnect: () => Promise<void>
  onRefreshSettings: () => void
  onRefreshMcp: () => void
  onChangeMcp: (name: string, enabled?: boolean) => void
  onReloadCommands: () => void
  onModel: (model: string) => void
  onProvider: (providerId: string) => void
  onSaveProvider: (draft: ProviderDraft) => void
  onFetchProviderModels: (draft: ProviderDraft) => Promise<string[]>
  onDeleteProvider: (providerId: string) => void
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
  // Opened from /login: start sign-in right away.
  signIn?: boolean
}) {
  const [page, setPage] = useState<Page>("general")
  const [query, setQuery] = useState("")
  const [authOpen, setAuthOpen] = useState(false)
  useEffect(() => {
    if (!signIn) return
    setAuthOpen(true)
    onStartAuthentication()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signIn])
  const [searchTarget, setSearchTarget] = useState<{ label: string }>()
  const dialogRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [configurationDirty, setConfigurationDirty] = useState(false)
  const [mcpDirty, setMcpDirty] = useState(false)
  const { confirm: confirmClose, dialog: closeDialog } = useConfirm()
  async function requestClose() {
    if ((!configurationDirty && !mcpDirty) || await confirmClose({ title: "Discard unsaved changes?", description: "Your configuration changes have not been saved.", confirmLabel: "Discard", cancelLabel: "Keep editing", danger: true })) onClose()
  }
  useEffect(() => {
    if (!configurationDirty && !mcpDirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [configurationDirty, mcpDirty])
  const searchTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searchResults = pages.flatMap((p) => p.rows.map((label) => ({ page: p, label })))
    .filter(({ page, label }) => searchTerms.every((term) => `${page.label} ${label}`.toLowerCase().includes(term)))
  const disconnected = agent.connection !== "ready"
  const activeModel = findModel(agent.models, agent.model)
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
    if (settings.appearance.motion !== 'reduced') row?.animate([{ backgroundColor: "var(--settings-fill-active)" }, { backgroundColor: "transparent" }], { duration: 1200 })
  }, [page, searchTarget, settings.appearance.motion])
  // A search jump may land on a row inside Advanced, so it opens the group.
  const showAdvanced = advancedOpen || searchTarget !== undefined
  const current = pages.find((p) => p.key === page)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    backRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !authOpen) void requestClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [authOpen, onClose, configurationDirty, mcpDirty, confirmClose])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("[data-config-server]")) return
    if (event.key !== "Tab") return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], summary, [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter(element => element.getClientRects().length > 0)
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
            onClick={() => void requestClose()}
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
      {/* The content card has no titlebar of its own, so this strip keeps the top of the window draggable. */}
      <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-11" style={{ ...dragRegion, left: navWidth }} />
      <main className="noa-settings-main scrollbar-on-scroll min-w-0 flex-1 overflow-y-auto bg-[var(--bg-primary,#FCFCFB)] px-5 pt-[120px] pb-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-10">
          {page !== "skills" && <h1 className="text-[26px] leading-8 font-normal">{current?.label}</h1>}

          {page === "general" && (
            <GeneralPage
              settings={settings}
              account={account}
              activeModel={activeModel}
              onChange={onChange}
              onSignIn={() => {
                setAuthOpen(true)
                onStartAuthentication()
              }}
            />
          )}
          {page === "appearance" && (
            <AppearancePage
              settings={settings}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setAdvancedOpen((open) => !open)}
              onChange={onChange}
            />
          )}
          {(page === "configuration" || page === "hooks" || page === "mcp") && (
            <RefreshBar agent={agent} onRefresh={page === "mcp" ? onRefreshMcp : onRefreshSettings} />
          )}
          <div style={{ display: page === "configuration" ? "contents" : "none" }}><ConfigurationPage agent={agent} onModel={onModel} onEffort={onEffort} onMode={onMode} /><ConfigurationEditor kind="permissions" disabled={disconnected || agent.busy} request={request} onSaved={() => onRefreshSettings()} onDirtyChange={setConfigurationDirty} /></div>
          {page === "providers" && (
            <ProvidersPage
              providers={agent.providers}
              busy={agent.busy}
              pending={agent.providerPending}
              onUse={onProvider}
              onSave={onSaveProvider}
              onDelete={onDeleteProvider}
              onFetchModels={onFetchProviderModels}
            />
          )}
          <div style={{ display: page === "mcp" ? "contents" : "none" }}><McpPage agent={agent} onChangeMcp={onChangeMcp} /><ConfigurationEditor kind="mcp" disabled={disconnected || agent.busy || !!agent.queue.length || agent.tasks.some(task => task.status === "running")} request={request} onDirtyChange={setMcpDirty} onSaved={restart => restart ? onReconnect() : onRefreshMcp()} /></div>
          {page === "hooks" && <HooksPage agent={agent} />}
          {page === "skills" && <PluginsPage skills={allSkills} onReloadCommands={onReloadCommands} onOpenMcp={() => setPage("mcp")} onTrySkill={(name) => { onClose(); onTrySkill(name) }} />}
          {page === "shortcuts" && <ShortcutsPage settings={settings} onChange={onChange} />}
        </div>
      </main>
      {closeDialog}
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
