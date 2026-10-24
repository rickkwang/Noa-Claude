import { Children, useEffect, useState, type CSSProperties, type ReactNode } from "react"
import type { AppSettings } from "../types"
import { ArrowLeft, ChevronDown, Keyboard, Palette, Search, Settings } from "../lib/icons"
import { SYSTEM_DEFAULT_FONT, UI_FONT_STYLES } from "../lib/fontFamily"

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
  ["Stop agent", ["Esc"]],
]

export function SettingsDialog({
  settings,
  onChange,
  onClose,
}: {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}) {
  const [page, setPage] = useState<Page>("general")
  const [query, setQuery] = useState("")
  const appearance = settings.appearance
  const permissionMode = settings.agent.defaultPermissionMode
  const fullAccess = permissionMode === "bypassPermissions"
  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const setPermission = (defaultPermissionMode: DefaultMode) =>
    onChange({ ...settings, agent: { ...settings.agent, defaultPermissionMode } })
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const visiblePages = pages.filter((p) => p.label.toLowerCase().includes(query.trim().toLowerCase()))
  const current = pages.find((p) => p.key === page)
  const fontOptions: [string, string][] = [
    [SYSTEM_DEFAULT_FONT, "System default"],
    ...localFonts.map((f) => [f, f] as [string, string]),
  ]
  if (appearance.fontFamily !== SYSTEM_DEFAULT_FONT && !localFonts.includes(appearance.fontFamily))
    fontOptions.push([appearance.fontFamily, appearance.fontFamily])

  useEffect(() => {
    if (page !== "appearance") return
    const query = (window as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
    query?.()
      .then((fonts) => setLocalFonts([...new Set(fonts.map((f) => f.family))].sort()))
      .catch(() => setLocalFonts([]))
  }, [page])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      data-settings-surface="true"
      aria-modal="true"
      aria-label="Settings"
      className="fixed inset-0 z-50 flex bg-[var(--bg-primary,#FCFCFB)] text-body text-[var(--text-primary)]"
    >
      <nav className="flex w-[360px] shrink-0 flex-col bg-[var(--bg-sidebar,#F4F4F2)] px-2 pb-3">
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
            onClick={onClose}
            aria-label="Back to app"
            style={noDragRegion}
            className="flex size-7 items-center justify-center rounded-md text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)]"
          >
            <ArrowLeft size={16} />
          </button>
        </div>
        <h2 className="mb-3 px-2 text-body font-medium">Settings</h2>
        <label className="mb-4 flex h-9 items-center gap-2 rounded-lg bg-[var(--settings-fill-active)] px-2.5 text-[var(--sidebar-text-muted)]">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)]"
          />
        </label>
        <div className="px-2 pb-2 text-caption text-[var(--sidebar-text-muted)]">Personal</div>
        {visiblePages.map((p) => (
          <button
            key={p.key}
            onClick={() => setPage(p.key)}
            aria-pressed={page === p.key}
            className={`flex h-8 items-center gap-2.5 rounded-lg px-2 ${
              page === p.key ? "bg-[var(--settings-fill-hover)]" : "hover:bg-[var(--settings-fill-hover)]"
            }`}
          >
            <span className="text-[var(--sidebar-text-muted)]">{p.icon}</span>
            {p.label}
          </button>
        ))}
      </nav>

      <div aria-hidden="true" className="w-[0.5px] shrink-0 bg-[var(--divider-subtle,#E6E2DA)]" />
      <main className="min-w-0 flex-1 overflow-y-auto pt-12 pb-16">
        <div className="mx-auto flex max-w-3xl flex-col gap-16">
          <h1 className="text-[length:var(--text-title)] font-normal">{current?.label}</h1>

          {page === "general" && (
            <Section title="Permissions">
              <Row
                label="Default permissions"
                description="By default, Noa can read and edit files in its workspace. It asks before running commands or making other changes."
              >
                <Select
                  value={fullAccess ? "default" : permissionMode}
                  disabled={fullAccess}
                  options={permissionOptions}
                  onChange={(value) => setPermission(value as DefaultMode)}
                />
              </Row>
              <Row
                label="Full access"
                description="When Noa runs with full access, it can edit any file on your computer and run commands without your approval. This significantly increases the risk of data loss, leaks, or unexpected behavior."
              >
                <Toggle checked={fullAccess} onChange={(on) => setPermission(on ? "bypassPermissions" : "default")} />
              </Row>
            </Section>
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
                <Row label="Translucent sidebar" description="Let the desktop show through the sidebar.">
                  <Toggle checked={appearance.translucentSidebar} onChange={(translucentSidebar) => change({ translucentSidebar })} />
                </Row>
              </Section>

              <Section title="Fonts">
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
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const rows = Children.toArray(children)
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[length:var(--text-heading-sm)] font-semibold leading-6">{title}</h3>
      <div className="flex flex-col rounded-2xl border border-[var(--divider-subtle)] py-1">
        {rows.map((row, i) => (
          <div key={i}>
            {i > 0 && <div className="mx-3 h-px bg-[var(--divider-subtle)]" />}
            {row}
          </div>
        ))}
      </div>
    </section>
  )
}

function Row({ label, description, children }: { label: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-medium">{label}</span>
        {description && <span className="text-caption leading-[1.4] text-[var(--sidebar-text-muted)]">{description}</span>}
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
