import { Children, Fragment, cloneElement, isValidElement, useMemo, useState, type AnimationEvent, type ReactNode } from "react"
import hljs from "highlight.js/lib/common"

// Small Markdown subset: fenced code, headings, nested lists, task lists, tables,
// quotes, rules, paragraphs, images, and inline code, bold, italic, strike and links.
// Text is rendered as React children, so no raw HTML is ever injected; links are
// limited to http(s) and images to http(s) or base64 raster data.

type Align = "left" | "center" | "right"

type ListItem = {
  text: string
  checked?: boolean
  ordered: boolean
  number: number
  children: ListItem[]
}

type Block =
  | { type: "code"; lang: string; code: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "p"; text: string }
  | { type: "table"; rows: string[][]; align: (Align | undefined)[] }

const FENCE = /^```(\S*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const HR = /^(-{3,}|\*{3,})\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/

function isBlockStart(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || LIST_ITEM.test(line) || QUOTE.test(line) || HR.test(line)
}

function indentWidth(spaces: string): number {
  let width = 0
  for (const character of spaces) width += character === "\t" ? 4 : 1
  return width
}

function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim())
}

export function parseBlocks(src: string): Block[] {
  const lines = src.split("\n")
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!

    if (line.includes("|") && TABLE_DIVIDER.test(lines[i + 1] ?? "")) {
      const header = tableCells(line)
      const divider = tableCells(lines[i + 1]!)
      const align = divider.map((cell): Align | undefined => {
        const left = cell.startsWith(":")
        const right = cell.endsWith(":")
        return left && right ? "center" : right ? "right" : left ? "left" : undefined
      })
      const rows = [header]
      i += 2
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(tableCells(lines[i++]!))
      blocks.push({ type: "table", rows, align })
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

    if (LIST_ITEM.test(line)) {
      const raw: (Omit<ListItem, "children"> & { indent: number })[] = []
      let rootOrdered: boolean | undefined
      for (;;) {
        const match = lines[i]?.match(LIST_ITEM)
        if (!match) {
          // Items separated by blank lines still belong to one list.
          if (lines[i]?.trim() === "" && lines[i + 1] !== undefined && LIST_ITEM.test(lines[i + 1]!)) {
            i++
            continue
          }
          break
        }
        const [, spaces = "", marker = "-", body = ""] = match
        const ordered = /^\d/.test(marker)
        const indent = indentWidth(spaces)
        // Ordered and unordered items at the same level are separate lists.
        if (indent === 0) {
          if (rootOrdered !== undefined && rootOrdered !== ordered) break
          rootOrdered = ordered
        }
        let text = body.trim()
        let checked: boolean | undefined
        const task = text.match(/^\[([ xX])\]\s+(.*)$/)
        if (task) {
          checked = task[1]!.toLowerCase() === "x"
          text = task[2]!
        }
        raw.push({
          indent,
          ordered,
          number: ordered ? Number.parseInt(marker, 10) : 1,
          text,
          ...(checked === undefined ? {} : { checked }),
        })
        i++
      }
      const first = raw[0]
      if (first) {
        const items = buildList(raw)
        blocks.push({ type: "list", ordered: first.ordered, start: first.number, items })
      }
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

function buildList(raw: (Omit<ListItem, "children"> & { indent: number })[]): ListItem[] {
  const roots: ListItem[] = []
  const stack: { item: ListItem; indent: number }[] = []
  for (const { indent, ...entry } of raw) {
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    const item: ListItem = { ...entry, children: [] }
    const parent = stack[stack.length - 1]
    ;(parent ? parent.item.children : roots).push(item)
    stack.push({ item, indent })
  }
  return roots
}

const IMAGE_RUN = /!\[([^\]\n]*)\]\(((?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)[^\s)]+)\)/
const INLINE = new RegExp(
  [
    IMAGE_RUN.source,
    "(`[^`\\n]+`)",
    "(\\*\\*[^*\\n]+\\*\\*)",
    "(~~[^~\\n]+~~)",
    "(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\))",
    "(\\*[^*\\s][^*\\n]*\\*)",
  ].join("|"),
  "g",
)

