// Desktop shell: starts the Bun bridge (server/main.ts), serves the
// built UI from it, and shows it in a native window. The bridge is the only
// process that talks to the agent; the window is a plain client of it.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme, screen, session, shell } = require('electron')
const { spawn } = require('child_process')
const { randomBytes } = require('crypto')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')
const { createNotifier } = require('./notifications.cjs')
const { createWindowState } = require('./windowState.cjs')
const { registerPreview } = require('./preview.cjs')
const { checkForUpdate } = require('./updateCheck.cjs')
const { prepareMacUpdate, pruneStagedUpdates } = require('./macUpdateInstaller.cjs')
const { autoUpdater } = require('electron-updater')

// A packaged app keeps the bridge and UI beside the repo runtime in Resources (see scripts/prepare-desktop-runtime.mjs).
const GUI_DIR = app.isPackaged ? path.join(process.resourcesPath, 'repo', 'gui') : path.join(__dirname, '..')
const DIST_DIR = path.join(GUI_DIR, 'dist')
// File search runs `rg` from PATH. A Finder launch has a minimal PATH, so put the ripgrep bundled in
// Resources first; the bridge and agent processes inherit it. Codex does the same with its codex-path dir.
if (app.isPackaged) process.env.PATH = [path.join(process.resourcesPath, 'rg'), process.env.PATH].filter(Boolean).join(path.delimiter)

let bridge = null
let win = null
let windowState = null
let quitting = false
// A verified update, staged while the app runs; its install script starts at quit only once the user chose Update.
let pendingInstall = null
let installRequested = false
// What the sidebar update button shows: idle, downloading (with percent), ready, or installing.
let updateState = { status: 'idle' }
// The check (and download) in progress; a manual check joins it instead of starting another.
let updateCheck = null
let checkingQuit = false
let bridgePort
// Every bridge request must carry this; other local processes do not know it.
const BRIDGE_TOKEN = randomBytes(32).toString('hex')
const notifier = createNotifier({
  listRuns: async () => {
    const response = await fetch(`http://127.0.0.1:${bridgePort}/api/runs`, {
      headers: { authorization: `Bearer ${BRIDGE_TOKEN}` },
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok) throw new Error('Could not read task status')
    return response.json()
  },
  getWindow: () => win,
})
// NOA_GUI_DEV=1 serves the UI from Vite with hot reload instead of the built dist/.
const DEV = process.env.NOA_GUI_DEV === '1'
const VITE_PORT = 5173
let vite = null
const closePreviews = registerPreview({ ipcMain, getWindow: () => win, blockedOrigins: () => [`http://127.0.0.1:${bridgePort}`, ...(DEV ? [`http://127.0.0.1:${VITE_PORT}`] : [])] })

// Page zoom goes through Electron's zoom factor, not the default Cmd+/- roles, so the renderer
// can be told the factor. noa.css reads --noa-zoom-factor to keep the traffic-light clearance fixed
// while content shrinks below 1.
const ZOOM_MIN = 0.5
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
let zoom = 1

function syncZoom() {
  if (!win) return
  win.webContents.setZoomFactor(zoom)
  win.webContents.executeJavaScript(`document.documentElement.style.setProperty('--noa-zoom-factor', '${zoom}')`).catch(() => {})
}

function setZoom(next) {
  zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100
  syncZoom()
}

// Only packaged builds check for updates; a development build is not a release. A development build may
// pretend to be an older version to exercise the check and download, but it never installs.
const UPDATE_TEST_VERSION = app.isPackaged ? undefined : process.env.NOA_UPDATE_TEST_VERSION
const UPDATES_ENABLED = (app.isPackaged || !!UPDATE_TEST_VERSION) && process.env.DISABLE_UPDATES !== '1'
const UPDATE_RECHECK_MS = 15 * 60 * 1000
// electron-updater only reads the release metadata; macUpdateInstaller downloads, verifies and swaps the app.
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
if (UPDATE_TEST_VERSION) autoUpdater.forceDevUpdateConfig = true

function setUpdateState(next) {
  updateState = next
  if (win && !win.isDestroyed()) win.webContents.send('noa:update-state', next)
}

function showDialog(options) {
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
}

// Finds the newest desktop release and downloads it in the background; the sidebar button offers the
// install once it is verified. The release metadata (latest-mac.yml, with the zip sha512) is read by
// electron-updater from that release.
async function runUpdateCheck() {
  const update = await checkForUpdate(UPDATE_TEST_VERSION || app.getVersion())
  if (!update) {
    // Nothing newer: any staged update is installed or superseded.
    await pruneStagedUpdates(app)
    return { status: 'up-to-date' }
  }
  const { version } = update
  setUpdateState({ status: 'downloading', version, percent: 0 })
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: update.feedUrl })
    const { updateInfo } = await autoUpdater.checkForUpdates()
    pendingInstall = await prepareMacUpdate({
      app,
      updateInfo,
      onProgress: (percent) => { if (percent !== updateState.percent) setUpdateState({ status: 'downloading', version, percent }) },
    })
    setUpdateState({ status: 'ready', version })
    return { status: 'ready', version }
  } catch (err) {
    setUpdateState({ status: 'idle' })
    err.releaseUrl = update.url
    throw err
  }
}

