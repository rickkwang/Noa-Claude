import { useEffect, useRef, useState } from "react"
import type { ControlRequest } from "../../agent/protocol"
import { Edit2, Plus, Trash2, X } from "../../lib/icons"
import { useConfirm } from "../ConfirmDialog"
import { Row, Section, Select, actionButton } from "./controls"

type Scope = "user" | "project" | "local"
type Kind = "permissions" | "mcp"
type Config = Record<string, any>
type Snapshot = { value: Config; revision: string; path?: string }
type ServerDraft = { name: string; original?: string; config: Config; args: string; env: string; headers: string }
const field = "w-full min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-body outline-none focus:border-[var(--accent-color)] disabled:opacity-50"
const primaryButton = `${actionButton} bg-[var(--text-primary)] text-[var(--bg-card)] hover:opacity-90`
const scopeOptions: [string, string][] = [["local", "This project · private"], ["project", "This project · shared"], ["user", "All projects"]]
const pairText = (pairs: Config | undefined) => Object.entries(pairs ?? {}).map(([key, value]) => `${key}=${value}`).join("\n")

function parsePairs(text: string): Record<string, string> {
  return Object.fromEntries(text.split("\n").filter(line => line.trim()).map(line => {
    const at = line.indexOf("=")
    if (at < 1 || !line.slice(0, at).trim()) throw new Error("Use KEY=value on each environment or header line.")
    return [line.slice(0, at).trim(), line.slice(at + 1)]
  }))
}

