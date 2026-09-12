import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createPluginFromPath,
  finishLoadingPluginFromPath,
} from '../../utils/plugins/pluginLoader.js'
import type { PluginMarketplaceEntry } from '../../utils/plugins/schemas.js'

// A manifest (plugin.json or marketplace entry) that declares outputStyles
// takes over style loading completely: the output-styles/ directory is not
// auto-loaded alongside it. These cases pin that contract at both load sites.
function makePluginDir(opts: {
  withDefaultDir?: boolean
  manifestOutputStyles?: string[]
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-output-styles-'))
  if (opts.withDefaultDir) {
    mkdirSync(join(dir, 'output-styles'))
    writeFileSync(join(dir, 'output-styles', 'default-style.md'), 'default')
  }
  if (opts.manifestOutputStyles) {
    mkdirSync(join(dir, '.claude-plugin'))
    mkdirSync(join(dir, 'custom-styles'))
    writeFileSync(join(dir, 'custom-styles', 'custom.md'), 'custom')
    writeFileSync(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'test-plugin',
        outputStyles: opts.manifestOutputStyles,
      }),
    )
  }
  return dir
}

function makeEntry(outputStyles?: string[]): PluginMarketplaceEntry {
  return {
    name: 'test-plugin',
    source: './test-plugin',
    ...(outputStyles ? { outputStyles } : {}),
  } as PluginMarketplaceEntry
}

describe('createPluginFromPath output style loading', () => {
  test('auto-loads output-styles/ when the manifest declares nothing', async () => {
    const dir = makePluginDir({ withDefaultDir: true })
    const { plugin } = await createPluginFromPath(dir, 'test', true, 'test-plugin')

    expect(plugin.outputStylesPath).toBe(join(dir, 'output-styles'))
    expect(plugin.outputStylesPaths).toBeUndefined()
  })

  test('a manifest declaring outputStyles suppresses the default directory', async () => {
    const dir = makePluginDir({
      withDefaultDir: true,
      manifestOutputStyles: ['./custom-styles'],
    })
    const { plugin } = await createPluginFromPath(dir, 'test', true, 'test-plugin')

    expect(plugin.outputStylesPath).toBeUndefined()
    expect(plugin.outputStylesPaths).toEqual([join(dir, 'custom-styles')])
  })
})

describe('finishLoadingPluginFromPath output style loading', () => {
  test('marketplace entry outputStyles suppress the auto-loaded default directory', async () => {
    const dir = makePluginDir({ withDefaultDir: true })
    mkdirSync(join(dir, 'entry-styles'))
    writeFileSync(join(dir, 'entry-styles', 'entry.md'), 'entry')

    const plugin = await finishLoadingPluginFromPath(
      makeEntry(['./entry-styles']),
      'test-plugin@test',
      true,
      [],
      dir,
    )

    expect(plugin?.outputStylesPath).toBeUndefined()
    expect(plugin?.outputStylesPaths).toEqual([join(dir, 'entry-styles')])
  })

  test('without entry outputStyles the default directory still loads', async () => {
    const dir = makePluginDir({ withDefaultDir: true })

    const plugin = await finishLoadingPluginFromPath(
      makeEntry(),
      'test-plugin@test',
      true,
      [],
      dir,
    )

    expect(plugin?.outputStylesPath).toBe(join(dir, 'output-styles'))
    expect(plugin?.outputStylesPaths).toBeUndefined()
  })

  test('plugin.json plus a marketplace entry (strict) supplements, keeping the manifest contract', async () => {
    const dir = makePluginDir({
      withDefaultDir: true,
      manifestOutputStyles: ['./custom-styles'],
    })
    mkdirSync(join(dir, 'entry-styles'))
    writeFileSync(join(dir, 'entry-styles', 'entry.md'), 'entry')

    const plugin = await finishLoadingPluginFromPath(
      { ...makeEntry(['./entry-styles']), strict: true },
      'test-plugin@test',
      true,
      [],
      dir,
    )

    // plugin.json declared outputStyles, so the default dir stays suppressed;
    // the marketplace entry's paths append to the manifest's.
    expect(plugin?.outputStylesPath).toBeUndefined()
    expect(plugin?.outputStylesPaths).toEqual([
      join(dir, 'custom-styles'),
      join(dir, 'entry-styles'),
    ])
  })
})
