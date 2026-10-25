import { useEffect, useMemo, useRef, useState } from "react"
import hljs from "highlight.js/lib/common"
import { parsePatch, diffWordsWithSpace } from "diff"

const languages: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", py: "python", sh: "bash", zsh: "bash", json: "json", css: "css", html: "xml", svg: "xml", xml: "xml", md: "markdown", yml: "yaml", yaml: "yaml", rs: "rust", go: "go", java: "java", c: "c", h: "c", cpp: "cpp", sql: "sql", swift: "swift" }

// Keep multiline token spans balanced when each source line becomes its own grid row.
function highlightedLines(content: string, path: string): string[] {
  const language = languages[path.split(".").pop()?.toLowerCase() ?? ""]
  const html = language && hljs.getLanguage(language)
    ? hljs.highlight(content, { language, ignoreIllegals: true }).value
    : content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const stack: string[] = [], lines = [""]
  for (const token of html.split(/(<\/?span[^>]*>|\n)/)) {
    if (token === "\n") { lines[lines.length - 1] += "</span>".repeat(stack.length); lines.push(stack.join("")) }
    else if (token.startsWith("<span")) { stack.push(token); lines[lines.length - 1] += token }
    else if (token === "</span>") { stack.pop(); lines[lines.length - 1] += token }
    else lines[lines.length - 1] += token
  }
  return lines
}

type Line = { kind: "context" | "add" | "remove" | "meta"; text: string; old?: number; next?: number; html: string }

function emphasis(html: string, ranges: [number, number][]) {
  if (!ranges.length) return html
  const container = document.createElement("span")
  container.innerHTML = html
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  let offset = 0
  for (const node of nodes) {
    const text = node.data, fragment = document.createDocumentFragment()
    const cuts = [0, text.length, ...ranges.flatMap(([a, b]) => [Math.max(0, Math.min(text.length, a - offset)), Math.max(0, Math.min(text.length, b - offset))])].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1]!, b = cuts[i]!
      if (a === b) continue
      const part = document.createTextNode(text.slice(a, b))
      if (ranges.some(([start, end]) => a + offset >= start && a + offset < end)) {
        const mark = document.createElement("mark"); mark.append(part); fragment.append(mark)
      } else fragment.append(part)
    }
    offset += text.length
    node.replaceWith(fragment)
  }
  return container.innerHTML
}

function wordChanges(before: Line, after: Line) {
  if (before.text.length + after.text.length > 10000) return
  let old = 0, next = 0
  const removed: [number, number][] = [], added: [number, number][] = []
  for (const part of diffWordsWithSpace(before.text, after.text)) {
    if (part.removed) { removed.push([old, old + part.value.length]); old += part.value.length }
    else if (part.added) { added.push([next, next + part.value.length]); next += part.value.length }
    else { old += part.value.length; next += part.value.length }
  }
  before.html = emphasis(before.html, removed)
  after.html = emphasis(after.html, added)
}

