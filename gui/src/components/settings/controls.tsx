import { Children, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown } from "../../lib/icons"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "../PopupMenu"

export const actionButton =
  "h-8 shrink-0 rounded-lg border border-[var(--border-default)] px-3 text-body hover:bg-[var(--settings-fill-hover)] disabled:opacity-40"

export function Section({ title, children }: { title?: string; children: ReactNode }) {
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

export function Row({ label, description, icon, children }: { label: string; description?: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div data-settings-label={label} className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-chat-sm leading-[18px] font-medium">{label}</span>
          {description && <span className="max-w-[52ch] text-caption leading-4 text-pretty text-[var(--sidebar-text-muted)]">{description}</span>}
        </div>
      </div>
      {children}
    </div>
  )
}

export function NumberField({
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
        className="h-8 w-16 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-body tabular-nums text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
      />
      <span className="text-caption text-[var(--sidebar-text-muted)]">px</span>
    </div>
  )
}

// Commits on blur or Enter, so a half-typed value never applies.
export function TextField({ value, placeholder, label, onChange }: { value: string; placeholder?: string; label: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() !== value) onChange(draft.trim()) }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-8 w-48 shrink-0 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
    />
  )
}

export function Slider({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
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

export function Select({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: string
  options: [string, string][]
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<{ anchor: PopupMenuAnchor; minWidth: number }>()
  const selectedLabel = options.find(([v]) => v === value)?.[1] ?? options[0]?.[1] ?? ""

  const toggle = () => {
    if (disabled) return
    if (menu) {
      setMenu(undefined)
      return
    }
    const el = triggerRef.current
    if (!el) return
    setMenu({
      anchor: anchorBelow(el),
      minWidth: Math.max(176, Math.round(el.getBoundingClientRect().width)),
    })
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        disabled={disabled}
        onClick={toggle}
        className="flex h-8 min-w-44 items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] pr-2.5 pl-3 text-left text-body text-[var(--text-primary)] outline-none transition-colors hover:bg-[var(--settings-fill-hover)] disabled:pointer-events-none disabled:opacity-40"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--sidebar-text-muted)]" />
      </button>
      {menu && (
        <PopupMenu
          anchor={menu.anchor}
          trigger={triggerRef.current}
          label={label ?? "Select option"}
          scrollable
          minWidth={menu.minWidth}
          onClose={() => setMenu(undefined)}
          entries={options.map(([v, optionLabel]) => ({
            key: v,
            label: optionLabel,
            checked: v === value,
            onSelect: () => onChange(v),
          }))}
        />
      )}
    </div>
  )
}

export function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
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

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
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
