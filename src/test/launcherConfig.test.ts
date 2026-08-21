import { afterAll, describe, expect, expectTypeOf, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import {
  getLauncherEnvBootstrapCode,
  getResolvedLauncherConfig,
} from '../../launcher-config.js'
import { getOauthConfigFileSuffix } from '../constants/oauthConfigPath.js'

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

describe('OAuth config filename suffix', () => {
  const cases = [
    [{ CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://claude.fedstart.com' }, '-custom-oauth'],
    [{ USER_TYPE: 'ant', USE_LOCAL_OAUTH: 'yes' }, '-local-oauth'],
    [{ USER_TYPE: 'ant', USE_STAGING_OAUTH: '1' }, '-staging-oauth'],
    [{ USER_TYPE: 'external', USE_STAGING_OAUTH: '1' }, ''],
  ] as const
  test.each(cases)('resolves %o to %s', (env, expected) => {
    const allowInternalOauth = 'USER_TYPE' in env && env.USER_TYPE === 'ant'
    expect(getOauthConfigFileSuffix(env, allowInternalOauth)).toBe(expected)
  })
})

function runLauncherFixture({
  name,
  globalConfig,
  globalConfigRaw,
  globalConfigFile = '.config.json',
  script,
  env = {},
}: {
  name: string
  globalConfig?: object
  globalConfigRaw?: string
  globalConfigFile?: string
  script: string
  env?: Record<string, string | undefined>
}) {
  const productDir = mkdtempSync(join(tmpdir(), `noa-launcher-${name}-`))
  try {
    writeFileSync(join(productDir, 'settings.json'), '{}\n')
    if (globalConfig || globalConfigRaw !== undefined) {
      writeFileSync(
        join(productDir, globalConfigFile),
        globalConfigRaw ?? JSON.stringify(globalConfig),
      )
    }
    return spawnSync('bun', ['--eval', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_CODE_PRODUCT_DIR: productDir,
        CLAUDE_CONFIG_DIR: undefined,
        CLAUDE_CODE_CUSTOM_OAUTH_URL: undefined,
        ANTHROPIC_BASE_URL: undefined,
        ANTHROPIC_MODEL: undefined,
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        CLAUDE_AGENT_DEFAULT_MODEL: undefined,
        ...env,
      } as NodeJS.ProcessEnv,
    })
  } finally {
    rmSync(productDir, { recursive: true, force: true })
  }
}

const RESOLVE_PROVIDER_SCRIPT = `
  const { getResolvedLauncherConfig } = await import('./launcher-config.js')
  const value = getResolvedLauncherConfig()
  console.log(JSON.stringify({
    baseUrl: value.apiBaseUrl ?? null,
    model: value.model ?? null,
    provider: value.launcherProvider,
  }))
`

describe('launcher provider defaults', () => {
  test('does not re-inject MiniMax after Anthropic routing is persisted', () => {
    const result = runLauncherFixture({
      name: 'oauth',
      globalConfig: { launcherProvider: 'anthropic' },
      script: `
        const { applyLauncherDefaults } = await import('./launcher-config.js')
        const resolved = applyLauncherDefaults()
        console.log(JSON.stringify({
          baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
          model: process.env.ANTHROPIC_MODEL ?? null,
          hasSettings: resolved.settings !== undefined,
          hasSettingsEnv: resolved.settingsEnv !== undefined,
        }))
      `,
    })
    if (result.status !== 0) throw new Error(result.stderr)
    expect(JSON.parse(result.stdout)).toEqual({
      baseUrl: null,
      model: null,
      hasSettings: true,
      hasSettingsEnv: true,
    })
  })

  test('keeps existing OAuth users on Anthropic before the routing marker exists', () => {
    const result = runLauncherFixture({
      name: 'legacy-oauth',
      globalConfig: { oauthAccount: { accountUuid: 'legacy-account' } },
      script: RESOLVE_PROVIDER_SCRIPT,
    })
    if (result.status !== 0) throw new Error(result.stderr)
    expect(JSON.parse(result.stdout)).toEqual({
      baseUrl: null,
      model: null,
      provider: 'anthropic',
    })
  })

  test('allows keychain-backed subscription auth in print mode', () => {
    const result = runLauncherFixture({
      name: 'oauth-print',
      globalConfig: { launcherProvider: 'anthropic' },
      script: `const { validateLauncherConfiguration } = await import('./launcher-config.js'); validateLauncherConfiguration(['bun', 'noa', '-p']);`,
    })
    expect(result.status).toBe(0)
  })

  test('reads the same custom OAuth config file as the runtime', () => {
    const result = runLauncherFixture({
      name: 'custom-oauth',
      globalConfig: { launcherProvider: 'anthropic' },
      globalConfigFile: '.config-custom-oauth.json',
      script: RESOLVE_PROVIDER_SCRIPT,
      env: { CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://claude.fedstart.com' },
    })
    if (result.status !== 0) throw new Error(result.stderr)
    expect(JSON.parse(result.stdout)).toEqual({
      baseUrl: null,
      model: null,
      provider: 'anthropic',
    })
  })

  test('keeps MiniMax defaults for a fresh unauthenticated install', () => {
    const result = runLauncherFixture({
      name: 'fresh',
      script: RESOLVE_PROVIDER_SCRIPT,
    })
    if (result.status !== 0) throw new Error(result.stderr)
    expect(JSON.parse(result.stdout)).toEqual({
      baseUrl: 'https://api.minimaxi.com/anthropic',
      model: 'MiniMax-M2.7',
      provider: 'product-default',
    })
    expectTypeOf<ReturnType<typeof getResolvedLauncherConfig>['model']>()
      .toEqualTypeOf<string | undefined>()
  })

  test('rejects a third-party bearer token without an explicit base URL', () => {
    const result = runLauncherFixture({
      name: 'oauth-with-bearer',
      globalConfig: { launcherProvider: 'anthropic' },
      script: `
        const {
          applyLauncherDefaults,
          validateLauncherConfiguration,
        } = await import('./launcher-config.js')
        const resolved = applyLauncherDefaults()
        validateLauncherConfiguration(['bun', 'noa', '-p'], resolved)
      `,
      env: { ANTHROPIC_AUTH_TOKEN: 'third-party-bearer' },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'ANTHROPIC_AUTH_TOKEN requires ANTHROPIC_BASE_URL',
    )
  })

  test('rejects an unknown persisted launcher provider', () => {
    const result = runLauncherFixture({
      name: 'invalid-provider-marker',
      globalConfig: {
        launcherProvider: 'anthorpic',
        oauthAccount: { accountUuid: 'legacy-account' },
      },
      script: RESOLVE_PROVIDER_SCRIPT,
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Invalid launcherProvider')
  })

  test('keeps version recovery available with malformed global config', () => {
    const result = runLauncherFixture({
      name: 'malformed-config-version',
      globalConfigRaw: '{invalid-json',
      script: `
        const {
          applyLauncherDefaults,
          validateLauncherConfiguration,
        } = await import('./launcher-config.js')
        const resolved = applyLauncherDefaults({ skipGlobalConfig: true })
        validateLauncherConfiguration(['bun', 'noa', '--version'], resolved)
      `,
    })
    expect(result.status).toBe(0)
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
