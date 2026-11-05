const { session, shell, WebContentsView } = require('electron')
const { createHash } = require('crypto')

function localUrl(raw) {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) return null
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    return url.href
  } catch { return null }
}

// Preview pages never share the app's localhost authentication cookie or its preload.
function registerPreview({ ipcMain, getWindow, blockedOrigins }) {
  const pages = new Map()
  const partitions = new Map()
  function allowed(raw) {
    const url = localUrl(raw)
    return url && !blockedOrigins().some(origin => new URL(origin).port === new URL(url).port) ? url : null
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
    page.error = undefined
    void page.view.webContents.loadURL(url).catch(error => {
      if (pages.get(page.id) !== page || page.url !== url || error.code === 'ERR_ABORTED') return
      page.error ??= 'Could not load this page. Check that the local server is running, then retry.'
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
      if (!url || typeof message.cwd !== 'string') return { error: 'Enter a local HTTP or HTTPS address. The app’s own server cannot be previewed.' }
      let partition = partitions.get(message.cwd)
      if (!partition) {
        partition = session.fromPartition(`noa-preview-${createHash('sha256').update(message.cwd).digest('hex')}`)
        partition.setPermissionRequestHandler((_contents, _permission, respond) => respond(false))
        partition.setPermissionCheckHandler(() => false)
        partition.on('will-download', event => event.preventDefault())
        partitions.set(message.cwd, partition)
      }
      const view = new WebContentsView({ webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } })
      page = { id: message.id, view, url }
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
      contents.on('did-navigate', (_event, url) => {
        if (allowed(url)) { current.url = url; current.error = undefined }
        send(current)
      })
      contents.on('did-navigate-in-page', (_event, url, mainFrame) => {
        if (mainFrame && allowed(url)) { current.url = url; current.error = undefined }
        send(current)
      })
      contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
        if (mainFrame && code !== -3) {
          if (allowed(url)) current.url = url
          current.error ??= 'Could not load this page. Check that the local server is running, then retry.'
          send(current)
        }
      })
      contents.on('render-process-gone', () => { current.error = 'This page stopped responding. Reload to try again.'; send(current) })
      for (const name of ['will-navigate', 'will-redirect']) contents.on(name, (event, target, _inPlace, mainFrame = true) => {
        if (!allowed(target)) {
          event.preventDefault()
          if (!mainFrame) return
          current.error = 'This preview only opens local web pages. Open external sites in your browser.'
          send(current)
        } else if (mainFrame) current.error = undefined
      })
      contents.setWindowOpenHandler(({ url }) => {
        const target = allowed(url)
        if (target) navigate(current, target)
        return { action: 'deny' }
      })
      navigate(page, url)
    }
    if (!page) return
    const contents = page.view.webContents
    switch (message.action) {
      case 'navigate': {
        const url = allowed(message.url)
        if (!url) return { error: 'Enter a local HTTP or HTTPS address. The app’s own server cannot be previewed.' }
        navigate(page, url)
        break
      }
      case 'bounds': {
        const rect = message.rect
        if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) { page.view.setVisible(false); return }
        const scale = win.webContents.getZoomFactor(), [width, height] = win.getContentSize()
        const x = Math.max(0, Math.min(width, Math.round(rect.x * scale))), y = Math.max(0, Math.min(height, Math.round(rect.y * scale)))
        const w = Math.max(0, Math.min(width - x, Math.round(rect.width * scale))), h = Math.max(0, Math.min(height - y, Math.round(rect.height * scale)))
        page.view.setBounds({ x, y, width: w, height: h })
        page.view.setVisible(w > 0 && h > 0)
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
