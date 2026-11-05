export interface BrowserTab {
  id: string
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  error?: string
}

interface ProjectBrowser {
  tabs: BrowserTab[]
  active?: string
  suggested: string[]
  dismissed: Set<string>
}

const projects = new Map<string, ProjectBrowser>()
const listeners = new Set<() => void>()
const created = new Set<string>()
let version = 0

export function projectBrowser(cwd: string): ProjectBrowser {
  let project = projects.get(cwd)
  if (!project) { project = { tabs: [], suggested: [], dismissed: new Set() }; projects.set(cwd, project) }
  return project
}

function changed() { version++; for (const listener of listeners) listener() }
export function subscribeBrowser(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function browserVersion() { return version }

export function localWebUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) return
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    if (typeof location !== 'undefined' && url.origin === location.origin) return
    return url.href
  } catch { return }
}

// Any HTTP(S) address the Browser tab may open, except the app's own origin.
function webUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    if (typeof location !== 'undefined' && url.origin === location.origin) return
    return url.href
  } catch { return }
}

// What the address bar opens: a full URL as typed; otherwise http:// for this machine or the private network and https:// elsewhere.
// A bare word (no dot, port or brackets) is not treated as a host; one with a port (a container name) is local.
export function addressUrl(raw: string): string | undefined {
  const text = raw.trim()
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(text)) return webUrl(text)
  if (!text || /\s/.test(text)) return
  try {
    const { hostname, port } = new URL(`http://${text}`)
    const local = hostname === 'localhost' || /\.(localhost|local)$/.test(hostname) || hostname === '0.0.0.0' || hostname === '[::1]' || /^(127|10)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    const single = !hostname.includes('.') && !hostname.startsWith('[')
    if (!local && single && !port) return
    return webUrl(`${local || single ? 'http' : 'https'}://${text}`)
  } catch { return }
}

export function localWebUrls(text: string, complete = true): string[] {
  // Strip terminal colour/OSC sequences before scanning; an unfinished URL waits for the next output chunk.
  const plain = text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  const urls = new Set<string>()
  for (const match of plain.matchAll(/https?:\/\/[^\s<>"'`\x1b]+/gi)) {
    if (!complete && match.index! + match[0].length === plain.length) continue
    const url = localWebUrl(match[0].replace(/[.,;!?)\]}]+$/, ''))
    if (url) urls.add(url)
  }
  return [...urls]
}

export function suggestWebUrls(cwd: string, text: string) {
  const project = projectBrowser(cwd)
  const added = localWebUrls(text, false).filter(url => !project.suggested.includes(url))
  if (added.length) { project.suggested.push(...added); changed() }
}

export function dismissWebUrl(cwd: string, url: string) { projectBrowser(cwd).dismissed.add(url); changed() }

export function openBrowser(cwd: string, raw?: string) {
  const url = raw ? localWebUrl(raw) : ''
  if (raw && !url) return
  const project = projectBrowser(cwd)
  let tab = url ? project.tabs.find(tab => tab.url === url) : undefined
  if (!tab) {
    tab = { id: crypto.randomUUID(), url: url ?? '', title: '', loading: false, canBack: false, canForward: false }
    project.tabs.push(tab)
  }
  project.active = tab.id
  changed()
  window.dispatchEvent(new CustomEvent('noa:open-browser', { detail: { cwd } }))
}

export async function loadBrowser(cwd: string, tab: BrowserTab, raw = tab.url) {
  const url = addressUrl(raw)
  if (!url) { updateBrowser(tab.id, { error: 'Enter a web address, such as example.com or localhost:3000.' }); return }
  const preview = window.noaDesktop?.preview
  if (!preview) return
  const action = created.has(tab.id) ? 'navigate' : 'create'
  created.add(tab.id)
  updateBrowser(tab.id, { url, error: undefined, loading: true })
  try {
    const result = await preview.command({ action, id: tab.id, cwd, url })
    if (result?.error) {
      if (action === 'create') created.delete(tab.id)
      updateBrowser(tab.id, { error: result.error, loading: false })
    }
  } catch {
    if (action === 'create') created.delete(tab.id)
    updateBrowser(tab.id, { error: 'Could not open the preview. Try again.', loading: false })
  }
}

export function ensureBrowser(cwd: string, tab: BrowserTab) { if (tab.url && !created.has(tab.id)) void loadBrowser(cwd, tab) }

export function selectBrowser(cwd: string, id: string) { projectBrowser(cwd).active = id; changed() }
export function closeBrowser(cwd: string, id: string) {
  const project = projectBrowser(cwd), index = project.tabs.findIndex(tab => tab.id === id)
  project.tabs = project.tabs.filter(tab => tab.id !== id)
  if (project.active === id) project.active = project.tabs[Math.min(index, project.tabs.length - 1)]?.id
  void window.noaDesktop?.preview?.command({ action: 'close', id })
  created.delete(id)
  changed()
}

function updateBrowser(id: string, state: Partial<BrowserTab>) {
  for (const project of projects.values()) {
    const tab = project.tabs.find(tab => tab.id === id)
    if (tab) { Object.assign(tab, state); changed(); return }
  }
}

if (typeof window !== 'undefined') window.noaDesktop?.preview?.subscribe(state => updateBrowser(state.id, state))
