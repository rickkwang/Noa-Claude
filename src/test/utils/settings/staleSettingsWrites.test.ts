import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../../utils/settings/settings.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'
import { addPermissionRulesToSettings } from '../../../utils/permissions/permissionsLoader.js'
import {
  getFullscreenMode,
  setFullscreenMode,
} from '../../../utils/fullscreen.js'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const originalProductDir = process.env.CLAUDE_CODE_PRODUCT_DIR
const originalNoFlicker = process.env.NOA_CLAUDE_NO_FLICKER
const originalLegacyNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER
const tempDirs: string[] = []

afterEach(() => {
  resetSettingsCache()
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  if (originalProductDir === undefined) {
    delete process.env.CLAUDE_CODE_PRODUCT_DIR
  } else {
    process.env.CLAUDE_CODE_PRODUCT_DIR = originalProductDir
  }
  if (originalNoFlicker === undefined) {
    delete process.env.NOA_CLAUDE_NO_FLICKER
  } else {
    process.env.NOA_CLAUDE_NO_FLICKER = originalNoFlicker
  }
  if (originalLegacyNoFlicker === undefined) {
    delete process.env.CLAUDE_CODE_NO_FLICKER
  } else {
    process.env.CLAUDE_CODE_NO_FLICKER = originalLegacyNoFlicker
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('settings writes from stale sessions', () => {
  test('reclaims an abandoned settings lock before the write deadline', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-abandoned-lock-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    const settingsFile = join(configDir, 'settings.json')
    const lockPath = `${settingsFile}.lock`
    writeFileSync(settingsFile, JSON.stringify({ cleanupPeriodDays: 7 }))
    mkdirSync(lockPath)
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: 999_999,
        token: 'abandoned-owner',
        acquiredAt: Date.now(),
      }),
    )
    resetSettingsCache()

    const result = updateSettingsForSource('userSettings', {
      includeCoAuthoredBy: false,
    })

    expect(result.error).toBeNull()
    expect(existsSync(lockPath)).toBe(false)
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      cleanupPeriodDays: 7,
      includeCoAuthoredBy: false,
    })
  }, 8_000)

  test('reclaims an ownerless legacy lock once it goes stale', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-legacy-lock-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    const settingsFile = join(configDir, 'settings.json')
    const lockPath = `${settingsFile}.lock`
    writeFileSync(settingsFile, JSON.stringify({ cleanupPeriodDays: 7 }))
    // proper-lockfile locks from older builds have no owner.json; the same
    // is true if a process dies between mkdir and owner.json creation.
    mkdirSync(lockPath)
    const abandonedAt = new Date(Date.now() - 4_500)
    utimesSync(lockPath, abandonedAt, abandonedAt)
    resetSettingsCache()

    const result = updateSettingsForSource('userSettings', {
      includeCoAuthoredBy: false,
    })

    expect(result.error).toBeNull()
    expect(existsSync(lockPath)).toBe(false)
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      cleanupPeriodDays: 7,
      includeCoAuthoredBy: false,
    })
  }, 20_000)

  test('reclaims a lock when its PID has been reused by another process', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-reused-pid-lock-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    const settingsFile = join(configDir, 'settings.json')
    const lockPath = `${settingsFile}.lock`
    writeFileSync(settingsFile, JSON.stringify({ cleanupPeriodDays: 7 }))
    mkdirSync(lockPath)
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        token: 'previous-process-with-reused-pid',
        acquiredAt: Date.now() - 10 * 60_000,
      }),
    )
    resetSettingsCache()

    const result = updateSettingsForSource('userSettings', {
      includeCoAuthoredBy: false,
    })

    expect(result.error).toBeNull()
    expect(existsSync(lockPath)).toBe(false)
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      cleanupPeriodDays: 7,
      includeCoAuthoredBy: false,
    })
  })

  test('does not steal a live lock while its synchronous update blocks past the stale threshold', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-blocked-live-lock-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    const settingsFile = join(configDir, 'settings.json')
    const readyFile = join(configDir, 'blocked-lock-ready')
    writeFileSync(settingsFile, JSON.stringify({ env: {} }))
    resetSettingsCache()

    const settingsModule = resolve(
      import.meta.dir,
      '../../../utils/settings/settings.ts',
    )
    const childCode = `
      const fs = require('node:fs')
      process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
      process.env.CLAUDE_CODE_PRODUCT_DIR = ${JSON.stringify(configDir)}
      const settings = await import(${JSON.stringify(settingsModule)})
      const result = settings.updateSettingsForSource('userSettings', current => {
        fs.writeFileSync(${JSON.stringify(readyFile)}, '')
        const deadline = Date.now() + 7_000
        while (Date.now() < deadline) {}
        return { env: { ...current.env, OWNER_WRITE: '1' } }
      })
      if (result.error) throw result.error
    `
    const child = Bun.spawn(['bun', '-e', childCode], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const readyDeadline = Date.now() + 5_000
    while (!existsSync(readyFile) && Date.now() < readyDeadline) {
      await Bun.sleep(5)
    }
    expect(existsSync(readyFile)).toBe(true)

    let contender: ReturnType<typeof updateSettingsForSource> | undefined
    try {
      contender = updateSettingsForSource('userSettings', {
        env: { CONTENDER_WRITE: '1' },
      })
      expect(await child.exited).toBe(0)
    } finally {
      child.kill()
      await child.exited
    }

    expect(contender?.error?.message).toContain(
      'Timed out waiting for settings lock',
    )
    expect(contender?.error?.message).not.toContain(
      'Failed to read raw settings',
    )
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({
      env: { OWNER_WRITE: '1' },
    })
  }, 10_000)

  test('saving a permission rule preserves a newer tui setting written by another process', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-stale-settings-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    resetSettingsCache()

    expect(
      updateSettingsForSource('userSettings', {
        tui: 'default',
        permissions: { allow: [] },
      }).error,
    ).toBeNull()

    // Keep the old mode in this process's per-source cache.
    expect(getSettingsForSource('userSettings')?.tui).toBe('default')

    const settingsModule = resolve(
      import.meta.dir,
      '../../../utils/settings/settings.ts',
    )
    const childCode = `
      process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
      process.env.CLAUDE_CODE_PRODUCT_DIR = ${JSON.stringify(configDir)}
      const settings = await import(${JSON.stringify(settingsModule)})
      const result = settings.updateSettingsForSource('userSettings', {
        tui: 'fullscreen',
      })
      if (result.error) throw result.error
    `
    const child = Bun.spawn(['bun', '-e', childCode], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await child.exited).toBe(0)

    expect(
      addPermissionRulesToSettings(
        {
          ruleValues: [{ toolName: 'Bash', ruleContent: 'bun run build' }],
          ruleBehavior: 'allow',
        },
        'userSettings',
      ),
    ).toBe(true)

    const persisted = JSON.parse(
      readFileSync(join(configDir, 'settings.json'), 'utf8'),
    )
    expect(persisted.tui).toBe('fullscreen')
    expect(persisted.permissions.allow).toContain('Bash(bun run build)')
  })

  test('settings mutators submit scoped patches instead of whole cached snapshots', () => {
    const sourceFiles = [
      '../../../utils/permissions/permissionsLoader.ts',
      '../../../utils/plugins/pluginOptionsStorage.ts',
      '../../../utils/plugins/mcpbHandler.ts',
    ]

    for (const relativePath of sourceFiles) {
      const source = readFileSync(resolve(import.meta.dir, relativePath), 'utf8')
      expect(source).not.toMatch(
        /updateSettingsForSource\([^,]+,\s*(?:settings|updatedSettingsData)\s*\)/,
      )
    }
  })

  test('concurrent processes preserve every scoped settings update', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-concurrent-settings-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    resetSettingsCache()

    expect(
      updateSettingsForSource('userSettings', {
        tui: 'fullscreen',
        env: {},
      }).error,
    ).toBeNull()
    const settingsFile = join(configDir, 'settings.json')
    const lockPath = `${settingsFile}.lock`
    mkdirSync(lockPath)
    writeFileSync(
      join(lockPath, 'owner.json'),
      JSON.stringify({
        pid: 999_999,
        token: 'abandoned-before-recovery-race',
        acquiredAt: Date.now(),
      }),
    )

    const settingsModule = resolve(
      import.meta.dir,
      '../../../utils/settings/settings.ts',
    )
    const startFile = join(configDir, 'start')
    const processCount = 12
    const children = Array.from({ length: processCount }, (_, index) => {
      const readyFile = join(configDir, `ready-${index}`)
      const childCode = `
        const { existsSync, writeFileSync } = await import('node:fs')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        process.env.CLAUDE_CODE_PRODUCT_DIR = ${JSON.stringify(configDir)}
        const settings = await import(${JSON.stringify(settingsModule)})
        writeFileSync(${JSON.stringify(readyFile)}, '')
        while (!existsSync(${JSON.stringify(startFile)})) await Bun.sleep(1)
        const result = settings.updateSettingsForSource('userSettings', {
          env: { ${JSON.stringify(`CONCURRENT_${index}`)}: '1' },
        })
        if (result.error) throw result.error
      `
      return Bun.spawn(['bun', '-e', childCode], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
    })

    const readyFiles = Array.from({ length: processCount }, (_, index) =>
      join(configDir, `ready-${index}`),
    )
    const deadline = Date.now() + 10_000
    while (
      !readyFiles.every(readyFile => existsSync(readyFile)) &&
      Date.now() < deadline
    ) {
      await Bun.sleep(5)
    }
    const allChildrenReady = readyFiles.every(readyFile =>
      existsSync(readyFile),
    )
    writeFileSync(startFile, '')
    expect(allChildrenReady).toBe(true)

    expect(await Promise.all(children.map(child => child.exited))).toEqual(
      Array(processCount).fill(0),
    )

    const persisted = JSON.parse(
      readFileSync(settingsFile, 'utf8'),
    )
    expect(persisted.tui).toBe('fullscreen')
    for (let index = 0; index < processCount; index++) {
      expect(persisted.env[`CONCURRENT_${index}`]).toBe('1')
    }
    expect(existsSync(lockPath)).toBe(false)
    expect(existsSync(`${lockPath}.recovery`)).toBe(false)
  })

  test('concurrent processes preserve every permission rule update', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-concurrent-rules-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    resetSettingsCache()

    expect(
      updateSettingsForSource('userSettings', {
        tui: 'fullscreen',
        permissions: { allow: [] },
      }).error,
    ).toBeNull()

    const permissionsModule = resolve(
      import.meta.dir,
      '../../../utils/permissions/permissionsLoader.ts',
    )
    const startFile = join(configDir, 'start-rules')
    const processCount = 8
    const children = Array.from({ length: processCount }, (_, index) => {
      const readyFile = join(configDir, `ready-rule-${index}`)
      const childCode = `
        const { existsSync, writeFileSync } = await import('node:fs')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        process.env.CLAUDE_CODE_PRODUCT_DIR = ${JSON.stringify(configDir)}
        const permissions = await import(${JSON.stringify(permissionsModule)})
        writeFileSync(${JSON.stringify(readyFile)}, '')
        while (!existsSync(${JSON.stringify(startFile)})) await Bun.sleep(1)
        const saved = permissions.addPermissionRulesToSettings({
          ruleValues: [{ toolName: 'Bash', ruleContent: ${JSON.stringify(`echo ${index}`)} }],
          ruleBehavior: 'allow',
        }, 'userSettings')
        if (!saved) throw new Error('permission rule save failed')
      `
      return Bun.spawn(['bun', '-e', childCode], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
    })

    const readyFiles = Array.from({ length: processCount }, (_, index) =>
      join(configDir, `ready-rule-${index}`),
    )
    const deadline = Date.now() + 10_000
    while (
      !readyFiles.every(readyFile => existsSync(readyFile)) &&
      Date.now() < deadline
    ) {
      await Bun.sleep(5)
    }
    const allChildrenReady = readyFiles.every(readyFile =>
      existsSync(readyFile),
    )
    writeFileSync(startFile, '')
    expect(allChildrenReady).toBe(true)
    expect(await Promise.all(children.map(child => child.exited))).toEqual(
      Array(processCount).fill(0),
    )

    const persisted = JSON.parse(
      readFileSync(join(configDir, 'settings.json'), 'utf8'),
    )
    expect(persisted.tui).toBe('fullscreen')
    for (let index = 0; index < processCount; index++) {
      expect(persisted.permissions.allow).toContain(`Bash(echo ${index})`)
    }
  })
})

