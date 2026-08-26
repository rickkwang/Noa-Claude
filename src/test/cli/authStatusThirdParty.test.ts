import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('auth status for third-party transports', () => {
  test('an OpenAI transport flag without an endpoint or credential is logged out', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-auth-status-openai-'))
    try {
      const result = spawnSync(
        'bun',
        [
          '--eval',
          `let exitCode = null; process.exit = code => { exitCode = code }; const { enableConfigs } = await import('./src/utils/config.ts'); enableConfigs(); const { authStatus } = await import('./src/cli/handlers/auth.ts'); await authStatus({ json: true }); console.log('__EXIT__' + exitCode)`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            ...process.env,
            CLAUDE_CODE_PRODUCT_DIR: configDir,
            CLAUDE_CONFIG_DIR: configDir,
            CLAUDE_CODE_USE_OPENAI: '1',
            NODE_ENV: undefined,
            CI: undefined,
            OPENAI_API_KEY: undefined,
            OPENAI_BASE_URL: undefined,
            ANTHROPIC_API_KEY: undefined,
            ANTHROPIC_AUTH_TOKEN: undefined,
          } as NodeJS.ProcessEnv,
        },
      )

      expect(result.status).toBe(0)
      const [json, exitMarker] = result.stdout.split('__EXIT__')
      expect(exitMarker?.trim()).toBe('1')
      expect(JSON.parse(json ?? '')).toMatchObject({
        loggedIn: false,
        authMethod: 'none',
        apiProvider: 'openaiCompatible',
      })
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