export default function CodeView({ path, content, diff = false, split = false, wrap = false, hunkScope, onHunkAction, findRequest = 0, onCloseFind, focusLine, focusRequest }: {
  path: string; content: string; diff?: boolean; split?: boolean; wrap?: boolean
  focusLine?: number; focusRequest?: number; findRequest?: number; onCloseFind?: () => void
  hunkScope?: string; onHunkAction?: (action: string, hunk: number) => void
}) {
  const hunks = useMemo(() => {
    if (!diff) return []
    try {
      let remaining = 3000
      return parsePatch(content).flatMap((file) => file.hunks.flatMap((hunk) => {
        if (remaining <= 0) return []
        const displayed = hunk.lines.slice(0, remaining)
        remaining -= displayed.length
        let old = hunk.oldStart, next = hunk.newStart
        const before = highlightedLines(displayed.filter((l) => l[0] === " " || l[0] === "-").map((l) => l.slice(1)).join("\n"), path)
        const after = highlightedLines(displayed.filter((l) => l[0] === " " || l[0] === "+").map((l) => l.slice(1)).join("\n"), path)
        let a = 0, b = 0
        const lines: Line[] = displayed.map((line) => {
          const text = line.slice(1)
          if (line[0] === "-") return { kind: "remove", text, old: old++, html: before[a++] ?? "" }
          if (line[0] === "+") return { kind: "add", text, next: next++, html: after[b++] ?? "" }
          if (line[0] === " ") { a++; return { kind: "context", text, old: old++, next: next++, html: after[b++] ?? "" } }
          return { kind: "meta", text, html: text }
        })
        const pairs: [Line | undefined, Line | undefined][] = []
        for (let i = 0; i < lines.length;) {
          const line = lines[i]!
          if (line.kind === "context" || line.kind === "meta") { pairs.push([line, line]); i++; continue }
          const removed: Line[] = [], added: Line[] = []
          while (lines[i]?.kind === "remove") removed.push(lines[i++]!)
          while (lines[i]?.kind === "add") added.push(lines[i++]!)
          for (let j = 0; j < Math.max(removed.length, added.length); j++) {
            if (removed[j] && added[j]) wordChanges(removed[j]!, added[j]!)
            pairs.push([removed[j], added[j]])
          }
        }
        return { label: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, lines, pairs }
      }))
    } catch { return [] }
  }, [content, path, diff])
  const source = useMemo(() => diff ? [] : highlightedLines(content.split("\n").slice(0, 3000).join("\n"), path), [content, path, diff])
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusLine || diff) return
    const row = root.current?.querySelectorAll<HTMLElement>(".noa-source-line")[focusLine - 1]
    row?.scrollIntoView({ block: "center" })
  }, [focusLine, focusRequest, source, diff])
  const input = useRef<HTMLInputElement>(null)
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState("")
  const [match, setMatch] = useState(0)
  const [matches, setMatches] = useState(0)
  const closeFind = () => { setFinding(false); setQuery(""); onCloseFind?.() }
  useEffect(() => { if (findRequest) setFinding(true) }, [findRequest])
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && root.current?.offsetParent) {
        event.preventDefault(); setFinding(true)
      }
    }
    document.addEventListener("keydown", find)
    return () => document.removeEventListener("keydown", find)
  }, [])
  useEffect(() => { if (finding) input.current?.focus() }, [finding])
  useEffect(() => {
    const rows = [...(root.current?.querySelectorAll<HTMLElement>(".noa-code-line, .noa-source-line") ?? [])]
    const found = rows.filter((row) => query && row.querySelector("code")?.textContent?.toLowerCase().includes(query.toLowerCase()))
    for (const row of rows) { row.removeAttribute("data-search-match"); row.removeAttribute("data-search-current") }
    for (const row of found) row.setAttribute("data-search-match", "true")
    const current = found[(match % (found.length || 1) + found.length) % (found.length || 1)]
    if (current) { current.setAttribute("data-search-current", "true"); current.scrollIntoView({ block: "nearest", inline: "nearest" }) }
    setMatches(found.length)
  }, [query, match, finding, source, hunks, split, wrap])
  const cell = (line: Line | undefined, side?: "old" | "next") => (
    <div className={`noa-code-line ${line ? `is-${line.kind}` : "is-empty"}`}>
      {!side && <span className="noa-code-number">{line?.old}</span>}
      <span className="noa-code-number">{side === "old" ? line?.old : line?.next}</span>
      <span className="noa-code-sign" aria-hidden="true">{line?.kind === "add" ? "+" : line?.kind === "remove" ? "−" : ""}</span>
      <code dangerouslySetInnerHTML={{ __html: line?.html || " " }} />
    </div>
  )
  return (
    <div ref={root} className={`noa-code-view ${wrap ? "is-wrapped" : ""} ${split && diff ? "is-split" : ""}`} tabIndex={0} aria-label={diff ? "File diff" : "File content"}>
      {finding && <div className="noa-code-search"><input ref={input} aria-label="Find in file" value={query} onChange={(event) => { setQuery(event.target.value); setMatch(0) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setMatch((n) => n + (event.shiftKey ? -1 : 1)) } else if (event.key === "Escape") { closeFind() } }} /><span>{matches ? (match % matches + matches) % matches + 1 : 0}/{matches}</span><button type="button" className="noa-panel-button" aria-label="Previous match" onClick={() => setMatch((n) => n - 1)}>↑</button><button type="button" className="noa-panel-button" aria-label="Next match" onClick={() => setMatch((n) => n + 1)}>↓</button><button type="button" className="noa-panel-button" aria-label="Close find" onClick={closeFind}>×</button></div>}
      {content.split("\n").length > 3000 && <p className="noa-panel-notice">Large file: showing up to 3,000 lines. Open the file in your editor to read the remaining lines.</p>}
      {!diff ? source.map((html, i) => <div className="noa-source-line" data-reference-line={focusLine === i + 1 || undefined} key={i}><span className="noa-code-number">{i + 1}</span><code dangerouslySetInnerHTML={{ __html: html || " " }} /></div>)
        : hunks.length ? hunks.map((hunk, i) => <section key={i} className="noa-diff-hunk"><div className="noa-diff-hunk-header"><span>{hunk.label}</span>{hunkScope && <span className="noa-hunk-actions"><button type="button" className="noa-panel-button" aria-label={`${hunkScope === "staged" ? "Unstage" : "Stage"} hunk ${i + 1}`} onClick={() => onHunkAction?.(hunkScope === "staged" ? "unstage-hunk" : "stage-hunk", i)}>{hunkScope === "staged" ? "Unstage hunk" : "Stage hunk"}</button><button type="button" className="noa-panel-button" aria-label={`Revert hunk ${i + 1}`} onClick={() => onHunkAction?.("revert-hunk", i)}>Revert hunk</button></span>}</div>{split ? hunk.pairs.map(([old, next], j) => <div className="noa-diff-pair" key={j}>{cell(old, "old")}{cell(next, "next")}</div>) : hunk.lines.map((line, j) => <div key={j}>{cell(line)}</div>)}</section>)
        : <p className="noa-panel-empty">{content.includes("Binary") ? "Binary file changed" : content ? "File mode, rename or other metadata change. No text hunks." : "No changes in this view"}</p>}
    </div>
  )
}
