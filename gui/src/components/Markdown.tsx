import { Children, Fragment, cloneElement, isValidElement, createContext, useContext, useEffect, useMemo, useRef, useState, type AnimationEvent, type ReactNode } from "react"
import { type Token, type Tokens } from "marked"
import { parseBlocks, parseInline, parseStreaming, type MarkdownPrefix } from "./markdownGrammar"
import { Diagram, MarkdownTable, MathText, PreviewDialog } from "./RichContent"
export { parseBlocks } from "./markdownGrammar"
import { Lightbox, type LightboxItem } from "./Lightbox"
import hljs from "highlight.js/lib/common"
import { Check, Copy, Terminal } from "../lib/icons"

// Parse the existing Markdown grammar as a tree; render React children, never raw HTML.
export const OutputContext = createContext<{ cwd?: string; onOpenFile?: (path: string, line?: number, endLine?: number) => void; onOpenImages?: (items: LightboxItem[], index: number) => void }>({})
const MAX_PARSER_LINE = 16_384
const MAX_HIGHLIGHT_SIZE = 65_536
const MAX_HIGHLIGHT_LINE = 1_024

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return `/${parts.join("/")}`
}

export function localReference(href: string, cwd?: string): { path: string; line?: number; endLine?: number } | undefined {
  if (!cwd || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return
  const base = cwd.replace(/\/$/, "")
  const match = href.match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?)$/)
  const target = match?.[1] ?? href
  let path: string
  try { path = decodeURIComponent(target) } catch { return }
  const absolute = path.startsWith("/")
  const resolved = normalizePath(absolute ? path : `${base}/${path}`)
  if (!resolved.startsWith(base + "/") || (absolute && path !== resolved)) return
  return { path: resolved.slice(base.length + 1), line: match ? positiveLine(match[2] ?? match[3]) : undefined, ...(match?.[4] ? { endLine: positiveLine(match[4]) } : {}) }
}

function OutputLink({ href, children }: { href: string; children: ReactNode }) {
  const { cwd, onOpenFile } = useContext(OutputContext)
  const local = localReference(href, cwd)
  if (local && /\.(?:mp3|wav|m4a|aac|ogg|opus|flac|mp4|m4v|mov|webm)$/i.test(local.path)) return <OutputImage href={href} alt={typeof children === "string" ? children : local.path} />
  if (local) return <button type="button" className="inline cursor-pointer text-[var(--accent-color)] underline underline-offset-2" title={href} onClick={() => onOpenFile?.(local.path, local.line, local.endLine)}>{children}</button>
  if (/^https?:\/\//i.test(href)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  return <span title={href}>{children}</span>
}

function OutputImage({ href, alt }: { href: string; alt: string }) {
  const { cwd, onOpenImages } = useContext(OutputContext)
  const local = localReference(href, cwd)
  const remote = /^https?:\/\//i.test(href)
  const mediaType = /(?:\.(?:mp3|wav|m4a|aac|ogg|opus|flac)$|^data:audio\/)/i.test(local?.path ?? href) ? "audio"
    : /(?:\.(?:mp4|m4v|mov|webm)$|^data:video\/)/i.test(local?.path ?? href) ? "video" : "image"
  const dataImage = /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)|audio\/[\w.+-]+|video\/[\w.+-]+);base64,/i.test(href)
  const [src, setSrc] = useState<string | undefined>(dataImage ? href : undefined)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setError(false)
    setSrc(dataImage ? href : undefined)
    if (remote || dataImage) return
    if (!local) { setError(true); return }
    if (mediaType !== "image") { setSrc(`/api/media?${new URLSearchParams({ cwd: cwd!, path: local.path })}`); return }
    const controller = new AbortController()
    fetch(`/api/file?${new URLSearchParams({ cwd: cwd!, path: local.path })}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok || body.kind !== "image") throw new Error("Image unavailable")
        setSrc(body.dataUrl)
      }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [href, cwd])
  if (remote) return <span className="text-[var(--sidebar-text-muted)]">Remote image blocked: <OutputLink href={href}>{alt || "Open image"}</OutputLink></span>
  if (error) return <span className="text-[var(--sidebar-text-muted)]">{alt || mediaType} — {mediaType} unavailable</span>
  if (mediaType !== "image" && src) {
    const Player = mediaType
    return <span className="not-prose my-3 inline-flex max-w-full flex-col gap-2"><Player src={src} controls preload="metadata" aria-label={alt || mediaType} onError={() => setError(true)} className="max-h-[480px] max-w-full rounded-lg" /><a href={src + (src.startsWith("/api/media?") ? "&download=1" : "")} download className="self-start text-caption text-[var(--accent-color)]">Save copy</a></span>
  }
  return <>{src ? <button type="button" className="my-3 inline-block max-w-full cursor-zoom-in align-top" aria-label={`Open ${alt || "image"}`} onClick={() => onOpenImages ? onOpenImages([{ src, alt }], 0) : setOpen(true)}><img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setError(true)} className="max-h-[420px] max-w-full rounded-lg border border-[var(--divider-subtle)] object-contain" /></button> : <span className="text-[var(--sidebar-text-muted)]">Loading image…</span>}{open && src && <Lightbox items={[{ src, alt }]} index={0} onIndex={() => {}} onClose={() => setOpen(false)} />}</>
}

function positiveLine(value: string | undefined): number | undefined {
  const number = typeof value === "string" ? Number.parseInt(value, 10) : NaN
  return Number.isInteger(number) && number > 0 ? number : undefined
}

function lineTarget(path: string, start: number | undefined, end: number | undefined): string {
  return path + (start ? `#L${start}${end && end >= start ? `-L${end}` : ""}` : "")
}