export function ConfigurationEditor({ kind, disabled, request, onSaved, onDirtyChange }: {
  kind: Kind
  disabled: boolean
  request: (request: ControlRequest) => Promise<any>
  onSaved: (restart: boolean) => void | Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>("local")
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [rules, setRules] = useState({ allow: "", ask: "", deny: "" })
  const [server, setServer] = useState<ServerDraft>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [pending, setPending] = useState(false)
  const { confirm, dialog } = useConfirm()
  const serverPanel = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const rulesDirty = !!snapshot && Object.entries(rules).some(([key, text]) => text !== (snapshot.value[key] ?? []).join("\n"))
  const original = server?.original ? snapshot?.value[server.original] : undefined
  const serverDirty = !!server && (server.name !== (server.original ?? "") || JSON.stringify(server.config) !== JSON.stringify(original ?? { type: "stdio", command: "", args: [] }) || server.args !== (original?.args ?? []).join("\n") || server.env !== pairText(original?.env) || server.headers !== pairText(original?.headers))
  const dirty = kind === "permissions" ? rulesDirty : serverDirty

  function apply(value: Snapshot) {
    setSnapshot(value)
    if (kind === "permissions") setRules({ allow: (value.value.allow ?? []).join("\n"), ask: (value.value.ask ?? []).join("\n"), deny: (value.value.deny ?? []).join("\n") })
    setServer(undefined)
  }
  useEffect(() => { onDirtyChange?.(dirty || pending) }, [dirty, pending, onDirtyChange])
  useEffect(() => {
    if (!open || disabled || snapshot) return
    let cancelled = false
    setError(undefined)
    void request({ subtype: "configuration", action: "get", kind, scope }).then(value => { if (!cancelled) apply(value) }).catch(error => { if (!cancelled) setError(error.message) })
    return () => { cancelled = true }
  }, [open, scope, kind, request, disabled, snapshot])
  useEffect(() => {
    if (open) editor.current?.scrollIntoView({ block: "nearest" })
  }, [open])
  useEffect(() => {
    if (!server) return
    const previous = document.activeElement as HTMLElement | null
    serverPanel.current?.querySelector<HTMLElement>("input:not(:disabled), select")?.focus()
    return () => previous?.focus()
  }, [!!server])

  const mayDiscard = () => !dirty || confirm({ title: "Discard unsaved changes?", description: "Your changes have not been saved.", confirmLabel: "Discard", cancelLabel: "Keep editing", danger: true })
  async function closeServer() {
    if (!pending && await mayDiscard()) { setServer(undefined); setError(undefined) }
  }
  function editServer(name = "", config: Config = { type: "stdio", command: "", args: [] }) {
    setError(undefined)
    setServer({ name, original: name || undefined, config: structuredClone(config), args: (config.args ?? []).join("\n"), env: pairText(config.env), headers: pairText(config.headers) })
  }
  async function save(action: "save" | "remove", name?: string) {
    if (!snapshot || pending) return
    if (action === "remove" && !await confirm({ title: `Remove ${name}?`, description: "This removes the server configuration from the selected scope.", confirmLabel: "Remove", danger: true })) return
    setPending(true)
    setError(undefined)
    setNotice(undefined)
    try {
      let value: Config | undefined
      if (kind === "permissions") value = Object.fromEntries(Object.entries(rules).map(([key, text]) => [key, text.split("\n").map(rule => rule.trim()).filter(Boolean)]))
      else if (action === "save" && server) {
        if (!server.original && Object.hasOwn(snapshot.value, name ?? "")) throw new Error("A server with this name already exists in this scope. Edit that server instead.")
        value = { ...server.config }
        if (!value.type || value.type === "stdio") {
          value.args = server.args ? server.args.split("\n") : []
          if (server.env || value.env) value.env = parsePairs(server.env)
          delete value.url
          delete value.headers
        } else {
          if (server.headers || value.headers) value.headers = parsePairs(server.headers)
          delete value.command
          delete value.args
          delete value.env
        }
      }
      const result = await request({ subtype: "configuration", action, kind, scope, revision: snapshot.revision, name, value })
      apply(result)
      setNotice(kind === "mcp" ? "Saved. Reconnect this chat to apply server changes." : "Permission rules saved.")
      await onSaved(false)
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }
  async function reconnect() {
    setPending(true)
    setError(undefined)
    try { await onSaved(true); setNotice(undefined) }
    catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }
  const configField = (key: string, value: unknown) => setServer(current => current ? { ...current, config: { ...current.config, [key]: value } } : current)
  const fieldError = error && <p role="alert" className="break-words text-caption text-[var(--text-danger)]">{error}</p>

  return <>
    <Section title={kind === "permissions" ? "Edit permission rules" : "Manage server configurations"}>
      <Row label={kind === "permissions" ? "Saved rules" : "Custom MCP servers"} description={kind === "permissions" ? "Choose where to save Allow, Ask and Deny rules." : "Manage servers for this project or all projects."}>
        <button type="button" disabled={disabled || pending} className={actionButton} aria-expanded={open} onClick={async () => {
          if (!open) { setSnapshot(undefined); setOpen(true) }
          else if (await mayDiscard()) { if (snapshot) apply(snapshot); setOpen(false); setError(undefined) }
        }}>{open ? "Close editor" : "Edit"}</button>
      </Row>
      {open && <div ref={editor} className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-body">Save to</span><Select label="Configuration scope" value={scope} options={scopeOptions} disabled={disabled || pending || !!server} onChange={async value => {
          if (await mayDiscard()) { setSnapshot(undefined); setScope(value as Scope); setNotice(undefined) }
        }} /></div>
        <p className="text-caption text-[var(--text-secondary)]">{scope === "user" ? "Applies to all projects on this computer." : scope === "project" ? "Stored with this project and can be shared with your team." : "Applies only to this project on this computer."}</p>
        {!snapshot && !error && <p role="status" className="text-caption text-[var(--text-secondary)]">Loading configuration…</p>}
        {snapshot && <fieldset disabled={disabled || pending} className="flex min-w-0 flex-col gap-3">
          {kind === "permissions" ? <>
            <div className="grid gap-3 xl:grid-cols-3">{(["allow", "ask", "deny"] as const).map(key => <label key={key} className="flex min-w-0 flex-col gap-1.5 text-body"><span className="capitalize">{key}</span><textarea aria-label={`${key} rules`} value={rules[key]} rows={4} spellCheck={false} placeholder={key === "allow" ? "Bash(git status)\nRead" : key === "deny" ? "Read(.env)" : "Bash(git push:*)"} className={`${field} resize-y font-mono text-caption`} onChange={event => { setRules({ ...rules, [key]: event.target.value }); setNotice(undefined) }} /></label>)}</div>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-caption text-[var(--text-secondary)]">One rule per line. Rules from other scopes remain in effect.</p><button type="button" disabled={!rulesDirty || pending} className={primaryButton} onClick={() => void save("save")}>{pending ? "Saving…" : "Save rules"}</button></div>
            {snapshot.path && <details className="text-caption text-[var(--text-tertiary)]"><summary className="cursor-pointer">Configuration file</summary><p className="mt-1 break-all font-mono">{snapshot.path}</p></details>}
          </> : <>
            {!Object.keys(snapshot.value).length && <p className="py-2 text-caption text-[var(--text-secondary)]">No custom servers in this scope.</p>}
            {Object.entries(snapshot.value).map(([name, config]) => <div key={name} className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-body font-medium">{name}</p><p className="truncate text-caption text-[var(--text-secondary)]">{config.type === "http" ? "HTTP" : config.type === "sse" ? "SSE" : "Local command"}{config.command ? ` · ${config.command}` : ""}</p></div><button type="button" aria-label={`Edit ${name}`} title={`Edit ${name}`} className="flex size-7 items-center justify-center rounded-md hover:bg-[var(--settings-fill-hover)]" onClick={() => editServer(name, config)}><Edit2 size={14} /></button><button type="button" aria-label={`Remove ${name}`} title={`Remove ${name}`} className="flex size-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-danger)]" onClick={() => void save("remove", name)}><Trash2 size={14} /></button></div>)}
            <button type="button" className={`${actionButton} inline-flex items-center gap-1.5 self-start`} onClick={() => editServer()}><Plus size={14} />Add server</button>
          </>}
        </fieldset>}
        {!server && fieldError}
        {error && !server && <button type="button" disabled={pending || disabled} className={`${actionButton} self-start`} onClick={async () => { if (await mayDiscard()) { setError(undefined); setSnapshot(undefined) } }}>Reload configuration</button>}
        {notice && <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-caption text-[var(--text-secondary)]"><span>{notice}</span>{kind === "mcp" && <button type="button" className={actionButton} disabled={disabled || pending} onClick={() => void reconnect()}>{pending ? "Reconnecting…" : "Reconnect chat"}</button>}</div>}
      </div>}
    </Section>
    {server && <div data-config-server className="noa-confirm-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={event => { if (event.target === event.currentTarget) void closeServer() }} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === "Escape") { event.preventDefault(); void closeServer() }
      if (event.key === "Tab") {
        const items = [...serverPanel.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")]
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus() }
      }
    }}>
      <div ref={serverPanel} role="dialog" aria-modal="true" aria-label={server.original ? `Edit ${server.name}` : "Add MCP server"} className="noa-confirm-dialog flex max-h-[calc(100vh-32px)] w-full max-w-[520px] flex-col rounded-2xl bg-[var(--bg-card)] font-ui">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--divider-subtle)] p-5"><div><h2 className="text-body font-medium">{server.original ? "Edit MCP server" : "Add MCP server"}</h2><p className="mt-1 text-caption text-[var(--text-secondary)]">{scopeOptions.find(([value]) => value === scope)?.[1]}</p></div><button type="button" aria-label="Close server editor" disabled={pending} className="flex size-6 items-center justify-center rounded-md hover:bg-[var(--fill-hover)]" onClick={() => void closeServer()}><X size={14} /></button></header>
        <fieldset disabled={disabled || pending} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
          <label className="flex flex-col gap-1.5 text-body">Server name<input autoComplete="off" aria-label="Server name" value={server.name} disabled={!!server.original} className={field} onChange={event => setServer({ ...server, name: event.target.value })} /></label>
          <div className="flex items-center justify-between gap-2 text-body"><span>Transport</span><Select label="Server transport" value={server.config.type ?? "stdio"} options={[["stdio", "Local command"], ["http", "HTTP"], ["sse", "SSE"]]} onChange={type => configField("type", type)} /></div>
          {(!server.config.type || server.config.type === "stdio") ? <>
            <label className="flex flex-col gap-1.5 text-body">Command<input aria-label="Server command" value={server.config.command ?? ""} className={field} spellCheck={false} onChange={event => configField("command", event.target.value)} placeholder="npx" /></label>
            <label className="flex flex-col gap-1.5 text-body">Arguments<textarea aria-label="Server arguments" value={server.args} rows={2} className={`${field} resize-y font-mono text-caption`} onChange={event => setServer({ ...server, args: event.target.value })} placeholder="One argument per line" /></label>
            <label className="flex flex-col gap-1.5 text-body">Environment variables<textarea aria-label="Server environment" value={server.env} rows={2} spellCheck={false} className={`${field} resize-y font-mono text-caption`} onChange={event => setServer({ ...server, env: event.target.value })} placeholder="KEY=value, one per line" /></label>
          </> : <>
            <label className="flex flex-col gap-1.5 text-body">Server URL<input aria-label="Server URL" value={server.config.url ?? ""} className={field} spellCheck={false} onChange={event => configField("url", event.target.value)} placeholder="https://example.com/mcp" /></label>
            <label className="flex flex-col gap-1.5 text-body">Headers<textarea aria-label="Server headers" value={server.headers} rows={3} spellCheck={false} className={`${field} resize-y font-mono text-caption`} onChange={event => setServer({ ...server, headers: event.target.value })} placeholder="KEY=value, one per line" /></label>
          </>}
          {fieldError}
        </fieldset>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--divider-subtle)] px-5 py-4"><button type="button" disabled={pending} className={actionButton} onClick={() => void closeServer()}>Cancel</button><button type="button" disabled={disabled || pending || !server.name.trim() || !serverDirty || ((!server.config.type || server.config.type === "stdio") ? !server.config.command?.trim() : !server.config.url?.trim())} className={primaryButton} onClick={() => void save("save", server.name.trim())}>{pending ? "Saving…" : "Save server"}</button></footer>
      </div>
    </div>}
    {dialog}
  </>
}