async function checkForUpdates({ manual }) {
  if (updateState.status === 'installing') return
  if (updateState.status === 'ready') {
    if (manual) void showDialog({ type: 'info', message: `Noa Agent ${updateState.version} is ready to install.`, detail: 'Use the Update button next to Settings.', buttons: ['OK'] })
    return
  }
  updateCheck ??= runUpdateCheck().finally(() => { updateCheck = null })
  let result
  try {
    result = await updateCheck
  } catch (err) {
    if (!manual) return
    if (!err.releaseUrl) {
      dialog.showErrorBox('Could not check for updates', String(err.message ?? err))
      return
    }
    const { response } = await showDialog({
      type: 'error',
      message: 'Could not download the update',
      detail: String(err.message ?? err),
      buttons: ['Download', 'OK'], defaultId: 0, cancelId: 1,
    })
    if (response === 0) openExternalSafe(err.releaseUrl)
    return
  }
  if (!manual) return
  if (result.status === 'up-to-date') {
    void showDialog({ type: 'info', message: 'Noa Agent is up to date', detail: `Version ${app.getVersion()} is the latest release.`, buttons: ['OK'] })
  } else {
    void showDialog({ type: 'info', message: `Noa Agent ${result.version} is ready to install.`, detail: 'Use the Update button next to Settings.', buttons: ['OK'] })
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          ...(UPDATES_ENABLED ? [{ type: 'separator' }, { label: 'Check for Updates…', click: () => checkForUpdates({ manual: true }) }] : []),
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => setZoom(zoom + ZOOM_STEP) },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(zoom - ZOOM_STEP) },
          { type: 'separator' },
          // The agent runtimes live in the local server, so reloading the window keeps running tasks.
          { role: 'reload' },
          ...(DEV ? [{ role: 'toggleDevTools' }] : []),
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
}

app.setName('Noa Agent')
// Keep this shell's profile apart from the Noa note app, which uses the default "Noa" folder.
app.setPath('userData', path.join(app.getPath('appData'), 'Noa Agent'))
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore()
  win?.focus()
})

// Electron launched from Finder has a minimal PATH, so look for bun in the usual places.
function findBun() {
  const bundled = path.join(process.resourcesPath, 'bun', 'bun')
  const candidates = [app.isPackaged ? bundled : null, process.env.BUN_PATH, path.join(os.homedir(), '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun']
  return candidates.find((p) => p && fs.existsSync(p)) ?? 'bun'
}

function freePort(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function waitForBridge(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('The local bridge did not start in time.'))
        else setTimeout(attempt, 100)
      })
    }
    attempt()
  })
}

