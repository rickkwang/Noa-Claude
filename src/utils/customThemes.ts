/**
 * Custom themes: user-authored JSON files in `<config>/themes/*.json` and
 * plugin-provided themes, each a set of color overrides layered on top of a
 * built-in base theme. A custom theme is selected by storing
 * `custom:<slug>` as the `theme` setting (see customThemeRef).
 *
 * Ported from upstream Claude Code 2.1.220. Upstream gates the whole
 * subsystem behind safe mode; this fork has no safe-mode concept, so that
 * gate is intentionally absent (documented in FEATURES.md).
 */

import chokidar from 'chokidar'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage } from './errors.js'
import { getTheme, THEME_NAMES, type Theme, type ThemeName } from './theme.js'

export type CustomThemeSource = 'user' | { plugin: string }

export type CustomTheme = {
  slug: string
  name: string
  base: ThemeName
  overrides: Partial<Theme>
  source: CustomThemeSource
}

const CUSTOM_THEME_PREFIX = 'custom:'
const MAX_THEME_FILE_BYTES = 256 * 1024

export function customThemeRef(slug: string): `custom:${string}` {
  return `${CUSTOM_THEME_PREFIX}${slug}`
}

/** Inverse of customThemeRef — returns the slug, or null for plain settings. */
export function parseCustomThemeRef(setting: string): string | null {
  return setting.startsWith(CUSTOM_THEME_PREFIX)
    ? setting.slice(CUSTOM_THEME_PREFIX.length)
    : null
}

export function isThemeName(value: unknown): value is ThemeName {
  return (
    typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value)
  )
}

const ANSI_COLOR_NAMES = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
])

/**
 * Validates an override color value. Accepts the same formats the ink
 * renderer's colorize() understands: rgb(r,g,b), #rgb/#rrggbb, ansi256(n),
 * ansi:name.
 */
export function isValidThemeColor(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (/^rgb\(\s?\d{1,3},\s?\d{1,3},\s?\d{1,3}\s?\)$/.test(value)) return true
  if (/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value))
    return true
  if (/^ansi256\(\d{1,3}\)$/.test(value)) return true
  if (value.startsWith('ansi:')) return ANSI_COLOR_NAMES.has(value.slice(5))
  return false
}

/**
 * Layer overrides onto a base palette. Unknown keys and invalid colors are
 * dropped so a hand-edited theme file can't crash rendering.
 */
export function mergeThemeOverrides(
  base: Theme,
  overrides: Partial<Theme> | null | undefined,
): Theme {
  if (!overrides) return base
  const merged = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (Object.hasOwn(base, key) && isValidThemeColor(value)) {
      merged[key as keyof Theme] = value
    }
  }
  return merged
}

export function slugifyThemeName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'theme'
  )
}

/** Slug for a new theme, suffixed -2/-3/… when already taken. */
export function dedupeThemeSlug(
  name: string,
  existing: readonly CustomTheme[],
): string {
  const base = slugifyThemeName(name)
  if (!existing.some(theme => theme.slug === base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!existing.some(theme => theme.slug === candidate)) return candidate
  }
}

export function getThemesDir(): string {
  return join(getClaudeConfigHomeDir(), 'themes')
}

function parseThemeJson(
  slug: string,
  raw: string,
  source: CustomThemeSource,
): CustomTheme | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logForDebugging(`[theme] ${slug}.json: invalid JSON`, { level: 'warn' })
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  const obj = parsed as { base?: unknown; name?: unknown; overrides?: unknown }
  const base = isThemeName(obj.base) ? obj.base : 'dark'
  const name = typeof obj.name === 'string' ? obj.name : slug
  const overrides: Partial<Theme> = {}
  if (typeof obj.overrides === 'object' && obj.overrides !== null) {
    const baseTheme = getTheme(base)
    for (const [key, value] of Object.entries(obj.overrides)) {
      if (Object.hasOwn(baseTheme, key) && isValidThemeColor(value)) {
        overrides[key as keyof Theme] = value
      }
    }
  }
  return { slug, name, base, overrides, source }
}

