import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'

// launcher-config.js resolves its paths at module load, so each case needs a
// fresh process. Run from the repo root, like the other source-level tests.
function resolveConfigDir(env: Record<string, string | undefined>): string {
  const result = spawnSync(
    'bun',
    [
      '--eval',
      "const m = await import('./launcher-config.js'); console.log(m.DEFAULT_CONFIG_DIR)",
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_PRODUCT_DIR: undefined,
        CLAUDE_CONFIG_DIR: undefined,
        ...env,
      } as NodeJS.ProcessEnv,
    },
  )
  expect(result.status).toBe(0)
  return result.stdout.trim()
}

describe('launcher config dir precedence', () => {
  test('honours CLAUDE_CONFIG_DIR', () => {
    // The launcher used to overwrite this with the product dir, so
    // `CLAUDE_CONFIG_DIR=/tmp/x noa ...` silently kept reading ~/.noa.
    expect(resolveConfigDir({ CLAUDE_CONFIG_DIR: '/tmp/noa-config-dir-case' })).toBe(
      '/tmp/noa-config-dir-case',
    )
  })

  test('an explicit product dir wins over an inherited CLAUDE_CONFIG_DIR', () => {
    // applyLauncherDefaults() exports CLAUDE_CONFIG_DIR into the environment,
    // so a child process inherits one it never asked for. Only
    // CLAUDE_CODE_PRODUCT_DIR can be trusted as deliberate isolation — the
    // runtime-health smoke check relies on exactly this to sandbox an agent.
    expect(
      resolveConfigDir({
        CLAUDE_CONFIG_DIR: '/tmp/noa-inherited-config',
        CLAUDE_CODE_PRODUCT_DIR: '/tmp/noa-product-dir-case',
      }),
    ).toBe('/tmp/noa-product-dir-case')
  })

  test('falls back to the product dir under the current home', () => {
    const resolved = resolveConfigDir({})
    expect(resolved).toBe(`${process.env.HOME}/.noa`)
  })
})
