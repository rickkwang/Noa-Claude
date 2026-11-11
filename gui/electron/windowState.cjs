const fs = require('fs')
const path = require('path')

const EVENTS = ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']
const positive = value => Number.isSafeInteger(value) && value > 0
const rectangle = value => value && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y) && positive(value.width) && positive(value.height)
const same = (a, b) => ['x', 'y', 'width', 'height'].every(key => a[key] === b[key])
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

function fit(bounds, area) {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  return {
    width, height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  }
}

function createWindowState({ app, screen }, defaults) {
  const file = path.join(app.getPath('userData'), 'window-state.json')
  let state = { width: defaults.width, height: defaults.height, isMaximized: false, isFullScreen: false }
  let lastSaved
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (saved && typeof saved === 'object') {
      const sized = positive(saved.width) && positive(saved.height)
      if (sized || saved.isMaximized === true || saved.isFullScreen === true) {
        if (sized) state = { ...state, width: saved.width, height: saved.height }
        if (sized && Number.isSafeInteger(saved.x) && Number.isSafeInteger(saved.y)) state = { ...state, x: saved.x, y: saved.y }
        state.isMaximized = saved.isMaximized === true
        state.isFullScreen = saved.isFullScreen === true
        if (rectangle(saved.displayBounds)) state.displayBounds = saved.displayBounds
      }
    }
    lastSaved = JSON.stringify(state)
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read window state:', error.message)
  }

  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  let display = primary
  let bounds = { width: state.width, height: state.height }
  if (rectangle(state)) {
    bounds = { x: state.x, y: state.y, ...bounds }
    const previous = state.displayBounds
    const exact = previous && displays.find(item => same(item.bounds, previous))
    if (exact) display = exact
    else if (displays.some(item => intersects(bounds, item.bounds))) display = screen.getDisplayMatching(bounds)
    else {
      const matching = previous && displays.filter(item => item.bounds.width === previous.width && item.bounds.height === previous.height)
        .sort((a, b) => (Math.abs(a.bounds.x - previous.x) + Math.abs(a.bounds.y - previous.y)) - (Math.abs(b.bounds.x - previous.x) + Math.abs(b.bounds.y - previous.y)))[0]
      if (matching) {
        display = matching
        bounds.x += display.bounds.x - previous.x
        bounds.y += display.bounds.y - previous.y
      } else {
        bounds.width = Math.min(bounds.width, primary.workArea.width)
        bounds.height = Math.min(bounds.height, primary.workArea.height)
        bounds.x = Math.round(primary.bounds.x + (primary.bounds.width - bounds.width) / 2)
        bounds.y = Math.round(primary.bounds.y + (primary.bounds.height - bounds.height) / 2)
      }
    }
  }
  // Keep the normal minimum size unless the available display itself is smaller.
  const minWidth = Math.min(defaults.minWidth, display.workArea.width)
  const minHeight = Math.min(defaults.minHeight, display.workArea.height)
  bounds.width = Math.min(Math.max(bounds.width, minWidth), display.workArea.width)
  bounds.height = Math.min(Math.max(bounds.height, minHeight), display.workArea.height)
  if (rectangle(bounds)) bounds = fit(bounds, display.workArea)
  state = { ...state, ...bounds }
  const options = { ...bounds, minWidth, minHeight }
  let window
  let timer
  let failed = false

  function save() {
    clearTimeout(timer)
    if (window && !window.isDestroyed() && !window.isMinimized()) {
      const current = window.getBounds()
      const isMaximized = window.isMaximized()
      const isFullScreen = window.isFullScreen()
      state = {
        ...state,
        ...(!isMaximized && !isFullScreen ? current : {}),
        isMaximized, isFullScreen,
        displayBounds: screen.getDisplayMatching(current).bounds,
      }
    }
    const encoded = JSON.stringify(state)
    if (!failed && encoded === lastSaved) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file + '.tmp', encoded + '\n', { mode: 0o600 })
      fs.renameSync(file + '.tmp', file)
      lastSaved = encoded
      failed = false
    } catch (error) {
      failed = true
      console.warn('Could not save window state:', error.message)
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(save, 1000)
  }

  function unmanage() {
    clearTimeout(timer)
    for (const event of EVENTS) window.removeListener(event, schedule)
    window.removeListener('close', save)
    window.removeListener('closed', unmanage)
    window = undefined
  }

  return {
    options,
    manage(next) {
      window = next
      state = { ...state, ...window.getBounds() }
      if (state.isMaximized) window.maximize()
      if (state.isFullScreen) window.setFullScreen(true)
      for (const event of EVENTS) window.on(event, schedule)
      window.on('close', save)
      window.on('closed', unmanage)
    },
    flush: save,
  }
}

module.exports = { createWindowState }
