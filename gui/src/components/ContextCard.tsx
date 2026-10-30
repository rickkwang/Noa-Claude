import { useState } from "react"
import { parseContextOutput, type ContextOutput } from "../lib/contextOutput"
import { ChevronDown } from "../lib/icons"

const PALETTE = ["#748FFC", "#DA77F2", "#51CF66", "#FCC419", "#FF922B", "#66D9E8", "#F783AC"]

function size(label: string): number {
  const value = parseFloat(label)
  return /m$/i.test(label) ? value * 1_000_000 : /k$/i.test(label) ? value * 1000 : value
}

export function ContextCard({ data }: { data: ContextOutput }) {
  const [open, setOpen] = useState(true)
  const max = size(data.maxLabel) || 1
  const segments = data.categories.filter((category) => category.kind !== "deferred")
  const colorOf = (category: ContextOutput["categories"][number], index: number) =>
    category.kind !== "used" ? "color-mix(in srgb, var(--text-primary, #2d2d2b) 22%, transparent)" : category.color ?? PALETTE[index % PALETTE.length]!
  return (
    <section data-context-card className="not-prose w-full max-w-[560px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3.5 text-[length:var(--text-chat-sm)]">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-3 text-left text-[var(--text-primary)]">
        <span className="font-medium">Context window{data.model ? <span className="ms-2 font-normal text-[var(--sidebar-text-muted)]">{data.model}</span> : null}</span>
        <span className="flex items-center gap-1.5 text-[var(--sidebar-text-muted)]">
          {data.usedLabel} / {data.maxLabel} ({Math.round(data.percent)}%)
          <ChevronDown size={14} className={open ? "rotate-180" : undefined} aria-hidden="true" />
        </span>
      </button>
      <div className="mt-3 flex h-2 gap-[2px]" role="meter" aria-label="Context usage" aria-valuenow={Math.round(data.percent)} aria-valuemin={0} aria-valuemax={100}>
        {segments.map((category, index) => <span key={category.name} className="h-full rounded-[2px] first:rounded-s-[4px] last:rounded-e-[4px]" style={{ flex: `${size(category.tokens)} 1 0`, minWidth: 4, background: colorOf(category, index) }} title={`${category.name}: ${category.tokens}`} />)}
      </div>
      {open && (
        <>
          <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
            {data.categories.map((category, index) => (
              <li key={category.name} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(category, index) }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{category.name}</span>
                <span className="tabular-nums text-[var(--sidebar-text-muted)]">{category.tokens}</span>
                <span className="w-12 text-end tabular-nums text-[var(--text-primary)]">{category.kind === "deferred" ? "—" : `${category.percent}%`}</span>
              </li>
            ))}
          </ul>
          {data.sections.length > 0 && (
            <ul className="m-0 mt-3 flex list-none flex-col gap-1 border-t border-[var(--divider-subtle)] p-0 pt-2.5 text-[var(--sidebar-text-muted)]">
              {data.sections.map((section) => <li key={section.name} className="flex justify-between gap-3"><span>{section.name}</span><span className="tabular-nums">{section.detail}</span></li>)}
            </ul>
          )}
          {data.suggestions.length > 0 && (
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 border-t border-[var(--divider-subtle)] p-0 pt-2.5">
              {data.suggestions.map((suggestion) => (
                <li key={suggestion.title} className="flex flex-col gap-0.5">
                  <span className="text-[var(--text-primary)]">{suggestion.title}</span>
                  {suggestion.detail && <span className="text-[var(--sidebar-text-muted)]">{suggestion.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export function contextCardFor(text: string) {
  const data = parseContextOutput(text)
  return data ? <ContextCard data={data} /> : null
}