function FileCitation({ attributes }: { attributes: Record<string, string> }) {
  const path = attributes.path ?? ""
  if (!path) return null
  const line = positiveLine(attributes.lineRangeStart ?? attributes.line_range_start)
  const end = positiveLine(attributes.lineRangeEnd ?? attributes.line_range_end)
  return <OutputLink href={lineTarget(path, line, end)}>{attributes.label?.trim() || attributes.title?.trim() || path.split("/").pop() || "Source"}</OutputLink>
}

function ReviewComment({ attributes }: { attributes: Record<string, string> }) {
  const { title, body, file, priority } = attributes
  const start = positiveLine(attributes.start), end = positiveLine(attributes.end)
  if (!title || !body || !file) return <span>{"::code-comment"}</span>
  return <section className="not-prose my-3 rounded-xl border border-[var(--divider-subtle)] p-4" aria-label="Code review comment">
    <div className="flex items-start gap-2 font-medium">{priority && <span className="text-caption">P{priority}</span>}<span>{title}</span></div>
    <Markdown text={body} />
    <div className="mt-2 text-caption"><OutputLink href={lineTarget(file, start, end)}>{file}{start ? `:${start}${end && end >= start ? `-${end}` : ""}` : ""}</OutputLink></div>
  </section>
}

export function renderInline(text: string): ReactNode[] {
  return inlineTokens(parseInline(text))
}

function inlineTokens(tokens: Token[] = []): ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.type) {
      case "mathInline": return <MathText key={i} text={token.text} display={false} />
      case "fileCitation": return <FileCitation key={i} attributes={token.attributes} />
      case "strong": return <strong key={i}>{inlineTokens(token.tokens)}</strong>
      case "em": return <em key={i}>{inlineTokens(token.tokens)}</em>
      case "del": return <del key={i}>{inlineTokens(token.tokens)}</del>
      case "codespan": return <code key={i}>{token.text}</code>
      case "br": return <br key={i} />
      case "link": return <OutputLink key={i} href={token.href}>{inlineTokens(token.tokens)}</OutputLink>
      case "image": return <OutputImage key={i} href={token.href} alt={token.text} />
      default: return "tokens" in token && token.tokens ? <Fragment key={i}>{inlineTokens(token.tokens)}</Fragment> : (token as Tokens.Text).text ?? token.raw
    }
  })
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
    if (isValidElement<{ children?: ReactNode }>(node) && typeof node.type === "string" && node.props.children !== undefined) {
      return cloneElement(node, undefined, streamInline(Children.toArray(node.props.children), key, counter))
    }
    return node
  })
}

export function Markdown({ text, tone = "default", streaming = false, streamKey, className }: { text: string; tone?: "default" | "muted"; streaming?: boolean; streamKey?: string; className?: string }) {
  const plainLine = text.split("\n").some(line => line.length > MAX_PARSER_LINE)
  const prefix = useRef<MarkdownPrefix>({ text: "", tokens: [] })
  const blocks = useMemo(() => plainLine ? [] : streaming ? parseStreaming(text, prefix.current) : parseBlocks(text), [text, plainLine, streaming])
  const color = tone === "muted" ? "text-[var(--sidebar-text-muted,#898781)]" : "text-[var(--text-primary,#2D2D2B)]"
  return (
    <div className={`noa-output-markdown noa-selectable prose prose-neutral max-w-none ${color}${className ? ` ${className}` : ""}`}>
      {plainLine ? text : blocks.map((block, i) => (
        <BlockView key={i} block={block} streaming={streaming} streamKey={streamKey ? `${streamKey}:b${i}` : undefined} />
      ))}
    </div>
  )
}

