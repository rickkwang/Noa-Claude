import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"
import { Check, Copy, X } from "../lib/icons"

export async function copyContent(element: HTMLElement | null, fallback: string) {
  if (!element) return navigator.clipboard.writeText(fallback)
  const clone = element.cloneNode(true) as HTMLElement
  clone.querySelectorAll("[data-copy-exclude], iframe, [aria-hidden=true]").forEach(node => node.remove())
  clone.querySelectorAll("button").forEach(button => button.replaceWith(...button.childNodes))
  clone.querySelectorAll("audio, video").forEach(node => node.replaceWith(document.createTextNode(node.getAttribute("aria-label") ?? "Media")))
  const html = clone.innerHTML
  clone.style.position = "fixed"
  clone.style.left = "-100000px"
  clone.style.width = `${element.getBoundingClientRect().width}px`
  clone.setAttribute("aria-hidden", "true")
  document.body.append(clone)
  const text = clone.innerText.trim() || fallback
  clone.remove()
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    })])
  } else await navigator.clipboard.writeText(text)
}

export function PreviewDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }} className="noa-content-preview m-auto h-[min(85vh,900px)] w-[min(90vw,1200px)] max-w-none rounded-2xl border border-[var(--divider-subtle)] bg-[var(--bg-card)] p-0 text-[var(--text-primary)] backdrop:bg-black/40">
    <div className="flex h-12 items-center justify-between border-b border-[var(--divider-subtle)] px-4"><span>{title}</span><button type="button" aria-label="Close preview" onClick={onClose}><X size={18} /></button></div>
    <div className="h-[calc(100%_-_3rem)] overflow-auto p-5">{children}</div>
  </dialog>
}

export function MathText({ text, display, pending = false }: { text: string; display: boolean; pending?: boolean }) {
  const html = useMemo(() => {
    try { return katex.renderToString(text, { displayMode: display, throwOnError: pending, trust: false, maxExpand: 1000, maxSize: 20 }) }
    catch { return "" }
  }, [text, display, pending])
  const Tag = display ? "div" : "span"
  return <Tag className={display ? "my-4 overflow-x-auto" : undefined} dangerouslySetInnerHTML={{ __html: html }} />
}

export function Diagram({ code }: { code: string }) {
  const id = useId().replace(/:/g, "")
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark")
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === "dark"))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => observer.disconnect()
  }, [])
  const [svg, setSvg] = useState("")
  const [error, setError] = useState<string>()
  const [source, setSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setSvg("")
    setError(undefined)
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "neutral" })
      const result = await mermaid.render(`noa-diagram-${id}`, code)
      if (!cancelled) setSvg(result.svg)
    }).catch(error => { if (!cancelled) setError(String(error.message ?? error)) })
    return () => { cancelled = true }
  }, [code, id, dark])
  return <div className="not-prose my-4 overflow-hidden rounded-xl border border-[var(--divider-subtle)]">
    <div data-copy-exclude className="flex flex-wrap items-center gap-3 border-b border-[var(--divider-subtle)] px-4 py-2 text-caption"><span className="flex-1">Mermaid</span><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopyError(false); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setCopyError(true) } }}>{copied ? "Copied" : "Copy source"}</button><button type="button" disabled={!svg} onClick={() => { const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); const link = document.createElement("a"); link.href = url; link.download = "diagram.svg"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>Save SVG</button><button type="button" onClick={() => setSource(value => !value)}>{source ? "Diagram" : "Source"}</button><button type="button" disabled={!svg} onClick={() => setExpanded(true)}>Expand diagram</button></div>
    {copyError && <p role="status" className="px-4 text-caption">Could not copy diagram source.</p>}
    {source || error ? <><pre className="noa-selectable overflow-auto p-4 text-[length:var(--code-font-size)]">{code}</pre>{error && <p role="status" className="px-4 pb-3 text-caption text-[var(--text-secondary)]">Diagram unavailable: {error}</p>}</> : svg ? <div className="noa-diagram overflow-auto p-4" dangerouslySetInnerHTML={{ __html: svg }} /> : <p role="status" className="p-4 text-caption">Rendering diagram…</p>}
    {expanded && <PreviewDialog title="Diagram preview" onClose={() => setExpanded(false)}><div className="noa-diagram" dangerouslySetInnerHTML={{ __html: svg }} /></PreviewDialog>}
  </div>
}

export function MarkdownTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  return <div className="group/table relative my-4">
    <div data-copy-exclude className="mb-1 flex justify-end gap-3 text-caption text-[var(--text-secondary)]">
      <button type="button" aria-label="Copy table" onClick={async () => {
        try {
          const table = ref.current?.querySelector("table")
          const text = table ? Array.from(table.rows, row => Array.from(row.cells, cell => cell.textContent ?? "").join("\t")).join("\n") : ""
          if (table && typeof ClipboardItem !== "undefined" && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }), "text/html": new Blob([table.outerHTML], { type: "text/html" }) })])
          else await navigator.clipboard.writeText(text)
          setError(false); setCopied(true); setTimeout(() => setCopied(false), 2000)
        } catch { setError(true) }
      }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
      <button type="button" onClick={() => setExpanded(true)}>Expand table</button>
    </div>
    {error && <span role="status" className="text-caption">Could not copy table.</span>}
    <div ref={ref} className="overflow-x-auto" role="region" aria-label="Table" tabIndex={0} onKeyDown={event => {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.metaKey || event.ctrlKey || event.shiftKey) return
      event.preventDefault()
      event.currentTarget.scrollBy({ left: (event.key === "ArrowLeft" ? -1 : 1) * (event.altKey ? event.currentTarget.clientWidth : 40) })
    }}>{children}</div>
    {expanded && <PreviewDialog title="Table preview" onClose={() => setExpanded(false)}><div className="noa-output-markdown overflow-auto">{children}</div></PreviewDialog>}
  </div>
}