async function startBridge() {
  if (!DEV && !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error('The UI is not built. Run `bun run build` in gui/ first.')
  }
  // Browser storage includes the port in its origin; keep the desktop address stable.
  const port = await freePort(DEV ? 0 : 18787)
  // A packaged app ships the bridge bundled into one file (scripts/prepare-desktop-runtime.mjs).
  bridge = spawn(findBun(), [...(DEV ? ['--hot'] : []), 'run', app.isPackaged ? 'server/main.js' : 'server/main.ts'], {
    cwd: GUI_DIR,
    // A packaged app has no project of its own, so it starts in the home folder, not the bundled repo.
    env: { ...process.env, NOA_GUI_PORT: String(port), NOA_GUI_TOKEN: BRIDGE_TOKEN, ...(app.isPackaged ? { NOA_GUI_DEFAULT_CWD: app.getPath('home') } : {}) },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  bridge.on('exit', (code) => {
    bridge = null
    if (!quitting) {
      dialog.showErrorBox('Noa Agent stopped', `The local bridge exited (code ${code ?? 'null'}).`)
      app.quit()
    }
  })
  await waitForBridge(port)
  bridgePort = port
  // Cookies ignore the port, so one cookie covers the bridge and the Vite dev origin.
  await session.defaultSession.cookies.set({
    url: 'http://127.0.0.1', name: 'noa_token', value: BRIDGE_TOKEN, httpOnly: true, sameSite: 'strict',
  })
  if (DEV) {
    // The Vite proxy reads NOA_GUI_PORT, so it follows the bridge's free port.
    vite = spawn(findBun(), ['x', 'vite', '--host', '127.0.0.1', '--port', String(VITE_PORT), '--strictPort'], {
      cwd: GUI_DIR,
      env: { ...process.env, NOA_GUI_PORT: String(port) },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    await waitForBridge(VITE_PORT)
  }
  return port
}

function isHttpUrl(raw) {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isSameOrigin(raw, expectedOrigin) {
  try {
    return new URL(raw).origin === expectedOrigin
  } catch {
    return false
  }
}

function openExternalSafe(url) {
  if (isHttpUrl(url)) shell.openExternal(url)
}

function createWindow(port) {
  const origin = DEV ? `http://127.0.0.1:${VITE_PORT}` : `http://127.0.0.1:${port}`
  const area = screen.getPrimaryDisplay().workArea
  windowState = createWindowState({ app, screen }, {
    width: Math.min(1440, Math.round(area.width * 0.9)),
    height: Math.min(900, Math.round(area.height * 0.9)),
    minWidth: 960, minHeight: 600,
  })
  win = new BrowserWindow({
    ...windowState.options,
    title: 'Noa Agent',
    backgroundColor: '#FCFCFB',
    // Creation-only: pins the material active so a focus change does not swap it for the pale inactive one.
    ...(process.platform === 'darwin' ? { visualEffectState: 'active' } : {}),
    // Same titlebar as the Noa note app: hidden title with the traffic lights centred in a 44px bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  })

  windowState.manage(win)
  win.loadURL(`${origin}/`)
  win.webContents.on('did-navigate', closePreviews)
  // Reload drops the injected CSS variable, so set it again after every page load.
  win.webContents.on('did-finish-load', syncZoom)
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', message: 'Discard unsaved file edits?',
      detail: 'Your file edits have not been saved.',
      buttons: ['Keep editing', 'Discard edits'], defaultId: 0, cancelId: 0,
    })
    if (choice === 1) event.preventDefault()
    else {
      quitting = false
      // Keeping the edits cancels an update's quit too; offer the update again instead of leaving it installing.
      if (installRequested) {
        installRequested = false
        setUpdateState({ status: 'ready', version: updateState.version })
      }
    }
  })

  // Only the bridge origin renders inside the app; any other http(s) link opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, origin)) {
      event.preventDefault()
      openExternalSafe(url)
    }
  })

  win.on('close', (event) => {
    if (!quitting && bridge) {
      event.preventDefault()
      void requestQuit()
    }
  })
  win.on('focus', () => notifier.clearBadge())
  win.on('closed', () => {
    closePreviews()
    win = null
  })
}

async function selectProjectDirectories(event, multiple) {
  if (!win || event.sender !== win.webContents) return []
  const result = await dialog.showOpenDialog(win, {
    title: 'Add project folder',
    properties: ['openDirectory', 'createDirectory', ...(multiple ? ['multiSelections'] : [])],
  })
  return result.canceled ? [] : result.filePaths
}

// The renderer paints the sidebar translucent itself; the shell only decides whether the window has a
// native material behind it. macOS is the only platform this shell targets, so that is the support line.
// The material renders in the native appearance, so that follows the app theme: otherwise a dark app on a light
// system tints a light material and the sidebar goes grey.
const THEME_SOURCES = new Set(['system', 'light', 'dark'])

let lastWindowAppearance = ''

function applySidebarTranslucency(enabled, surfaceColor, theme) {
  if (!win || win.isDestroyed()) return
  if (process.platform !== 'darwin') return
  // The renderer re-sends this on every theme or contrast tweak; only a real change should touch the native window.
  const next = `${enabled}|${surfaceColor}|${theme}`
  if (next === lastWindowAppearance) return
  lastWindowAppearance = next
  nativeTheme.themeSource = theme
  win.setVibrancy(enabled ? 'menu' : null, { animationDuration: 160 })
  win.setBackgroundColor(enabled ? '#00000000' : surfaceColor)
}

