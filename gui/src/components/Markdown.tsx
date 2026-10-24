import { Fragment, useState, type ReactNode } from "react"

// Small Markdown subset: fenced code, headings, lists, quotes, rules, paragraphs,
// and inline code, bold, italic, links. Text is rendered as React children, so no
// raw HTML is ever injected; links are limited to http(s).

type Block =
  | { type: "code"; lang: string; code: string }
  | { type: "heading"; level: number; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "p"; text: string }
  | { type: "table"; rows: string[][] }

const FENCE = /^```(\S*)\s*$/
const HEADING = /^(#{1,4})\s+(.*)$/
const UL = /^\s*[-*]\s+(.*)$/
const OL = /^\s*\d+\.\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const HR = /^(-{3,}|\*{3,})\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/

function isBlockStart(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || UL.test(line) || OL.test(line) || QUOTE.test(line) || HR.test(line)
}

export function parseBlocks(src: string): Block[] {
  const lines = src.split("\n")
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    if (line.includes("|") && TABLE_DIVIDER.test(lines[i + 1] ?? "")) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
      const rows = [cells(line)]
      i += 2
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(cells(lines[i++]!))
      blocks.push({ type: "table", rows })
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      // An unclosed fence (still streaming) runs to the end of the input.
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!)
      i++
      blocks.push({ type: "code", lang: fence[1] ?? "", code: body.join("\n") })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! })
      i++
      continue
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }

    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line)
      const matcher = ordered ? OL : UL
      const items: string[] = []
      // Items separated by blank lines still belong to one list, so numbering continues.
      for (;;) {
        while (i < lines.length && matcher.test(lines[i]!)) items.push(lines[i++]!.match(matcher)![1]!)
        let next = i
        while (next < lines.length && lines[next]!.trim() === "") next++
        if (next === i || next >= lines.length || !matcher.test(lines[next]!)) break
        i = next
      }
      blocks.push({ type: ordered ? "ol" : "ul", items })
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) quoted.push(lines[i++]!.match(QUOTE)![1]!)
      blocks.push({ type: "quote", text: quoted.join("\n") })
      continue
    }

    if (line.trim() === "") {
      i++
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && lines[i]!.trim() !== "" && !isBlockStart(lines[i]!)) paragraph.push(lines[i++]!)
    blocks.push({ type: "p", text: paragraph.join("\n") })
  }

  return blocks
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g

export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const key = `${at}-${token}`
    if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith("*")) nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    else {
      const close = token.indexOf("](")
      nodes.push(
        <a key={key} href={token.slice(close + 2, -1)} target="_blank" rel="noreferrer">
          {token.slice(1, close)}
        </a>,
      )
    }
    last = at + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-neutral max-w-none text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] text-[var(--text-primary,#2D2D2B)] [&>:first-child]:mt-0 [&_p]:my-0 [&_p]:mb-[3.5px] [&>:not(:first-child)>p]:mt-[7px] [&_p+p]:mt-[14px] [&_li>p]:my-0 [&_li>p+p]:mt-[14px][&_ul]:my-0 [&_ul]:pl-10 [&_ol]:my-0 [&_ol]:pl-10 [&_li]:my-0 [&_li]:pl-[5.25px] [&_ol>li::marker]:font-semibold [&_ol>li::marker]:text-[var(--text-primary,#2D2D2B)][&_:is(h1,h2,h3,h4)]:mt-5 [&_:is(h1,h2,h3,h4)]:mb-3 [&_:is(h1,h2,h3,h4)]:font-bold [&_:is(h1,h2,h3,h4)]:leading-[1.5] [&_h1]:text-[2em] [&_h2]:text-[1.5em] [&_h3]:text-[1.17em] [&_h4]:text-[1em] [&_:is(h1,h2,h3,h4)+p]:mt-0 [&_:is(ul,ol)+:is(h1,h2,h3,h4)]:mt-3.5 [&_code]:font-mono [&_code]:text-[0.875em] [&_code]:font-medium [&_code]:rounded-[4px] [&_code]:bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)] [&_code]:px-[0.3rem] [&_code]:py-px [&_code]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-primary)_8%,transparent)]">
      {parseBlocks(text).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "code":
      return <CodeBlock lang={block.lang} code={block.code} />
    case "table":
      return (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {block.rows[0]?.map((cell, i) => (
                  <th key={i}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "heading": {
      const Tag = `h${Math.min(block.level, 4)}` as "h1"
      return <Tag>{renderInline(block.text)}</Tag>
    }
    case "ul":
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case "ol":
      return (
        <ol>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      )
    case "quote":
      return <blockquote>{renderInline(block.text)}</blockquote>
    case "hr":
      return <hr />
    case "p":
      return (
        <p>
          {block.text.split("\n").map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(line)}
            </Fragment>
          ))}
        </p>
      )
  }
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="not-prose my-3 overflow-hidden rounded-[20px] border border-[var(--divider-subtle)] bg-[var(--bg-card)]">
      <div className="flex h-9 items-center justify-between border-b border-[var(--divider-subtle)] px-4 font-mono text-caption text-[var(--sidebar-text-muted,#898781)]">
        <span>{lang || "text"}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="m-0 overflow-auto p-4 font-mono text-[length:var(--code-font-size)] leading-[1.6] whitespace-pre">{code}</pre>
    </div>
  )
}
