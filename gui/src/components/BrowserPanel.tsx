import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCcw, X } from '../lib/icons'
import { addressUrl, ensureBrowser, loadBrowser, type BrowserTab } from '../lib/browserTabs'

// The address bar shows "example.com/path" like a browser does; focusing it reveals the full URL.
function displayUrl(raw: string) {
  try {
    const url = new URL(raw)
    return `${url.host}${url.pathname === '/' && !url.search && !url.hash ? '' : url.pathname}${url.search}${url.hash}`
  } catch { return raw }
}

export function BrowserPanel({ cwd, tab, visible }: { cwd: string; tab: BrowserTab; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState(() => displayUrl(tab.url))
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setAddress(displayUrl(tab.url)) }, [tab.id, tab.url, editing])
  useEffect(() => { ensureBrowser(cwd, tab) }, [cwd, tab.id])
  const command = (action: string) => window.noaDesktop?.preview?.command({ action, id: tab.id })

  useEffect(() => {
    const preview = window.noaDesktop?.preview, element = host.current
    if (!preview || !element) return
    // A hidden tab, an error or an empty address shows no native view, so it needs no per-frame tracking.
    if (!visible || tab.error || !tab.url) { void preview.command({ action: 'bounds', id: tab.id, rect: null }); return }
    let frame = 0, last = '', blocked = false, dirty = true
    // Native views sit above the DOM. Hide them while app menus/dialogs are over the workspace. Scanning the
    // whole document every frame costs about 1ms on a long conversation, so rescan only after the DOM changes.
    const observer = new MutationObserver(() => { dirty = true })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'role', 'class', 'style', 'hidden', 'data-settings-open'] })
    const sync = () => {
      if (dirty) {
        dirty = false
        blocked = document.documentElement.dataset.settingsOpen === 'true' || [...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .noa-floating-panel')].some(overlay => overlay.checkVisibility())
      }
      const bounds = element.getBoundingClientRect()
      const shown = !blocked && element.checkVisibility() && bounds.width > 0 && bounds.height > 0
      const rect = shown ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null
      const viewport = [window.innerWidth, window.innerHeight]
      const key = JSON.stringify([rect, viewport, window.devicePixelRatio])
      if (key !== last) { last = key; void preview.command({ action: 'bounds', id: tab.id, rect, viewport }) }
      frame = requestAnimationFrame(sync)
    }
    sync()
    return () => { observer.disconnect(); cancelAnimationFrame(frame); void preview.command({ action: 'bounds', id: tab.id, rect: null }) }
  }, [tab.id, tab.error, tab.url, visible])

  return (
    <div className="flex h-full min-h-0 flex-col" data-browser-panel="">
      <div className="noa-browser-toolbar flex h-11 shrink-0 items-center gap-0.5 border-b border-[var(--border-light)] px-2">
        <button type="button" aria-label="Go back" title="Go back" disabled={!tab.canBack} onClick={() => void command('back')} className="noa-browser-action"><ArrowLeft size={15} /></button>
        <button type="button" aria-label="Go forward" title="Go forward" disabled={!tab.canForward} onClick={() => void command('forward')} className="noa-browser-action"><ArrowRight size={15} /></button>
        <button type="button" aria-label={tab.loading ? 'Stop loading' : 'Reload page'} title={tab.loading ? 'Stop loading' : 'Reload page'} disabled={!tab.url} onClick={() => tab.loading ? void command('stop') : void loadBrowser(cwd, tab)} className="noa-browser-action">{tab.loading ? <X size={15} /> : <RefreshCcw size={13} />}</button>
        <form className="noa-browser-address mx-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2" onSubmit={event => { event.preventDefault(); if (addressUrl(address)) event.currentTarget.querySelector('input')?.blur(); void loadBrowser(cwd, tab, address) }}>
          <Globe size={13} className="shrink-0 text-[var(--text-tertiary)]" />
          <input aria-label="Web address" placeholder="Enter a URL or localhost:3000" value={address} onChange={event => setAddress(event.target.value)} onFocus={event => { const input = event.target; setEditing(true); setAddress(tab.url || input.value); requestAnimationFrame(() => input.select()) }} onBlur={() => setEditing(false)} className="min-w-0 flex-1 bg-transparent text-[length:var(--text-chat-sm)] outline-none placeholder:text-[var(--text-tertiary)]" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        </form>
        <button type="button" aria-label="Open in browser" title="Open in browser" disabled={!tab.url} onClick={() => void command('external')} className="noa-browser-action"><ExternalLink size={14} /></button>
      </div>
      <div ref={host} className="relative min-h-0 flex-1 overflow-hidden">
        {(!tab.url || tab.error || tab.loading) && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-[length:var(--text-chat-sm)] text-[var(--text-secondary)]" role={tab.error ? 'alert' : 'status'}>
          <Globe size={32} />
          <span>{tab.error || (tab.url ? 'Loading page…' : 'Open a web page')}</span>
          {!tab.url && !tab.error && <span className="text-[var(--text-tertiary)]">Enter any web address above, or start a server in the terminal to preview it.</span>}
          {tab.error && tab.url && <button type="button" onClick={() => void loadBrowser(cwd, tab)} className="underline underline-offset-2">Retry</button>}
        </div>}
      </div>
    </div>
  )
}
