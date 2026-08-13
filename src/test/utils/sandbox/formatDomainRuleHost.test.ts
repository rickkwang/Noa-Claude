import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatDomainRuleHost,
  getAmbiguousDomainWarnings,
} from '../../../utils/sandbox/sandbox-adapter.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'

describe('formatDomainRuleHost', () => {
  test('brackets IPv6 literals so the rule is unambiguous', () => {
    expect(formatDomainRuleHost('fd00::1')).toBe('[fd00::1]')
    expect(formatDomainRuleHost('::1')).toBe('[::1]')
    expect(formatDomainRuleHost('fd00::443')).toBe('[fd00::443]')
  })

  test('matches what URL.hostname already produces for the WebFetch path', () => {
    const fromUrl = new URL('http://[fd00::443]:8080/').hostname
    expect(formatDomainRuleHost('fd00::443')).toBe(fromUrl)
  })

  test('leaves hostnames, IPv4 and already-bracketed hosts alone', () => {
    expect(formatDomainRuleHost('example.com')).toBe('example.com')
    expect(formatDomainRuleHost('1.2.3.4')).toBe('1.2.3.4')
    expect(formatDomainRuleHost('[::1]')).toBe('[::1]')
  })

  test('tolerates a missing host without throwing', () => {
    expect(formatDomainRuleHost(undefined)).toBe('')
  })
})

describe('getAmbiguousDomainWarnings', () => {
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  const tempDirs: string[] = []

  afterEach(() => {
    resetSettingsCache()
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('strips VT control characters from settings-sourced entries before display', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-ambiguous-vt-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['WebFetch(domain:fd00::\u001b[31m1)'] },
      }),
    )
    resetSettingsCache()

    const warnings = getAmbiguousDomainWarnings()

    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.invalidValue)).toBe('fd00::1')
    expect(String(warnings[0]?.invalidValue)).not.toContain('\u001b')
  })
})
