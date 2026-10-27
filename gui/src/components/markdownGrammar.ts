import { Lexer, Marked, type Token } from "marked"

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(/([\w-]+)=("(?:\\.|[^"\\])*"|[^\s}]+)/g)) {
    try { result[match[1]!] = match[2]!.startsWith('"') ? JSON.parse(match[2]!) : match[2]! } catch { /* Incomplete streaming attribute. */ }
  }
  return result
}

function displayMath(source: string) {
  const first = source.split("\n", 1)[0]!
  const open = /^ {0,3}(\\\[|\${2,})(.*)$/.exec(first)
  if (!open || open[2]!.includes(open[1] === "\\[" ? "]" : "$")) return
  const close = open[1] === "\\[" ? "\\]" : open[1]!
  let end = source.length, rawEnd = source.length, closed = false
  for (const line of source.matchAll(/\n([^\n]*)/g)) {
    const delimiter = /^ {0,3}(\\\]|\${2,})[ \t]*$/.exec(line[1]!)?.[1]
    if (delimiter && (close === "\\]" ? delimiter === close : delimiter.startsWith("$") && delimiter.length >= close.length)) {
      end = line.index!; rawEnd = end + line[0].length; closed = true; break
    }
  }
  const indent = first.length - first.trimStart().length
  const body = source.slice(first.length + 1, end)
  return { type: "mathBlock", raw: source.slice(0, rawEnd), text: indent ? body.replace(new RegExp(`^ {0,${indent}}`, "gm"), "") : body, closed }
}

function displayStart(source: string): number | undefined {
  for (const line of source.matchAll(/^ {0,3}(\\\[|\${2,})(.*)$/gm)) {
    if (!line[2]!.includes(line[1] === "\\[" ? "]" : "$")) return line.index
  }
}

function detailsBlock(source: string) {
  const open = /^ {0,3}<details(?:\s+open(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)?\s*>/i.exec(source)
  if (!open) return
  const summary = /^\s*<summary>([\s\S]*?)<\/summary>/i.exec(source.slice(open[0].length))
  if (!summary) return
  const bodyStart = open[0].length + summary[0].length
  let depth = 1, fence: string | undefined, offset = bodyStart, end = source.length, rawEnd = source.length
  for (const line of source.slice(bodyStart).split(/(?<=\n)/)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?(?:\n)?$/.exec(line)?.[1]
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined
    }
    else if (delimiter) fence = delimiter
    else if (!/^(?: {4}|\t)/.test(line)) {
      const safeLine = line.replace(/(`+)[\s\S]*?\1/g, match => " ".repeat(match.length))
      for (const tag of safeLine.matchAll(/<\/?details\b[^>]*>/gi)) {
        depth += /^<\//.test(tag[0]) ? -1 : 1
        if (depth === 0) { end = offset + tag.index!; rawEnd = end + tag[0].length; break }
      }
    }
    if (depth === 0) break
    offset += line.length
  }
  return { type: "detailsBlock", raw: source.slice(0, rawEnd), text: source.slice(bodyStart, end).trim(), summary: summary[1]!, open: /\sopen\b/i.test(open[0]) }
}

const markdown = new Marked({ gfm: true, breaks: true, tokenizer: {
  lheading(source) {
    const candidate = this.rules.block.lheading.exec(source)
    if (!candidate || displayStart(candidate[0]) !== undefined) return
    return false
  },
}, extensions: [
  {
    name: "mathBlock", level: "block",
    start: displayStart,
    tokenizer(source) { return displayMath(source) },
  },
  {
    name: "mathInline", level: "inline",
    start: source => source.search(/\\(?:\(|\[)|\${2,}/),
    tokenizer(source, tokens) {
      const previous = tokens.at(-1)
      if (source.startsWith("$") && previous?.raw.endsWith("$") && previous.type !== "escape") return
      const open = /^(?:\\\(|\\\[|\${2,})/.exec(source)?.[0]
      if (!open) return
      const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open
      const end = open.startsWith("$") ? [...source.matchAll(/\$+/g)].find(match => match.index! > 0 && match[0].length === open.length)?.index : source.indexOf(close, open.length)
      if (end !== undefined && end >= 0) return { type: "mathInline", raw: source.slice(0, end + close.length), text: source.slice(open.length, end).trim() }
    },
  },
  {
    name: "detailsBlock", level: "block", start: source => source.search(/(?:^|\n) {0,3}<details\b/i),
    tokenizer(source) { return detailsBlock(source) },
  },
  {
    name: "reviewComment", level: "block",
    start: source => source.indexOf("::code-comment{"),
    tokenizer(source) {
      const match = /^::code-comment\{((?:"(?:\\.|[^"\\])*"|[^"}\n])*)\}[ \t]*(?:\n|$)/.exec(source)
      if (match) return { type: "reviewComment", raw: match[0], attributes: attributes(match[1]!) }
    },
  },
  {
    name: "fileCitation", level: "inline",
    start: source => source.indexOf(":codex-file-citation{"),
    tokenizer(source) {
      const match = /^:codex-file-citation\{((?:"(?:\\.|[^"\\])*"|[^"}\n])*)\}/.exec(source)
      if (match) return { type: "fileCitation", raw: match[0], attributes: attributes(match[1]!) }
    },
  },
] })

export const parseBlocks = (text: string) => markdown.lexer(text)
export const parseInline = (text: string) => Lexer.lexInline(text, markdown.defaults)

export interface MarkdownPrefix { text: string; tokens: Token[] }

// Retain the final two tokens: a paragraph can still become a table or setext heading.
// Reference-style links can be defined later, so those messages always use the full lexer.
export function parseStreaming(text: string, cache: MarkdownPrefix): Token[] {
  if (/^(?: {0,3}(?:[-+*]|\d+[.)])\s| {0,3}>| {4}|\t)/m.test(text) || /<details\b/i.test(text) || text.includes("\r") || text.includes("$$") || text.includes("\\[") || /\[[^\]\n]+\](?!\()/.test(text)) return parseBlocks(text)
  if (!text.startsWith(cache.text)) { cache.text = ""; cache.tokens = [] }
  const tail = text.slice(cache.text.length)
  const tokens = parseBlocks(tail)
  const combined = [...cache.tokens, ...tokens]
  if (tokens.length > 2) {
    const stable = tokens.slice(0, -2)
    const raw = stable.map(token => token.raw).join("")
    if (tail.startsWith(raw)) { cache.text += raw; cache.tokens.push(...stable) }
  }
  return combined
}
