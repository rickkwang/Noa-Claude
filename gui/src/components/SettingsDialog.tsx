import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AppSettings } from "../types"
import type { AgentState } from "../agent/reducer"
import type { PermissionMode, AccountInfo, ControlRequest } from "../agent/protocol"
import { ArrowLeft, Cloud, Keyboard, List, Palette, Plug, RefreshCcw, Search, Settings, SlidersHorizontal, X } from "../lib/icons"
import { findModel } from "../lib/models"
import type { ProviderDraft } from "../lib/providerCatalog"
import { supportsSidebarTranslucency } from "../lib/translucency"
import { useConfirm } from "./ConfirmDialog"
import { AuthDialog } from "./AuthDialog"
import { AppearancePage } from "./settings/AppearancePage"
import { ConfigurationEditor } from "./settings/ConfigurationEditor"
import { ConfigurationPage, HooksPage, McpPage, RefreshBar } from "./settings/ConfigurationPages"
import { GeneralPage } from "./settings/GeneralPage"
import { ProvidersPage } from "./settings/ProvidersPage"
import { ShortcutsPage } from "./settings/ShortcutsPage"
import { actionButton } from "./settings/controls"
import { SETTINGS_PAGES, buildSettingsSearchIndex, filterSettingsSearch, type SearchResult, type SettingsPageKey } from "./settings/searchIndex"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

type Page = SettingsPageKey

