import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrateOpusToOpus1m } from '../../migrations/migrateOpusToOpus1m.js'
import { setMockSubscriptionType } from '../../services/mockRateLimits.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'

const ORIGINAL_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
const ORIGINAL_USER_TYPE = process.env.USER_TYPE
let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'noa-opus1m-migration-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env.USER_TYPE = 'ant'
  resetSettingsCache()
})

afterEach(() => {
  resetSettingsCache()
  rmSync(configDir, { recursive: true, force: true })
  if (ORIGINAL_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CONFIG_DIR
  if (ORIGINAL_USER_TYPE === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = ORIGINAL_USER_TYPE
})

describe('migrateOpusToOpus1m', () => {
  test('normalizes a stale Pro opus[1m] setting back to opus', () => {
    writeFileSync(join(configDir, 'settings.json'), '{"model":"opus[1m]"}')
    setMockSubscriptionType('pro')

    migrateOpusToOpus1m()

    const settings = JSON.parse(
      readFileSync(join(configDir, 'settings.json'), 'utf8'),
    )
    expect(settings.model).toBe('opus')
  })
})
