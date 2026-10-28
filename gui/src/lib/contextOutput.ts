// `/context` is rendered by the CLI as an ANSI string (ContextVisualization) and stored as local
// command output. Parse that text back into rows so the transcript can show a card, not escape codes.
export interface ContextOutput {
  model?: string
  usedLabel: string
  maxLabel: string
  percent: number
  categories: { name: string; tokens: string; percent: number; color?: string; kind: "used" | "free" | "buffer" | "deferred" }[]
  sections: { name: string; detail: string }[]
  suggestions: { title: string; detail: string }[]
}

const ANSI = /\x1b\[[0-9;]*m/g
const TRUE_COLOR = /\x1b?\[38;2;(\d+);(\d+);(\d+)m/
const TOTAL = /([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?)\s*tokens\s*\((\d+(?:\.\d+)?)%\)/
const CATEGORY = /([A-Za-z][^:]*?):\s*([\d.]+[kKmM]?)(?:\s*tokens)?\s*\((\d+(?:\.\d+)?)%\)/

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "")
}

// Grid glyphs (⛀ ⛁ ⛶ ⛝ …) share a line with the text that follows them.
const LEADING_GLYPHS = /^[\s\u26C0-\u26FF]+/u

export function parseContextOutput(raw: string): ContextOutput | undefined {
  const lines = raw.split("\n").map((line) => {
    const text = line.replace(ANSI, "").trim()
    return { raw: line, text, clean: text.replace(LEADING_GLYPHS, "") }
  })
  if (lines.find((line) => line.text)?.clean !== "Context Usage") return
  let model: string | undefined
  let total: RegExpMatchArray | null = null
  const categories: ContextOutput["categories"] = []
  const sections: ContextOutput["sections"] = []
  const suggestions: ContextOutput["suggestions"] = []
  let inCategories = false
  let inSuggestions = false
  for (const { raw: line, text, clean } of lines) {
    if (!clean || clean === "Context Usage") continue
    if (!total) {
      total = text.match(TOTAL)
      if (!total && !model && /^[\w./:-]+$/.test(clean)) model = clean
      continue
    }
    if (/^Estimated usage by category/.test(clean)) { inCategories = true; continue }
    if (clean === "Suggestions") { inSuggestions = true; inCategories = false; continue }
    if (inSuggestions) {
      if (/^[\u26A0\u2139\u2757]/u.test(clean)) suggestions.push({ title: clean.replace(/^\S+\s*/u, ""), detail: "" })
      else if (suggestions.length) { const last = suggestions[suggestions.length - 1]!; last.detail = last.detail ? `${last.detail} ${clean}` : clean }
      continue
    }
    const category = inCategories ? clean.match(new RegExp(`^${CATEGORY.source}`)) : null
    if (category) {
      const name = category[1]!.trim()
      const before = line.slice(0, Math.max(0, line.indexOf(name)))
      const color = [...before.matchAll(new RegExp(TRUE_COLOR.source, "g"))].at(-1)
      categories.push({
        name,
        tokens: category[2]!,
        percent: Number(category[3]),
        color: color ? `rgb(${color[1]},${color[2]},${color[3]})` : undefined,
        kind: /\(deferred\)/.test(name) ? "deferred" : name === "Free space" ? "free" : name === "Autocompact buffer" ? "buffer" : "used",
      })
      continue
    }
    const section = clean.match(/^(.+?)\s+·\s+\/\S+$/)
    if (section) { sections.push({ name: section[1]!, detail: "" }); inCategories = false; continue }
    const detail = clean.match(/^└\s*(.+)$/)
    if (detail && sections.length) { const last = sections[sections.length - 1]!; last.detail = last.detail ? `${last.detail} · ${detail[1]}` : detail[1]!; continue }
    if (/^Auto-compact window/.test(clean)) inCategories = false
  }
  if (!total || !categories.length) return
  return { model, usedLabel: total[1]!, maxLabel: total[2]!, percent: Number(total[3]), categories, sections, suggestions }
}