const PAGE_ICONS: Record<Page, ReactNode> = {
  general: <Settings size={16} />,
  appearance: <Palette size={16} />,
  shortcuts: <Keyboard size={16} />,
  configuration: <SlidersHorizontal size={16} />,
  providers: <Cloud size={16} />,
  hooks: <List size={16} />,
  mcp: <Plug size={16} />,
}

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
  onModel,
  onProvider,
  onSaveProvider,
  onFetchProviderModels,
  onDeleteProvider,
  onEffort,
  onOutputStyle,
  onMode,
  onChange,
  onClose,
  account,
  auth,
  onStartAuthentication,
  onSubmitAuthenticationCode,
  onCloseAuthentication,
  signIn,
  initialPage,
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
  onModel: (model: string) => void
  onProvider: (providerId: string) => void
  onSaveProvider: (draft: ProviderDraft) => void
  onFetchProviderModels: (draft: ProviderDraft) => Promise<string[]>
  onDeleteProvider: (providerId: string) => void
  onEffort: (effort: string | null) => void
  onOutputStyle: (style: string) => void
  onMode: (mode: PermissionMode) => void
  onChange: (settings: AppSettings) => void
  onClose: () => void
  initialPage?: Page
  account?: AccountInfo
  auth?: AgentState["auth"]
  onStartAuthentication: () => void
  onSubmitAuthenticationCode: (code: string) => void
  onCloseAuthentication: () => void
  // Opened from /login: start sign-in right away.
  signIn?: boolean
}) {
  const [page, setPage] = useState<Page>(initialPage ?? "general")
  const [query, setQuery] = useState("")
  const [authOpen, setAuthOpen] = useState(false)
  useEffect(() => {
    if (!signIn) return
    setAuthOpen(true)
    onStartAuthentication()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signIn])
  const [searchTarget, setSearchTarget] = useState<{ label: string; seq: number }>()
  const [activeSearchIndex, setActiveSearchIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const [configurationDirty, setConfigurationDirty] = useState(false)
  const [providersDirty, setProvidersDirty] = useState(false)
  const [mcpDirty, setMcpDirty] = useState(false)
  const { confirm: confirmClose, dialog: closeDialog } = useConfirm()
  const dirtyPages: string[] = [
    ...(configurationDirty ? ["Configuration"] : []),
    ...(providersDirty ? ["Providers"] : []),
    ...(mcpDirty ? ["MCP servers"] : []),
  ]
  const anyDirty = dirtyPages.length > 0
  const dirtyList = dirtyPages.length === 1
    ? dirtyPages[0]
    : dirtyPages.length === 2
      ? `${dirtyPages[0]} and ${dirtyPages[1]}`
      : `${dirtyPages.slice(0, -1).join(", ")}, and ${dirtyPages.at(-1)}`
  async function requestClose() {
    if (!anyDirty || await confirmClose({ title: "Discard unsaved changes?", description: `Your changes in ${dirtyList} have not been saved.`, confirmLabel: "Discard", cancelLabel: "Keep editing", danger: true })) onClose()
  }
  useEffect(() => {
    if (!anyDirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", prevent)
    return () => window.removeEventListener("beforeunload", prevent)
  }, [anyDirty])
  const searchIndex = buildSettingsSearchIndex({
    soundEnabled: settings.composer.streamSound.enabled,
    supportsSidebarTranslucency: supportsSidebarTranslucency(),
    providers: agent.providers,
  })
  const searchResults = filterSettingsSearch(searchIndex, query)
  useEffect(() => setActiveSearchIndex(0), [query])
  const selectSearchResult = (result: SearchResult) => {
    setPage(result.page.key)
    setSearchTarget({ label: result.target, seq: Date.now() })
    setQuery("")
  }
  const disconnected = agent.connection !== "ready"
  const activeModel = findModel(agent.models, agent.model)

  useEffect(() => {
    if (disconnected) return
    if (page === "mcp") onRefreshMcp()
    if (["configuration", "hooks"].includes(page)) onRefreshSettings()
  }, [page, disconnected, onRefreshMcp, onRefreshSettings])

  useEffect(() => {
    if (!searchTarget) {
      const main = dialogRef.current?.querySelector("main")
      if (main) main.scrollTop = 0
      return
    }
    const row = [...(dialogRef.current?.querySelectorAll<HTMLElement>("[data-settings-label]") ?? [])]
      .find((element) => element.dataset.settingsLabel === searchTarget.label && element.getClientRects().length > 0)
    row?.scrollIntoView({ block: "center" })
    if (settings.appearance.motion !== 'reduced') row?.animate([{ backgroundColor: "var(--settings-fill-active)" }, { backgroundColor: "transparent" }], { duration: 1200 })
  }, [page, searchTarget, settings.appearance.motion])
  const current = SETTINGS_PAGES.find((p) => p.key === page)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    backRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || authOpen || e.isComposing || e.keyCode === 229) return
      if (document.querySelector('[data-confirm-dialog], [data-config-server], .noa-context-menu-root')) return
      if (query) {
        e.preventDefault()
        setQuery("")
        return
      }
      void requestClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [authOpen, query, onClose, configurationDirty, providersDirty, mcpDirty, confirmClose])

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
            type="button"
            onClick={() => void requestClose()}
            aria-label="Back to app"
            title="Back to app (Esc)"
            style={noDragRegion}
            className="flex size-7 items-center justify-center rounded-md text-[var(--sidebar-text-muted)] transition-colors hover:bg-[var(--settings-fill-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/35"
          >
            <ArrowLeft size={16} />
          </button>
        </div>
        {/* Settings nav: 16px semibold title, a rounded-lg search, sentence-case group label, 30px rows. */}
        <h2 className="mt-[15px] px-2 text-[16px] leading-6 font-medium">Settings</h2>
        <label className="mt-[13px] flex h-[30px] items-center gap-2 rounded-lg bg-[var(--settings-fill-hover)] px-2 text-[var(--sidebar-text-muted)] focus-within:ring-2 focus-within:ring-[var(--accent-color)]/30">
          <Search size={16} className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (!searchResults.length) {
                if (e.key === "Escape" && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuery("")
                }
                return
              }
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActiveSearchIndex((index) => (index + 1) % searchResults.length)
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActiveSearchIndex((index) => (index - 1 + searchResults.length) % searchResults.length)
              } else if (e.key === "Enter") {
                e.preventDefault()
                const selected = searchResults[activeSearchIndex] ?? searchResults[0]
                if (selected) selectSearchResult(selected)
              } else if (e.key === "Escape" && query) {
                e.preventDefault()
                e.stopPropagation()
                setQuery("")
              }
            }}
            placeholder="Search"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="flex size-5 shrink-0 items-center justify-center rounded text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={13} />
            </button>
          )}
        </label>
        <div className="scrollbar-on-scroll noa-scroll-fade [--edge-fade-distance:24px] mt-2 min-h-0 flex-1 overflow-y-auto">
          {query.trim() ? (
            <>
              {searchResults.length === 0 && (
                <p role="status" className="px-2 py-2 text-body text-[var(--sidebar-text-muted)]">
                  No results found
                </p>
              )}
              {searchResults.map((result, index) => (
                <button
                  key={`${result.page.key}:${result.label}:${index}`}
                  type="button"
                  onMouseEnter={() => setActiveSearchIndex(index)}
                  className={`mb-px flex w-full flex-col rounded-lg px-2 py-2 text-left transition-colors ${
                    index === activeSearchIndex ? "bg-[var(--settings-fill-hover)]" : "hover:bg-[var(--settings-fill-hover)]"
                  }`}
                  onClick={() => selectSearchResult(result)}
                >
                  <span className="text-body">{result.label}</span>
                  <span className="text-caption text-[var(--sidebar-text-muted)]">{result.page.label}</span>
                </button>
              ))}
            </>
          ) : (
            SETTINGS_PAGES.map((p, index) => {
              const isDirty =
                (p.key === "configuration" && configurationDirty) ||
                (p.key === "providers" && providersDirty) ||
                (p.key === "mcp" && mcpDirty)
              return (
                <div key={p.key}>
                  {SETTINGS_PAGES[index - 1]?.group !== p.group && (
                    <div className={`px-2 pb-1 text-caption font-medium text-[var(--sidebar-text-muted)] ${index > 0 ? "pt-4" : "pt-1"}`}>
                      {p.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPage(p.key)
                      setSearchTarget(undefined)
                    }}
                    aria-current={page === p.key ? "page" : undefined}
                    className={`mb-px flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/35 ${
                      page === p.key
                        ? "bg-[var(--settings-fill-active)] font-medium text-[var(--text-primary)]"
                        : "text-[var(--sidebar-text,var(--text-primary))] hover:bg-[var(--settings-fill-hover)]"
                    }`}
                  >
                    <span className="flex shrink-0">{PAGE_ICONS[p.key]}</span>
                    <span className="truncate">{p.label}</span>
                    {isDirty && (
                      <span
                        aria-label="Unsaved changes"
                        title="Unsaved changes"
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--accent-color)]"
                      />
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

      </nav>

      {navResizeHandle}
      {/* The content card has no titlebar of its own, so this strip keeps the top of the window draggable. */}
      <div aria-hidden className="absolute inset-x-0 top-0 z-10 h-11" style={{ ...dragRegion, left: navWidth }} />
      <div className="noa-settings-main flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-primary,#FCFCFB)]">
        <main className="noa-settings-scroll scrollbar-on-scroll noa-scroll-fade min-h-0 flex-1 overflow-y-auto px-5 pt-16 pb-16">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-[26px] leading-8 font-normal">{current?.label}</h1>
            {(page === "configuration" || page === "hooks" || page === "mcp") && (
              <button
                type="button"
                disabled={disconnected || agent.mcpPending}
                className={actionButton}
                onClick={page === "mcp" ? onRefreshMcp : onRefreshSettings}
              >
                <RefreshCcw size={14} />
                Refresh
              </button>
            )}
          </div>

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
              onChange={onChange}
            />
          )}
          {(page === "configuration" || page === "hooks" || page === "mcp") && (
            <RefreshBar agent={agent} />
          )}
          <div style={{ display: page === "configuration" ? "contents" : "none" }}><ConfigurationPage agent={agent} onModel={onModel} onEffort={onEffort} onOutputStyle={onOutputStyle} onMode={onMode} /><ConfigurationEditor kind="permissions" disabled={disconnected || agent.busy} request={request} onSaved={() => onRefreshSettings()} onDirtyChange={setConfigurationDirty} /></div>
          <div style={{ display: page === "providers" ? "contents" : "none" }}>
            <ProvidersPage
              providers={agent.providers}
              busy={agent.busy}
              pending={agent.providerPending}
              error={agent.providerError}
              onUse={onProvider}
              onSave={onSaveProvider}
              onDelete={onDeleteProvider}
              onFetchModels={onFetchProviderModels}
              onDirtyChange={setProvidersDirty}
            />
          </div>
          <div style={{ display: page === "mcp" ? "contents" : "none" }}><McpPage agent={agent} onChangeMcp={onChangeMcp} /><ConfigurationEditor kind="mcp" disabled={disconnected || agent.busy || !!agent.queue.length || agent.tasks.some(task => task.status === "running")} request={request} onDirtyChange={setMcpDirty} onSaved={restart => restart ? onReconnect() : onRefreshMcp()} /></div>
          {page === "hooks" && <HooksPage agent={agent} />}
          {page === "shortcuts" && <ShortcutsPage settings={settings} onChange={onChange} />}
        </div>
        </main>
      </div>
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
          onSubmitCode={onSubmitAuthenticationCode}
        />
      )}
    </div>,
    document.body,
  )
}