function BlockView({ block, streaming, streamKey }: { block: Token; streaming?: boolean; streamKey?: string }) {
  const children = (tokens: Token[] = []) => tokens.map((child, i) => <BlockView key={i} block={child} streaming={streaming} streamKey={streamKey ? `${streamKey}:${i}` : undefined} />)
  const inline = (tokens: Token[] = []) => {
    const nodes = inlineTokens(tokens)
    return streaming ? streamInline(nodes, streamKey ?? "inline", { node: 0 }) : nodes
  }
  const props = streaming && streamKey ? streamBlock(streamKey) : {}
  switch (block.type) {
    case "mathBlock": return <MathText text={block.text} display pending={streaming && !block.closed} />
    case "detailsBlock": return <details className="my-3 rounded-xl border border-[var(--divider-subtle)] px-4 py-3" open={block.open}><summary className="cursor-pointer font-medium">{renderInline(block.summary)}</summary><Markdown text={block.text} streaming={streaming} streamKey={streamKey} /></details>
    case "reviewComment": return <ReviewComment attributes={block.attributes} />
    case "space": return null
    case "code": {
      const fence = block.raw.match(/^ {0,3}(`{3,}|~{3,})/)?.[1]
      const complete = !streaming || !fence || new RegExp(`\\n {0,3}${fence[0]}{${fence.length},}[ \t]*(?:\\n)?$`).test(block.raw)
      if (block.lang?.trim().toLowerCase() === "math") return <MathText text={block.text} display pending={streaming && !complete} />
      if (block.lang?.trim().toLowerCase() === "mermaid" && complete) return <Diagram code={block.text} />
      return <CodeBlock lang={(block.lang ?? "").split(/\s/)[0]!} code={block.text} complete={complete} />
    }
    case "heading": {
      const Tag = `h${block.depth}` as "h1"
      return <Tag>{inline(block.tokens)}</Tag>
    }
    case "paragraph": return <p>{inline(block.tokens)}</p>
    case "text": return block.tokens ? inline(block.tokens) : block.text
    case "blockquote": return <blockquote {...props}>{children(block.tokens)}</blockquote>
    case "hr": return <hr {...props} />
    case "list": {
      const items = block.items.map((item: Tokens.ListItem, i: number) => (
        <li key={i} className={item.task ? "list-none" : undefined} {...(streaming && streamKey ? streamBlock(`${streamKey}:li:${i}`) : {})}>
          {item.task ? <><input type="checkbox" checked={item.checked} readOnly className="accent-[var(--accent-color)]" /><div>{children(item.tokens)}</div></> : children(item.tokens)}
        </li>
      ))
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start || undefined}>{items}</ol> : <ul>{items}</ul>
    }
    case "table": return (
      <MarkdownTable>
        <table className="tabular-nums">
          <thead><tr>{block.header.map((cell: Tokens.TableCell, i: number) => (
            <th key={i} style={{ textAlign: block.align[i] ?? undefined }}>{inline(cell.tokens)}</th>
          ))}</tr></thead>
          <tbody>{block.rows.map((row: Tokens.TableCell[], i: number) => (
            <tr key={i} {...(streaming && streamKey ? streamBlock(`${streamKey}:tr:${i}`) : {})}>
              {row.map((cell, j) => <td key={j} style={{ textAlign: block.align[j] ?? undefined }}>{inline(cell.tokens)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </MarkdownTable>
    )
    case "def": return null
    default: return <span>{block.raw}</span>
  }
}

export function CodeBlock({ lang, code, complete = true }: { lang: string; code: string; complete?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [preview, setPreview] = useState(false)
  const highlighted = useMemo(() => {
    const name = ({
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      sh: "bash",
      yml: "yaml",
    } as Record<string, string>)[lang.toLowerCase()] ?? lang.toLowerCase()
    if (name && hljs.getLanguage(name) && code.length <= MAX_HIGHLIGHT_SIZE && !code.split("\n").some(line => line.length > MAX_HIGHLIGHT_LINE)) return hljs.highlight(code, { language: name, ignoreIllegals: true }).value
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }, [code, lang])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopyError(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { setCopyError(true) }
  }

  return (
    <div className="noa-code-block not-prose my-3 min-w-0 overflow-hidden rounded-[20px] border border-[var(--divider-subtle)]">
      <div data-copy-exclude className="flex min-h-12 items-center gap-2 py-1.5 ps-5 pe-1.5 font-ui text-[length:var(--text-chat-sm)] font-medium text-[var(--text-primary)]">
        <Terminal size={16} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{lang || "text"}</span>
        <button type="button" aria-label="Toggle code wrapping" aria-pressed={wrap} onClick={() => setWrap(value => !value)} className="px-2 text-caption">Wrap</button>
        {complete && ["html", "svg"].includes(lang.toLowerCase()) && <button type="button" onClick={() => setPreview(true)} className="px-2 text-caption">Preview</button>}
        {complete && <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"} title={copyError ? "Copy failed. Try again." : copied ? "Copied" : "Copy code"} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7.5%,transparent)] hover:text-[var(--text-primary)]">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>}
      </div>
      {copyError && <span role="status" className="px-5 text-caption text-[#C24444]">Could not copy. Try again.</span>}
      <pre className="noa-selectable m-0 overflow-auto px-5 pt-0 pb-3 font-mono font-normal text-[length:var(--code-font-size)] leading-[max(1.5em,20px)]" style={{ whiteSpace: wrap ? "pre-wrap" : "pre", overflowWrap: wrap ? "anywhere" : undefined }}><code className="hljs" style={{ fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit", background: "transparent", padding: 0 }} dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      {preview && <PreviewDialog title="Code preview" onClose={() => setPreview(false)}><iframe title="Code preview" sandbox="" className="h-full w-full border-0 bg-white" srcDoc={"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'\">" + code} /></PreviewDialog>}
    </div>
  )
}
