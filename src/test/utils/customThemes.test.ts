import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _resetCustomThemesForTesting,
  customThemeRef,
  dedupeThemeSlug,
  getCustomThemeBase,
  getThemesDir,
  isThemeName,
  isValidThemeColor,
  loadCustomThemes,
  mergeThemeOverrides,
  parseCustomThemeRef,
  pluginThemesStore,
  readThemesFromPathAsync,
  saveCustomTheme,
  slugifyThemeName,
  type CustomTheme,
} from '../../utils/customThemes.js'
import { resolveThemeSetting } from '../../utils/systemTheme.js'
import { getTheme } from '../../utils/theme.js'

let configDir: string
let previousConfigDir: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'noa-themes-test-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  _resetCustomThemesForTesting()
  pluginThemesStore.setState([])
})

afterEach(async () => {
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  _resetCustomThemesForTesting()
  pluginThemesStore.setState([])
  await rm(configDir, { recursive: true, force: true })
})

describe('customThemeRef / parseCustomThemeRef', () => {
  test('round-trips slugs', () => {
    expect(customThemeRef('my-theme')).toBe('custom:my-theme')
    expect(parseCustomThemeRef('custom:my-theme')).toBe('my-theme')
    // Plugin-namespaced slugs contain a second colon
    expect(parseCustomThemeRef('custom:plugin:slug')).toBe('plugin:slug')
  })

  test('returns null for plain settings', () => {
    expect(parseCustomThemeRef('dark')).toBeNull()
    expect(parseCustomThemeRef('auto')).toBeNull()
    expect(parseCustomThemeRef('customized')).toBeNull()
  })
})

describe('isThemeName', () => {
  test('accepts built-in names only', () => {
    expect(isThemeName('dark')).toBe(true)
    expect(isThemeName('light-ansi')).toBe(true)
    expect(isThemeName('auto')).toBe(false)
    expect(isThemeName('custom:x')).toBe(false)
    expect(isThemeName(42)).toBe(false)
  })
})

describe('isValidThemeColor', () => {
  test('accepts rgb, hex, ansi256, and ansi names', () => {
    expect(isValidThemeColor('rgb(1,2,3)')).toBe(true)
    expect(isValidThemeColor('rgb(255, 255, 255)')).toBe(true)
    expect(isValidThemeColor('#ff00aa')).toBe(true)
    expect(isValidThemeColor('#f0a')).toBe(true)
    expect(isValidThemeColor('ansi256(174)')).toBe(true)
    expect(isValidThemeColor('ansi:red')).toBe(true)
    expect(isValidThemeColor('ansi:whiteBright')).toBe(true)
  })

  test('rejects malformed or unknown colors', () => {
    expect(isValidThemeColor('rgb(1,2)')).toBe(false)
    expect(isValidThemeColor('#ff00')).toBe(false)
    expect(isValidThemeColor('ansi256(red)')).toBe(false)
    expect(isValidThemeColor('ansi:orange')).toBe(false)
    expect(isValidThemeColor('red')).toBe(false)
    expect(isValidThemeColor('')).toBe(false)
    expect(isValidThemeColor(undefined)).toBe(false)
    expect(isValidThemeColor(123)).toBe(false)
  })
})

describe('mergeThemeOverrides', () => {
  test('returns base unchanged when overrides are missing', () => {
    const base = getTheme('dark')
    expect(mergeThemeOverrides(base, null)).toBe(base)
    expect(mergeThemeOverrides(base, undefined)).toBe(base)
  })

  test('applies valid overrides, drops unknown keys and invalid colors', () => {
    const base = getTheme('dark')
    const merged = mergeThemeOverrides(base, {
      claude: '#ff00aa',
      text: 'not-a-color',
      bogusKey: 'rgb(1,2,3)',
    } as never)
    expect(merged.claude).toBe('#ff00aa')
    expect(merged.text).toBe(base.text)
    expect('bogusKey' in merged).toBe(false)
    // Base is not mutated
    expect(base.claude).not.toBe('#ff00aa')
  })
})

