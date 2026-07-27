import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { getLauncherEnvBootstrapCode } from '../../launcher-config.js'

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

// The bootstrap is emitted into dist/main.js, so nothing in the source tree
// imports it and a broken precedence rule here passed the whole suite —
// verified by sabotaging it. These cases execute the emitted code itself.
const bootstrapDir = mkdtempSync(join(tmpdir(), 'noa-launcher-bootstrap-'))
const bootstrapEntry = join(bootstrapDir, 'bootstrap.mjs')
writeFileSync(
  bootstrapEntry,
  `${getLauncherEnvBootstrapCode()}
console.log(JSON.stringify({
  configDir: process.env.CLAUDE_CONFIG_DIR,
  productDir: process.env.CLAUDE_CODE_PRODUCT_DIR,
  cacheDir: process.env.CLAUDE_CODE_CACHE_DIR,
}))
`,
)

afterAll(() => {
  rmSync(bootstrapDir, { recursive: true, force: true })
})

function runBootstrap(env: Record<string, string | undefined>) {
  const result = spawnSync('bun', [bootstrapEntry], {
    // cwd matters: a relative fallback would resolve against it.
    cwd: bootstrapDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CODE_PRODUCT_DIR: undefined,
      CLAUDE_CONFIG_DIR: undefined,
      CLAUDE_CODE_CACHE_DIR: undefined,
      ...env,
    } as NodeJS.ProcessEnv,
  })
  return {
    status: result.status,
    stderr: result.stderr,
    env: result.status === 0 ? JSON.parse(result.stdout) : null,
  }
}

describe('emitted bundle bootstrap', () => {
  test('resolves the same precedence as the launcher', () => {
    expect(runBootstrap({ CLAUDE_CONFIG_DIR: '/tmp/noa-bootstrap-config' }).env)
      .toMatchObject({ configDir: '/tmp/noa-bootstrap-config' })

    expect(
      runBootstrap({
        CLAUDE_CONFIG_DIR: '/tmp/noa-bootstrap-inherited',
        CLAUDE_CODE_PRODUCT_DIR: '/tmp/noa-bootstrap-product',
      }).env,
    ).toMatchObject({ configDir: '/tmp/noa-bootstrap-product' })

    expect(runBootstrap({}).env).toMatchObject({
      configDir: join(homedir(), '.noa'),
      cacheDir: join(homedir(), '.noa', 'cache'),
    })
  })

  test('resolves an absolute config dir even with HOME unset', () => {
    // os.homedir() falls back to the passwd entry. Reading HOME directly
    // yielded a relative `.noa`, and the bundle then created a config
    // directory inside whatever cwd it was launched from — reproduced before
    // this was changed.
    const { env } = runBootstrap({ HOME: undefined, USERPROFILE: undefined })
    expect(env.configDir.startsWith('/')).toBe(true)
    expect(env.configDir).toBe(join(homedir(), '.noa'))
  })

  test('fails loudly rather than guessing when no home can be resolved', () => {
    // Not executed against a real homeless environment — os.homedir() answers
    // from the passwd entry on any machine that can run the suite. Pinning the
    // branch by source keeps the diagnostic from being dropped.
    const source = getLauncherEnvBootstrapCode()
    expect(source).toContain('if (!configDir) {')
    expect(source).toContain('[CONFIG_ERROR] Cannot resolve a home directory.')
    expect(source).toContain('process.exit(1)')
  })
})