describe('upstream tui setting compatibility', () => {
  test('isolates an unknown future tui value without rejecting other settings', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-tui-future-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    delete process.env.NOA_CLAUDE_NO_FLICKER
    delete process.env.CLAUDE_CODE_NO_FLICKER
    const settingsFile = join(configDir, 'settings.json')
    writeFileSync(
      settingsFile,
      JSON.stringify({ tui: 'future-renderer', cleanupPeriodDays: 7 }),
    )
    resetSettingsCache()

    expect(getSettingsForSource('userSettings')).toMatchObject({
      tui: 'future-renderer',
      cleanupPeriodDays: 7,
    })
    expect(getFullscreenMode()).toBe('auto')

    expect(
      updateSettingsForSource('userSettings', {
        includeCoAuthoredBy: false,
      }).error,
    ).toBeNull()
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      tui: 'future-renderer',
      cleanupPeriodDays: 7,
      includeCoAuthoredBy: false,
    })
  })

  test('falls back to the legacy tuiMode field for existing Noa settings', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-tui-legacy-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    delete process.env.NOA_CLAUDE_NO_FLICKER
    delete process.env.CLAUDE_CODE_NO_FLICKER
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ tuiMode: 'fullscreen' }),
    )
    resetSettingsCache()

    expect(getFullscreenMode()).toBe('fullscreen')
  })

  test('prefers the upstream tui field when the legacy tuiMode conflicts', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-tui-compat-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    delete process.env.NOA_CLAUDE_NO_FLICKER
    delete process.env.CLAUDE_CODE_NO_FLICKER
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ tui: 'fullscreen', tuiMode: 'default' }),
    )
    resetSettingsCache()

    expect(getFullscreenMode()).toBe('fullscreen')
  })

  test('writes the upstream tui field and removes the legacy tuiMode field', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-tui-migration-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_PRODUCT_DIR = configDir
    delete process.env.NOA_CLAUDE_NO_FLICKER
    delete process.env.CLAUDE_CODE_NO_FLICKER
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ tuiMode: 'fullscreen', theme: 'dark' }),
    )
    resetSettingsCache()

    setFullscreenMode('default')

    const persisted = JSON.parse(
      readFileSync(join(configDir, 'settings.json'), 'utf8'),
    )
    expect(persisted.tui).toBe('default')
    expect(persisted).not.toHaveProperty('tuiMode')
    expect(persisted.theme).toBe('dark')
  })
})