async function readThemeFile(
  filePath: string,
  slug: string,
  source: CustomThemeSource,
): Promise<CustomTheme | undefined> {
  let raw: string
  try {
    if ((await stat(filePath)).size > MAX_THEME_FILE_BYTES) {
      logForDebugging(`[theme] ${filePath} exceeds 256KB; skipping`, {
        level: 'warn',
      })
      return undefined
    }
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logForDebugging(`[theme] failed to read ${filePath}`, { level: 'warn' })
    }
    return undefined
  }
  return parseThemeJson(slug, raw, source)
}

/**
 * Read every *.json theme in a directory. A file path is also accepted
 * (loaded as a single theme). Missing paths yield [].
 */
export async function readThemesFromPathAsync(
  themesPath: string,
  source: CustomThemeSource,
  slugPrefix = '',
): Promise<CustomTheme[]> {
  let entries: string[]
  try {
    entries = await readdir(themesPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOTDIR') {
      const theme = await readThemeFile(
        themesPath,
        slugPrefix + basename(themesPath, '.json'),
        source,
      )
      return theme ? [theme] : []
    }
    if (code !== 'ENOENT') {
      logForDebugging(`[theme] readdir ${themesPath} failed`, {
        level: 'warn',
      })
    }
    return []
  }
  const themes: CustomTheme[] = []
  for (const entry of entries) {
    if (extname(entry) !== '.json') continue
    const theme = await readThemeFile(
      join(themesPath, entry),
      slugPrefix + basename(entry, '.json'),
      source,
    )
    if (theme) themes.push(theme)
  }
  return themes
}

export async function saveCustomTheme(theme: CustomTheme): Promise<void> {
  await mkdir(getThemesDir(), { recursive: true })
  await writeFile(
    join(getThemesDir(), `${theme.slug}.json`),
    JSON.stringify(
      { name: theme.name, base: theme.base, overrides: theme.overrides },
      null,
      2,
    ) + '\n',
    'utf8',
  )
}

/** Watch the user themes dir for add/change/unlink. Returns an unwatch fn. */
export function watchCustomThemes(onChange: () => void): () => void {
  const watcher = chokidar.watch(getThemesDir(), {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    ignorePermissionErrors: true,
  })
  watcher.on('add', onChange)
  watcher.on('change', onChange)
  watcher.on('unlink', onChange)
  watcher.on('error', error => {
    logForDebugging(`[theme] watcher error: ${errorMessage(error)}`, {
      level: 'warn',
    })
  })
  return () => void watcher.close()
}

type Listener = () => void

function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<Listener>()
  return {
    getState: (): T => state,
    setState: (next: T): void => {
      if (Object.is(next, state)) return
      state = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: Listener): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Themes contributed by enabled plugins, populated by loadPluginThemes().
 * Subscribed to by the ThemeProvider via useSyncExternalStore.
 */
export const pluginThemesStore = createStore<readonly CustomTheme[]>([])

// slug → base name, covering user AND plugin themes. resolveThemeSetting()
// consults this to map a `custom:<slug>` setting to a renderable ThemeName.
let baseCache: Map<string, ThemeName> | undefined
let cachedUserThemes: readonly CustomTheme[] | undefined
let loadInFlight: Promise<readonly CustomTheme[]> | undefined

export function getCustomThemeBase(slug: string): ThemeName | undefined {
  return baseCache?.get(slug)
}

export function addToBaseCache(themes: readonly CustomTheme[]): void {
  baseCache ??= new Map()
  for (const theme of themes) baseCache.set(theme.slug, theme.base)
}

/** User themes from the last loadCustomThemes() — [] before the first one. */
export function getCachedCustomThemes(): readonly CustomTheme[] {
  return cachedUserThemes ?? []
}

/**
 * (Re)load user themes from disk, rebuilding the slug → base cache.
 * Concurrent calls share one in-flight read.
 */
export function loadCustomThemes(): Promise<readonly CustomTheme[]> {
  loadInFlight ??= (async () => {
    try {
      const themes = await readThemesFromPathAsync(getThemesDir(), 'user')
      baseCache = new Map(themes.map(theme => [theme.slug, theme.base]))
      addToBaseCache(pluginThemesStore.getState())
      themes.sort((a, b) => a.name.localeCompare(b.name))
      cachedUserThemes = themes
      return themes
    } finally {
      loadInFlight = undefined
    }
  })()
  return loadInFlight
}

export function _resetCustomThemesForTesting(): void {
  baseCache = undefined
  cachedUserThemes = undefined
}