function safeImageUrl(url: string): string | undefined {
  if (/^https?:\/\//i.test(url)) return url
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url
  return undefined
}

export function renderInline(text: string, streaming = false, streamKey?: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const key = `${at}-${token}`
    const image = token.startsWith("![") ? token.match(IMAGE_RUN) : null
    if (image) {
      const src = safeImageUrl(image[2]!)
      if (src === undefined) nodes.push(image[1] || image[2])
      else {
        const block = streaming && streamKey ? streamBlock(`${streamKey}:img:${key}`) : undefined
        nodes.push(<img key={key} src={src} alt={image[1] ?? ""} loading="lazy" referrerPolicy="no-referrer" className={`my-3 inline-block max-h-[420px] max-w-full rounded-lg border border-[var(--divider-subtle)] object-contain align-top${block?.className ? ` ${block.className}` : ""}`} onAnimationEnd={block?.onAnimationEnd} />)
      }
    } else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith("~~")) nodes.push(<del key={key}>{token.slice(2, -2)}</del>)
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

const STREAM_SEGMENT = /([㐀-鿿]|[^\s㐀-鿿]+|\s+)/g
const STREAM_SEGMENT_LIMIT = 240
const settledStreamTokens = new Set<string>()

// Keep the settled-token set bounded; evicting an old key only costs one
// harmless re-fade if that block is ever mounted again.
function settleStreamToken(key: string) {
  settledStreamTokens.add(key)
  if (settledStreamTokens.size > 4000) {
    const oldest = settledStreamTokens.values().next().value
    if (oldest !== undefined) settledStreamTokens.delete(oldest)
  }
}

const settledStreamBlocks = new Set<string>()

function settleStreamBlock(key: string) {
  settledStreamBlocks.add(key)
  if (settledStreamBlocks.size > 2000) {
    const oldest = settledStreamBlocks.values().next().value
    if (oldest !== undefined) settledStreamBlocks.delete(oldest)
  }
}

function streamBlock(key: string): { className?: string; onAnimationEnd?: (event: AnimationEvent<Element>) => void } {
  if (settledStreamBlocks.has(key)) return {}
  return {
    className: "noa-stream-block",
    onAnimationEnd: (event) => {
      // Token fade events bubble; only settle the block itself.
      if (event.target === event.currentTarget) settleStreamBlock(key)
    },
  }
}

// Wrap the newest tokens of a live markdown block so they fade in as they
// arrive; older tokens stay plain text to keep the span count bounded.
function streamTokens(text: string, key: string, counter: { node: number }): ReactNode[] {
  const tokens = text.match(STREAM_SEGMENT) ?? [text]
  const start = Math.max(0, tokens.length - STREAM_SEGMENT_LIMIT)
  const node = counter.node++
  const nodes: ReactNode[] = []
  if (start > 0) nodes.push(tokens.slice(0, start).join(""))
  for (let i = start; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token === "" || /^\s+$/.test(token)) {
      nodes.push(token)
      continue
    }
    const tokenKey = `${key}-${node}-${i}`
    const settled = settledStreamTokens.has(tokenKey)
    nodes.push(
      <span
        key={tokenKey}
        className={settled ? undefined : "noa-stream-seg"}
        onAnimationEnd={settled ? undefined : () => settleStreamToken(tokenKey)}
      >
        {token}
      </span>,
    )
  }
  return nodes
}

function streamInline(nodes: ReactNode[], key: string, counter: { node: number }): ReactNode[] {
  return nodes.map((node) => {
    if (typeof node === "string") return streamTokens(node, key, counter)
    if (isValidElement<{ children?: ReactNode }>(node) && node.props.children !== undefined) {
      return cloneElement(node, undefined, streamInline(Children.toArray(node.props.children), key, counter))
    }
    return node
  })
}

function renderInlineText(text: string, streaming: boolean | undefined, key: string, streamKey?: string): ReactNode[] {
  const nodes = renderInline(text, streaming, streamKey)
  return streaming ? streamInline(nodes, streamKey ? `${streamKey}:${key}` : key, { node: 0 }) : nodes
}

export function Markdown({ text, tone = "default", streaming = false, streamKey }: { text: string; tone?: "default" | "muted"; streaming?: boolean; streamKey?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  const color = tone === "muted" ? "text-[var(--sidebar-text-muted,#898781)]" : "text-[var(--text-primary,#2D2D2B)]"
  return (
    <div className={`prose prose-neutral max-w-none text-[length:var(--font-text-md-size)] leading-[var(--font-text-md-line-height)] ${color} [&>:first-child]:mt-0 [&_p]:my-0 [&_p]:mb-4 [&_p:last-child]:mb-0 [&_li>p]:mb-0 [&_ul]:my-0 [&_ul]:mb-4 [&_ul:last-child]:mb-0 [&_ul]:pl-5 [&_ol]:my-0 [&_ol]:mb-4 [&_ol:last-child]:mb-0 [&_ol]:pl-5 [&_li]:my-0 [&_li]:pl-0.5 [&_li+li]:mt-2 [&_ol>li::marker]:font-semibold [&_ol>li::marker]:text-[var(--text-primary,#2D2D2B)] [&_:is(h1,h2,h3,h4,h5,h6)]:mt-7 [&_:is(h1,h2,h3,h4,h5,h6)]:mb-1 [&_:is(h1,h2,h3,h4,h5,h6)]:font-bold [&_:is(h1,h2,h3,h4,h5,h6)]:leading-[1.5] [&_h1]:text-[2em] [&_h2]:text-[1.5em] [&_h3]:text-[1.17em] [&_h4]:text-[1em] [&_h5]:text-[0.83em] [&_h6]:text-[0.67em] [&_:is(h1,h2,h3,h4,h5,h6)+p]:mt-0 [&_:is(ul,ol)+:is(h1,h2,h3,h4,h5,h6)]:mt-3.5 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:font-normal [&_code]:rounded-[4px] [&_code]:bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)] [&_code]:px-1 [&_code]:py-px`}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} streaming={streaming} streamKey={streamKey ? `${streamKey}:b${i}` : undefined} />
      ))}
    </div>
  )
}