ipcMain.handle('noa:set-sidebar-translucency', (event, enabled, surfaceColor, theme) => {
  if (!win || event.sender !== win.webContents || !THEME_SOURCES.has(theme)) return
  applySidebarTranslucency(enabled === true, typeof surfaceColor === 'string' ? surfaceColor : '#FCFCFB', theme)
})
ipcMain.handle('noa:configure-notifications', (event, settings) => {
  if (!win || event.sender !== win.webContents) return
  notifier.configure(settings)
})
// What a file card in the composer shows: whether the path is a folder, and its system thumbnail if it has one.
ipcMain.handle('noa:file-info', async (event, filePath) => {
  if (!win || event.sender !== win.webContents || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return
  const stat = await fs.promises.stat(filePath).catch(() => undefined)
  if (!stat) return
  if (stat.isDirectory() || process.platform !== 'darwin' && process.platform !== 'win32') return { directory: stat.isDirectory() }
  const image = await nativeImage.createThumbnailFromPath(filePath, { width: 352, height: 352 }).catch(() => undefined)
  return { directory: false, thumbnail: image && !image.isEmpty() ? image.toDataURL() : undefined }
})
ipcMain.handle('noa:update-state', (event) => (win && event.sender === win.webContents ? updateState : undefined))
// The renderer has already asked the user to confirm, and that prompt says running tasks stop,
// so the quit skips the running-task check.
ipcMain.handle('noa:update-install', (event) => {
  if (!win || event.sender !== win.webContents || updateState.status !== 'ready' || !pendingInstall) return
  if (!app.isPackaged) return
  // Staged files removed since the download (e.g. by a cleanup tool): fetch the update again instead of
  // quitting into an install that cannot run.
  if (!pendingInstall.isStaged()) {
    pendingInstall = null
    setUpdateState({ status: 'idle' })
    void checkForUpdates({ manual: false })
    return
  }
  installRequested = true
  setUpdateState({ status: 'installing', version: updateState.version })
  quitting = true
  app.quit()
})
ipcMain.handle('noa:select-project-directories', (event) => selectProjectDirectories(event, true))
ipcMain.handle('noa:select-project-directory', async (event) =>
  (await selectProjectDirectories(event, false))[0],
)

async function requestQuit() {
  if (checkingQuit) return
  checkingQuit = true
  try {
    let detail
    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}/api/runs`, {
        headers: { authorization: `Bearer ${BRIDGE_TOKEN}` },
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) throw new Error('Could not read task status')
      const runs = await response.json()
      const queued = runs.reduce((total, run) => total + run.queued, 0)
      if (queued || runs.some((run) => run.busy || run.waiting))
        detail = `Quitting stops running tasks and discards ${queued} queued message${queued === 1 ? '' : 's'}. Queued messages are not saved.`
    } catch {
      detail = 'Noa could not check task status. Quitting may stop running tasks and discard queued messages.'
    }
    if (detail && (await dialog.showMessageBox(win, {
      type: 'warning', message: 'Quit Noa Agent?', detail,
      buttons: ['Keep open', 'Quit and discard'], defaultId: 0, cancelId: 0,
    })).response !== 1) return
    quitting = true
    app.quit()
  } finally {
    checkingQuit = false
  }
}

if (primaryInstance) app.whenReady().then(async () => {
  buildMenu()
  try {
    createWindow(await startBridge())
    notifier.start()
    if (UPDATES_ENABLED) {
      setTimeout(() => checkForUpdates({ manual: false }).catch(() => {}), 5000)
      setInterval(() => checkForUpdates({ manual: false }).catch(() => {}), UPDATE_RECHECK_MS)
    }
  } catch (err) {
    dialog.showErrorBox('Noa Agent could not start', String(err.message ?? err))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', (event) => {
  if (!quitting && win && bridge) {
    event.preventDefault()
    void requestQuit()
    return
  }
  quitting = true
})

app.on('will-quit', () => {
  windowState?.flush()
  bridge?.kill('SIGTERM')
  vite?.kill('SIGTERM')
  if (installRequested) pendingInstall?.launch()
  else pendingInstall?.discard()
})
