const { session, shell, WebContentsView } = require('electron')
const { createHash } = require('crypto')

// Any HTTP(S) address without credentials; 0.0.0.0 means this machine.
function webUrl(raw) {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    return url.href
  } catch { return null }
}

// Loopback, link-local, private-network and .local names. URL has already normalized
// numeric IPv4 spellings (2130706433, 0x7f.1) to dotted form.
const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]
function privateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (host.includes(':')) return host === '::1' || host === '::' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:')
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || PRIVATE_V4.some(range => range.test(host))
}
const isPrivate = raw => { try { return privateHost(new URL(raw).hostname) } catch { return false } }

// Preview pages never share the app's localhost authentication cookie or its preload; each project has its own session. Any web
// address can be opened, but a public page may not navigate, redirect or send requests to this
// machine or the private network; only an address the user enters can.
function registerPreview({ ipcMain, getWindow, blockedOrigins }) {
  const pages = new Map()
  const partitions = new Map()
  function allowed(raw) {
    const url = webUrl(raw)
    return url && !(isPrivate(url) && blockedOrigins().some(origin => new URL(origin).port === new URL(url).port)) ? url : null
  }
  // A page-initiated move from a public page into a private address.
  const intoPrivate = (from, to) => !!from && !isPrivate(from) && isPrivate(to)
  const PRIVATE_BLOCKED = 'A public page can’t open local or private-network addresses. Enter the address above to open it.'
  const loadError = url => isPrivate(url) ? 'Could not load this page. Check that the local server is running, then retry.' : 'Could not load this page. Check the address and your connection, then retry.'
  // Bounds are clamped to the window's content so a view never spills past its edge.
  function place(page, x, y, w, h, width, height) {
    x = Math.max(0, Math.min(width, x)); y = Math.max(0, Math.min(height, y))
    w = Math.max(0, Math.min(width - x, w)); h = Math.max(0, Math.min(height - y, h))
    page.layout = { x, y, w, h, width, height }
    page.view.setBounds({ x, y, width: w, height: h })
    page.view.setVisible(w > 0 && h > 0 && page.painted)
  }
  // The renderer reports exact bounds a frame or more after the window resizes; until then each view
  // keeps its distance from the window's right and bottom edges, as the right column does.
  const anchored = new WeakSet()
  function follow(win) {
    if (anchored.has(win)) return
    anchored.add(win)
    const relayout = () => {
      if (win.isDestroyed()) return
      const [width, height] = win.getContentSize()
      for (const page of pages.values()) {
        const layout = page.layout
        if (!layout || page.view.webContents.isDestroyed() || (layout.width === width && layout.height === height)) continue
        const right = layout.width - layout.x - layout.w, bottom = layout.height - layout.y - layout.h
        place(page, width - right - layout.w, layout.y, layout.w, height - bottom - layout.y, width, height)
      }
    }
    win.on('resize', () => { relayout(); setImmediate(relayout) })
  }
  function send(page) {
    const win = getWindow(), contents = page.view.webContents
    if (!win || win.isDestroyed() || contents.isDestroyed()) return
    win.webContents.send('noa:preview-state', {
      id: page.id, url: page.url, title: contents.getTitle(),
      loading: contents.isLoading(), canBack: contents.navigationHistory.canGoBack(),
      canForward: contents.navigationHistory.canGoForward(), error: page.error,
    })
  }
  function close(page) {
    pages.delete(page.id)
    const win = getWindow()
    if (win && !win.isDestroyed()) win.contentView.removeChildView(page.view)
    if (!page.view.webContents.isDestroyed()) page.view.webContents.close()
  }
  function navigate(page, url) {
    page.url = url
    page.pending = url
    page.error = undefined
    void page.view.webContents.loadURL(url).catch(error => {
      if (pages.get(page.id) !== page || page.url !== url || error.code === 'ERR_ABORTED') return
      page.error ??= loadError(url)
      send(page)
    })
  }
  ipcMain.handle('noa:preview', (event, message) => {
    const win = getWindow()
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
    if (!message || typeof message.id !== 'string' || !/^[\da-f-]{36}$/.test(message.id)) return
    let page = pages.get(message.id)
    if (message.action === 'create' && !page) {
      const url = allowed(message.url)
      if (!url || typeof message.cwd !== 'string') return { error: 'Enter an HTTP or HTTPS address. The app’s own server cannot be opened here.' }
      let partition = partitions.get(message.cwd)
      if (!partition) {
        // Persisted per project, as other desktop agents do: the HTTP cache and sign-ins survive restarts.
        partition = session.fromPartition(`persist:noa-preview-${createHash('sha256').update(message.cwd).digest('hex')}`)
        partition.setPermissionRequestHandler((_contents, _permission, respond) => respond(false))
        partition.setPermissionCheckHandler(() => false)
        partition.on('will-download', event => event.preventDefault())
        // Subresources and frames of a public page cannot reach this machine or the private network.
        partition.webRequest.onBeforeRequest((details, respond) => {
          const owner = [...pages.values()].find(page => !page.view.webContents.isDestroyed() && page.view.webContents.id === details.webContentsId)
          respond({ cancel: details.resourceType !== 'mainFrame' && !!owner && intoPrivate(owner.url, details.url) })
        })
        partitions.set(message.cwd, partition)
      }
      follow(win)
      const view = new WebContentsView({ webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } })
      page = { id: message.id, view, url, painted: false }
      pages.set(page.id, page)
      view.setVisible(false)
      win.contentView.addChildView(view)
      const current = page, contents = view.webContents
      contents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        const key = input.key.toLowerCase()
        const appShortcut = (input.meta || input.control) && (['n', 'k', ','].includes(key) || key === 'j' && !input.shift && !input.alt)
        const terminalShortcut = input.control && !input.meta && !input.alt && input.code === 'Backquote'
        if (!appShortcut && !terminalShortcut) return
        event.preventDefault()
        win.webContents.send('noa:preview-shortcut', { key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt })
      })
      for (const name of ['did-start-loading', 'did-stop-loading', 'page-title-updated']) contents.on(name, () => send(current))
      // A new view stays hidden until its first document is ready, so the panel's loading state shows
      // instead of a blank white rectangle; later navigations keep the previous page until the next commits.
      const reveal = () => {
        if (current.painted) return
        current.painted = true
        const layout = current.layout
        if (layout) current.view.setVisible(layout.w > 0 && layout.h > 0)
      }
      contents.on('dom-ready', reveal)
      contents.on('did-fail-load', (_event, _code, _description, _url, mainFrame) => { if (mainFrame) reveal() })
      contents.on('did-navigate', (_event, url) => {
        if (allowed(url)) { current.url = url; current.pending = url; current.error = undefined }
        send(current)
      })
      contents.on('did-navigate-in-page', (_event, url, mainFrame) => {
        if (mainFrame && allowed(url)) { current.url = url; current.error = undefined }
        send(current)
      })
      contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
        if (mainFrame && code !== -3) {
          if (allowed(url)) current.url = url
          current.error ??= loadError(url)
          send(current)
        }
      })
      // Electron silently cancels leaving a page whose beforeunload asks to stay; the toolbar's Back,
      // Reload and address bar would then do nothing, so the panel always lets the page go.
      contents.on('will-prevent-unload', event => event.preventDefault())
      contents.on('render-process-gone', () => { current.error = 'This page stopped responding. Reload to try again.'; send(current) })
      // Links and scripts start from the committed page; a redirect continues from the address it left.
      for (const name of ['will-navigate', 'will-redirect']) contents.on(name, (event, target, _inPlace, mainFrame = true) => {
        const from = name === 'will-redirect' && mainFrame ? current.pending ?? current.url : current.url
        const blocked = !allowed(target) ? 'This address can’t be opened here.' : intoPrivate(from, target) ? PRIVATE_BLOCKED : undefined
        if (blocked) {
          event.preventDefault()
          if (!mainFrame) return
          current.error = blocked
          send(current)
        } else if (mainFrame) { current.pending = target; current.error = undefined }
      })
      contents.setWindowOpenHandler(({ url }) => {
        const target = allowed(url)
        if (target && !intoPrivate(current.url, target)) navigate(current, target)
        else if (target) { current.error = PRIVATE_BLOCKED; send(current) }
        return { action: 'deny' }
      })
      navigate(page, url)
    }
    if (!page) return
    const contents = page.view.webContents
    switch (message.action) {
      case 'navigate': {
        const url = allowed(message.url)
        if (!url) return { error: 'Enter an HTTP or HTTPS address. The app’s own server cannot be opened here.' }
        navigate(page, url)
        break
      }
      case 'bounds': {
        const rect = message.rect
        if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) { page.layout = undefined; page.view.setVisible(false); return }
        const scale = win.webContents.getZoomFactor(), [width, height] = win.getContentSize()
        let x = Math.round(rect.x * scale), y = Math.round(rect.y * scale), w = Math.round(rect.width * scale), h = Math.round(rect.height * scale)
        // During a live resize the renderer measures for a window size that has already changed. Its rect
        // still has the panel's latest width, so keep that and re-anchor it to the right and bottom edges.
        const viewport = Array.isArray(message.viewport) && message.viewport.every(Number.isFinite) ? message.viewport.map(n => Math.round(n * scale)) : [width, height]
        if (Math.abs(viewport[0] - width) > 2) x = width - (viewport[0] - x - w) - w
        if (Math.abs(viewport[1] - height) > 2) h = height - (viewport[1] - y - h) - y
        place(page, x, y, w, h, width, height)
        return
      }
      case 'back': if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break
      case 'forward': if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break
      case 'reload': navigate(page, page.url); break
      case 'stop': contents.stop(); break
      case 'close': close(page); return
      case 'external': void shell.openExternal(page.url); break
    }
    send(page)
  })
  return () => { for (const page of pages.values()) close(page) }
}

module.exports = { registerPreview }