describe('slugifyThemeName / dedupeThemeSlug', () => {
  test('slugifies names', () => {
    expect(slugifyThemeName('My Cool Theme!')).toBe('my-cool-theme')
    expect(slugifyThemeName('--weird__name--')).toBe('weird-name')
    expect(slugifyThemeName('!!!')).toBe('theme')
  })

  test('dedupes against existing slugs', () => {
    const existing = [
      { slug: 'my-theme' },
      { slug: 'my-theme-2' },
    ] as CustomTheme[]
    expect(dedupeThemeSlug('My Theme', existing)).toBe('my-theme-3')
    expect(dedupeThemeSlug('Fresh', existing)).toBe('fresh')
  })
})

describe('readThemesFromPathAsync', () => {
  test('missing directory yields []', async () => {
    expect(
      await readThemesFromPathAsync(join(configDir, 'nope'), 'user'),
    ).toEqual([])
  })

  test('reads valid themes, skips junk', async () => {
    const dir = join(configDir, 'themes')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'ocean.json'),
      JSON.stringify({
        name: 'Ocean',
        base: 'light',
        overrides: { claude: '#0000ff', bad: 'nope', unknownKey: '#fff' },
      }),
    )
    await writeFile(join(dir, 'broken.json'), '{not json')
    await writeFile(join(dir, 'notatheme.txt'), '{}')
    await writeFile(join(dir, 'array.json'), '[]')

    const themes = await readThemesFromPathAsync(dir, 'user')
    expect(themes).toHaveLength(1)
    expect(themes[0]).toMatchObject({
      slug: 'ocean',
      name: 'Ocean',
      base: 'light',
      source: 'user',
    })
    expect(themes[0]!.overrides).toEqual({ claude: '#0000ff' })
  })

  test('unknown base falls back to dark; missing name falls back to slug', async () => {
    const dir = join(configDir, 'themes')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'weird.json'),
      JSON.stringify({ base: 'octarine', overrides: {} }),
    )
    const themes = await readThemesFromPathAsync(dir, 'user')
    expect(themes[0]).toMatchObject({ slug: 'weird', name: 'weird', base: 'dark' })
  })

  test('a file path loads as a single theme with prefix', async () => {
    const dir = join(configDir, 'themes')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'solo.json')
    await writeFile(file, JSON.stringify({ name: 'Solo', base: 'dark' }))
    const themes = await readThemesFromPathAsync(file, { plugin: 'acme' }, 'acme:')
    expect(themes).toHaveLength(1)
    expect(themes[0]).toMatchObject({
      slug: 'acme:solo',
      name: 'Solo',
      source: { plugin: 'acme' },
    })
  })

  test('files over 256KB are skipped', async () => {
    const dir = join(configDir, 'themes')
    await mkdir(dir, { recursive: true })
    const big = '{"name":"big","base":"dark","overrides":{"claude":"'
    await writeFile(join(dir, 'big.json'), big + 'x'.repeat(300 * 1024))
    expect(await readThemesFromPathAsync(dir, 'user')).toEqual([])
  })
})

describe('saveCustomTheme / loadCustomThemes / resolveThemeSetting', () => {
  test('round-trip: save, load, resolve custom ref to base', async () => {
    await saveCustomTheme({
      slug: 'ocean',
      name: 'Ocean',
      base: 'light',
      overrides: { claude: '#0000ff' },
      source: 'user',
    })
    const themes = await loadCustomThemes()
    expect(themes.map(t => t.slug)).toEqual(['ocean'])
    expect(getCustomThemeBase('ocean')).toBe('light')
    expect(resolveThemeSetting(customThemeRef('ocean'))).toBe('light')
    expect(resolveThemeSetting(customThemeRef('missing'))).toBe('dark')
    expect(resolveThemeSetting('dark')).toBe('dark')
  })

  test('writes the file under <config>/themes/<slug>.json', async () => {
    await saveCustomTheme({
      slug: 'x',
      name: 'X',
      base: 'dark',
      overrides: {},
      source: 'user',
    })
    const raw = await Bun.file(join(getThemesDir(), 'x.json')).text()
    expect(JSON.parse(raw)).toEqual({
      name: 'X',
      base: 'dark',
      overrides: {},
    })
  })

  test('plugin store themes contribute to the base cache on reload', async () => {
    pluginThemesStore.setState([
      {
        slug: 'acme:brand',
        name: 'Brand',
        base: 'light-daltonized',
        overrides: {},
        source: { plugin: 'acme' },
      },
    ])
    await loadCustomThemes()
    expect(getCustomThemeBase('acme:brand')).toBe('light-daltonized')
    expect(resolveThemeSetting('custom:acme:brand')).toBe('light-daltonized')
  })
})
