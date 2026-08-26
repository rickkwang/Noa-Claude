import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'
import {
  acquireAuthTransitionLock,
  withAuthTransitionLock,
} from '../../utils/authTransitionLock.js'

describe('withAuthTransitionLock', () => {
  test('serializes every writer of OAuth secure storage', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-auth-lock-'))
    const previous = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configDir
    const releaseRefreshLock = await acquireAuthTransitionLock({ retries: 0 })
    try {
      await expect(
        acquireAuthTransitionLock({ retries: 0 }),
      ).rejects.toMatchObject({ code: 'ELOCKED' })

      const authSource = readFileSync(
        join(process.cwd(), 'src/utils/auth.ts'),
        'utf8',
      )
      expect(authSource).toContain('acquireAuthTransitionLock({ retries: 0 })')
    } finally {
      await releaseRefreshLock()
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
