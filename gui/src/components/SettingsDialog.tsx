import { Children, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { AppSettings } from "../types"
import type { AgentState } from "../agent/reducer"
import type { AccountInfo } from "../agent/protocol"
import { ArrowLeft, ChevronDown, Keyboard, Palette, Search, Settings } from "../lib/icons"
import { SYSTEM_DEFAULT_FONT, UI_FONT_STYLES } from "../lib/fontFamily"
import { useConfirm } from "./ConfirmDialog"
import { AuthDialog } from "./AuthDialog"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

type Page = "general" | "appearance" | "shortcuts"
type Theme = AppSettings["appearance"]["theme"]
type DefaultMode = AppSettings["agent"]["defaultPermissionMode"]

const pages: { key: Page; label: string; icon: ReactNode }[] = [
  { key: "general", label: "General", icon: <Settings size={16} /> },
  { key: "appearance", label: "Appearance", icon: <Palette size={16} /> },
  { key: "shortcuts", label: "Keyboard shortcuts", icon: <Keyboard size={16} /> },
]

const permissionOptions: [DefaultMode, string][] = [
  ["default", "Ask before acting"],
  ["acceptEdits", "Edit automatically"],
  ["plan", "Plan mode"],
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
  const dialogRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const appearance = settings.appearance
  const permissionMode = settings.agent.defaultPermissionMode
  const showFullAccess = settings.agent.showFullAccess
  const providerLabel = account?.apiProvider ? providerDisplayName(account.apiProvider) : undefined
  const { confirm, dialog } = useConfirm()
  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const setPermission = (defaultPermissionMode: DefaultMode) =>
    onChange({ ...settings, agent: { ...settings.agent, defaultPermissionMode } })
  const setFullAccess = async (on: boolean) => {
    if (!on) {
      onChange({ ...settings, agent: { ...settings.agent, showFullAccess: false } })
      return
    }
    if (await confirm({
      title: "Make Full access available?",
      description: "When selected, Noa can access the internet and read and edit files without asking for approval, including potentially destructive commands. Turning this on only shows Full access in the composer; it does not switch this task.",
      confirmLabel: "Confirm",
      danger: true,
    })) onChange({ ...settings, agent: { ...settings.agent, showFullAccess: true } })
  }
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const visiblePages = pages.filter((p) => p.label.toLowerCase().includes(query.trim().toLowerCase()))
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
        <h2 className="mt-[15px] px-2 text-[16px] leading-6 font-semibold">Settings</h2>
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
        <div className="mt-2 mb-2 flex h-[30px] items-center px-2 text-[var(--sidebar-text-muted)]">Personal</div>
        {visiblePages.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            aria-pressed={page === p.key}
            className={`mb-px flex h-[30px] items-center gap-2.5 rounded-lg px-2 ${
              page === p.key ? "bg-[var(--settings-fill-hover)]" : "hover:bg-[var(--settings-fill-hover)]"
            }`}
          >
            <span className="flex">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </nav>

      {navResizeHandle}
      <div aria-hidden="true" className="w-[0.5px] shrink-0 bg-[var(--divider-subtle,#E6E2DA)]" />
      <main className="min-w-0 flex-1 overflow-y-auto px-5 pt-[120px] pb-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-10">
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
                description="By default, Noa can read and edit files in its workspace. It asks before running commands or making other changes."
              >
                <Select
                  value={permissionMode}
                  options={permissionOptions}
                  onChange={(value) => setPermission(value as DefaultMode)}
                />
              </Row>
              <Row
                label="Full access"
                description="Show Full access in the composer permissions menu. It is never selected by default."
              >
                <Toggle checked={showFullAccess} onChange={(on) => void setFullAccess(on)} />
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
              </Section>
            </>
          )}

          {page === "shortcuts" && (
            <Section title="Shortcuts">
              {shortcuts.map(([label, keys]) => (
                <Row key={label} label={label}>
                  <span className="flex shrink-0 gap-1">
                    {keys.map((key) => (
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
      {dialog}
    </div>,
    document.body,
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const rows = Children.toArray(children)
  return (
    // A settings group: a 40px header row above an outlined 16px-radius card whose dividers inset 16px.
    <section className="flex flex-col">
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
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[12px] leading-[18px] font-medium">{label}</span>
        {description && <span className="text-[11px] leading-4 text-[var(--sidebar-text-muted)]">{description}</span>}
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
        className="h-8 appearance-none rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-card)] pr-8 pl-3 text-body text-[var(--text-primary)] outline-none disabled:opacity-50"
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
