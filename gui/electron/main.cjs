// Desktop shell: starts the Bun bridge (server/main.ts), serves the
// built UI from it, and shows it in a native window. The bridge is the only
// process that talks to the agent; the window is a plain client of it.
const { app, BrowserWindow, Menu, dialog, nativeImage, shell } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const os = require('os')
const path = require('path')

const GUI_DIR = path.join(__dirname, '..')
const DIST_DIR = path.join(GUI_DIR, 'dist')
const ICON = path.join(__dirname, 'icon.icns')

let bridge = null
let win = null
let quitting = false
let checkingQuit = false
let bridgePort
// NOA_GUI_DEV=1 serves the UI from Vite with hot reload instead of the built dist/.
const DEV = process.env.NOA_GUI_DEV === '1'
const VITE_PORT = 5173
let vite = null

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

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => setZoom(zoom + ZOOM_STEP) },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(zoom - ZOOM_STEP) },
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
  const candidates = [process.env.BUN_PATH, path.join(os.homedir(), '.bun', 'bin', 'bun'), '/opt/homebrew/bin/bun', '/usr/local/bin/bun']
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
  bridge = spawn(findBun(), [...(DEV ? ['--hot'] : []), 'run', 'server/main.ts'], {
    cwd: GUI_DIR,
    env: { ...process.env, NOA_GUI_PORT: String(port) },
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

function createWindow(port) {
  const origin = DEV ? `http://127.0.0.1:${VITE_PORT}` : `http://127.0.0.1:${port}`
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Noa Agent',
    backgroundColor: '#FCFCFB',
    // Same titlebar as the Noa note app: hidden title with the traffic lights centred in a 44px bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  win.loadURL(`${origin}/`)
  // Reload drops the injected CSS variable, so set it again after every page load.
  win.webContents.on('did-finish-load', syncZoom)
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', message: 'Discard unsaved file edits?',
      detail: 'Your file edits have not been saved.',
      buttons: ['Keep editing', 'Discard edits'], defaultId: 0, cancelId: 0,
    })
    if (choice === 1) event.preventDefault()
    else quitting = false
  })

  // Only the bridge origin renders inside the app; any other link opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  win.on('close', (event) => {
    if (!quitting && bridge) {
      event.preventDefault()
      void requestQuit()
    }
  })
  win.on('closed', () => {
    win = null
  })
}

async function requestQuit() {
  if (checkingQuit) return
  checkingQuit = true
  try {
    let detail
    try {
      const response = await fetch(`http://127.0.0.1:${bridgePort}/api/runs`, { signal: AbortSignal.timeout(2000) })
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
  if (process.platform === 'darwin' && fs.existsSync(ICON)) {
    app.dock.setIcon(nativeImage.createFromPath(ICON))
  }
  try {
    createWindow(await startBridge())
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
  bridge?.kill('SIGTERM')
  vite?.kill('SIGTERM')
})
