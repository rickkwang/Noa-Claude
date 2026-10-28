import { useRef, useState } from "react"
import type { ContextUsage } from "../agent/protocol"
import { ChevronRight } from "../lib/icons"

type Category = NonNullable<ContextUsage["categories"]>[number]

// Claude's chart tokens: categorical 1-5 for the largest used categories, the rest one reference series,
// muted for the buffer and deferred rows, reference-tint (15% alpha) for free space and the track.
const HUES = ["#257de0", "#f47230", "#00b894", "#f2a600", "#ee7fac"]
const OTHER = "#878787"
const BUFFER = "#c2c2c2"
const FREE = "rgb(135 135 135 / 15%)"
// Legend rows beyond this many series (used + buffer) share the neutral series.
const MAX_SERIES = 6

const compact = (n: number) => n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}m` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n)
const isFree = (c: Category) => c.kind === "free" || c.name === "Free space"
const isBuffer = (c: Category) => c.kind === "buffer" || c.name === "Autocompact buffer" || c.name === "Compact buffer"
const isDeferred = (c: Category) => c.isDeferred || c.kind === "deferred" || /\(deferred\)$/i.test(c.name)

type SectionKey = "mcp" | "memory" | "agents"
interface Section { key: SectionKey; label: string; rows: { id: string; name: string; tokens: number; title?: string; onPress?: () => void }[] }

// Which legend rows are actionable (dotted underline + hint), as the host's action table does:
// Memory files and Custom agents reveal their list below. Noa has no connector or skill manager to
// open, so those rows stay plain.
function actionFor(name: string, reveal: (key: SectionKey) => void): { hint: string; onPress: () => void } | undefined {
  if (name === "Memory files") return { hint: "View memory files", onPress: () => reveal("memory") }
  if (name === "Custom agents") return { hint: "View custom agents", onPress: () => reveal("agents") }
}

const ROW = "flex h-6 w-full min-w-0 items-center gap-3 px-1.5 text-start text-body"

function SectionList({ section, open, onToggle }: { section: Section; open: boolean; onToggle: () => void }) {
  return <div>
    <button type="button" aria-expanded={open} onClick={onToggle} className={`${ROW} rounded-lg hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]`}>
      <span className="flex w-3 shrink-0 items-center justify-center"><ChevronRight size={12} className={`text-[var(--sidebar-text-muted)] transition-transform duration-[60ms] ease-out ${open ? "rotate-90" : ""}`} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 truncate text-[var(--sidebar-text-muted)]">{section.label}</span>
      <span className="w-11 shrink-0 text-end text-[var(--sidebar-text-muted)]">{section.rows.length.toLocaleString()}</span>
    </button>
    {open && <div className={`flex flex-col ${section.rows.length > 12 ? "max-h-60 overflow-y-auto overscroll-contain" : ""}`}>
      {section.rows.map((row) => {
        const Tag = row.onPress ? "button" : "div"
        return <Tag key={row.id} type={row.onPress ? "button" : undefined} title={row.title} onClick={row.onPress} className={`${ROW} text-[var(--sidebar-text-muted)] ${row.onPress ? "hover:text-[var(--text-primary)]" : ""}`}>
          <span className="w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="shrink-0">{compact(row.tokens)}</span>
          <span className="w-11 shrink-0" aria-hidden="true" />
        </Tag>
      })}
    </div>}
  </div>
}

// Context breakdown card: used categories largest first, then buffer and free space, deferred rows
// apart, and detail lists (MCP tools, memory files, custom agents) that the legend rows can reveal.
export function ContextUsageCard({ usage, home, onReference }: { usage: ContextUsage; home?: string; onReference: (path: string) => void }) {
  const [opened, setOpened] = useState<Set<SectionKey>>(new Set())
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLDivElement | null>>>({})
  const max = usage.rawMaxTokens || usage.maxTokens || 1
  const all = (usage.categories ?? []).filter((c) => c.tokens > 0)
  const used = all.filter((c) => !isFree(c) && !isBuffer(c) && !isDeferred(c)).sort((a, b) => b.tokens - a.tokens)
  const deferred = all.filter(isDeferred).sort((a, b) => b.tokens - a.tokens)
  const buffer = all.find(isBuffer)
  const free = all.find(isFree)
  const overflow = used.length + (buffer ? 1 : 0) > MAX_SERIES
  const shown = overflow ? MAX_SERIES - 1 - (buffer ? 1 : 0) : used.length
  const colorOf = (c: Category) => isFree(c) ? FREE : isBuffer(c) || isDeferred(c) ? BUFFER : used.indexOf(c) < shown ? HUES[used.indexOf(c)] ?? OTHER : OTHER
  const usedTokens = free ? used.reduce((sum, c) => sum + c.tokens, 0) : usage.totalTokens
  const barTotal = Math.max(max, [...used, ...(buffer ? [buffer] : []), ...(free ? [free] : [])].reduce((sum, c) => sum + c.tokens, 0)) || 1
  // The bar draws only used series and the buffer; free space is the track.
  const segments = [
    ...used.slice(0, shown).map((c) => ({ key: c.name, tokens: c.tokens, color: colorOf(c), label: c.name })),
    ...(overflow ? [{ key: "other", tokens: used.slice(shown).reduce((sum, c) => sum + c.tokens, 0), color: OTHER, label: "Other" }] : []),
    ...(buffer ? [{ key: buffer.name, tokens: buffer.tokens, color: BUFFER, label: buffer.name }] : []),
  ]
  const pretty = (path: string) => home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
  const sections: Section[] = [
    ...(usage.mcpTools?.length ? [{ key: "mcp" as const, label: "MCP tools", rows: usage.mcpTools.map((t) => ({ id: `${t.serverName}:${t.name}`, name: `${t.serverName} · ${t.name.replace(/^mcp__.+?__/, "")}`, tokens: t.tokens })) }] : []),
    ...(usage.memoryFiles?.length ? [{ key: "memory" as const, label: "Memory files", rows: usage.memoryFiles.map((f) => ({ id: f.path, name: pretty(f.path), tokens: f.tokens, title: `${f.path}\nAdd to chat`, onPress: () => onReference(f.path) })) }] : []),
    ...(usage.agents?.length ? [{ key: "agents" as const, label: "Custom agents", rows: usage.agents.map((a) => ({ id: `${a.source}:${a.agentType}`, name: a.agentType, tokens: a.tokens })) }] : []),
  ]
  const reveal = (key: SectionKey) => {
    setOpened((previous) => new Set(previous).add(key))
    requestAnimationFrame(() => sectionRefs.current[key]?.scrollIntoView({ block: "nearest" }))
  }
  const row = (c: Category) => {
    const action = actionFor(c.name, reveal)
    const deferredRow = isDeferred(c)
    const muted = "text-[var(--sidebar-text-muted)]"
    const body = <>
      <span className="flex w-3 shrink-0 items-center"><span className="size-2.5 rounded-[2px]" style={{ background: colorOf(c) }} aria-hidden="true" /></span>
      <span className={`min-w-0 flex-1 truncate ${muted} ${action ? "underline decoration-dotted underline-offset-2 group-hover:decoration-solid" : ""}`}>{c.name}</span>
      <span className={`shrink-0 ${muted}`}>{compact(c.tokens)}</span>
      <span className={`w-11 shrink-0 text-end ${deferredRow ? muted : "text-[var(--text-primary)]"}`}>{deferredRow ? "—" : `${(c.tokens / max * 100).toFixed(1)}%`}</span>
    </>
    const cls = `group ${ROW}`
    return action
      ? <button key={c.name} type="button" title={action.hint} onClick={action.onPress} className={cls}>{body}</button>
      : <div key={c.name} className={cls}>{body}</div>
  }
  return <div data-context-usage className="flex flex-col">
    <div className="flex h-5 items-center px-1.5 pt-1 pb-1.5 box-content text-sm leading-5 text-[var(--text-primary)]">{compact(usedTokens)}</div>
    <div className="mx-1.5 mt-1 flex h-1 gap-px overflow-hidden rounded-full" style={{ background: FREE }} role="meter" aria-label="Context usage" aria-valuenow={Math.round(usedTokens / max * 100)} aria-valuemin={0} aria-valuemax={100}>
      {segments.map((s, i) => <span key={s.key} className="h-full" style={{ width: `${s.tokens / barTotal * 100}%`, background: s.color, borderRadius: `${i === 0 ? 2 : 1}px ${i === segments.length - 1 ? 2 : 1}px ${i === segments.length - 1 ? 2 : 1}px ${i === 0 ? 2 : 1}px` }} title={`${s.label}: ${s.tokens.toLocaleString()} tokens`} />)}
    </div>
    <div className="mt-1.5 flex flex-col gap-1.5 pb-1.5">
      <div className="flex flex-col">{[...used, ...(buffer ? [buffer] : []), ...(free ? [free] : [])].map(row)}</div>
      {deferred.length > 0 && <div className="flex flex-col">{deferred.map(row)}</div>}
      {sections.length > 0 && <div className="flex flex-col">
        {sections.map((s) => <div key={s.key} ref={(node) => { sectionRefs.current[s.key] = node }}>
          <SectionList section={s} open={opened.has(s.key)} onToggle={() => setOpened((previous) => { const next = new Set(previous); if (!next.delete(s.key)) next.add(s.key); return next })} />
        </div>)}
      </div>}
    </div>
  </div>
}