function BlockView({ block, streaming, streamKey }: { block: Block; streaming?: boolean; streamKey?: string }) {
  switch (block.type) {
    case "code":
      return <CodeBlock lang={block.lang} code={block.code} />
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="tabular-nums">
            <thead>
              <tr>
                {block.rows[0]?.map((cell, i) => (
                  <th key={i} style={{ textAlign: block.align[i] }}>{renderInlineText(cell, streaming, `th-${i}`, streamKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, i) => {
                const blockProps = streaming && streamKey ? streamBlock(`${streamKey}:tr:${i}`) : {}
                return (
                  <tr key={i} {...blockProps}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ textAlign: block.align[j] }}>{renderInlineText(cell, streaming, `td-${i}-${j}`, streamKey)}</td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    case "heading": {
      const Tag = `h${Math.min(block.level, 6)}` as "h1"
      return <Tag>{renderInlineText(block.text, streaming, "heading", streamKey)}</Tag>
    }
    case "list":
      return <ListView items={block.items} ordered={block.ordered} start={block.start} streaming={streaming} streamKey={streamKey} />
    case "quote": {
      const blockProps = streaming && streamKey ? streamBlock(`${streamKey}:quote`) : {}
      return <blockquote {...blockProps}>{renderInlineText(block.text, streaming, "quote", streamKey)}</blockquote>
    }
    case "hr": {
      const blockProps = streaming && streamKey ? streamBlock(`${streamKey}:hr`) : {}
      return <hr {...blockProps} />
    }
    case "p":
      return (
        <p>
          {block.text.split("\n").map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInlineText(line, streaming, `p-${i}`, streamKey)}
            </Fragment>
          ))}
        </p>
      )
  }
}

function ListView({ items, ordered, start, streaming, streamKey, keyPrefix = "list" }: { items: ListItem[]; ordered: boolean; start: number; streaming?: boolean; streamKey?: string; keyPrefix?: string }) {
  const rows = items.map((item, index) => {
    const itemKey = `${keyPrefix}-${index}`
    const blockProps = streaming && streamKey ? streamBlock(`${streamKey}:li:${itemKey}`) : {}
    const classes = [item.checked === undefined ? null : "list-none", blockProps.className].filter(Boolean).join(" ")
    return (
      <li key={index} className={classes || undefined} onAnimationEnd={blockProps.onAnimationEnd}>
        {item.checked === undefined ? (
          renderInlineText(item.text, streaming, itemKey, streamKey)
        ) : (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={item.checked} readOnly className="mt-[0.35em] shrink-0 accent-[var(--accent-color,#CC7D5E)]" />
            <span>{renderInlineText(item.text, streaming, itemKey, streamKey)}</span>
          </label>
        )}
        {item.children.length > 0 && (
          <ListView
            items={item.children}
            ordered={item.children[0]!.ordered}
            start={item.children[0]!.number}
            streaming={streaming}
            streamKey={streamKey}
            keyPrefix={itemKey}
          />
        )}
      </li>
    )
  })
  return ordered ? <ol start={start === 1 ? undefined : start}>{rows}</ol> : <ul>{rows}</ul>
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const highlighted = useMemo(() => {
    const name = ({
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      sh: "bash",
      yml: "yaml",
    } as Record<string, string>)[lang.toLowerCase()] ?? lang.toLowerCase()
    if (name && hljs.getLanguage(name)) return hljs.highlight(code, { language: name, ignoreIllegals: true }).value
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }, [code, lang])

  function copy() {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="not-prose my-3 overflow-hidden rounded-xl border border-[var(--divider-subtle)] bg-[var(--bg-card)]">
      <div className="flex h-9 items-center justify-between border-b border-[var(--divider-subtle)] px-4 font-mono text-caption text-[var(--sidebar-text-muted,#898781)]">
        <span>{lang || "text"}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="m-0 overflow-auto p-4 font-mono text-[length:var(--code-font-size)] leading-[1.6] whitespace-pre"><code className="hljs bg-transparent p-0" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
    </div>
  )
}
