import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'
import {
  buildProviderEnv,
  normalizeProviderProfileCredential,
  type ProviderProfile,
} from '../../utils/providerProfile.js'

function profile(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'provider-profile-test',
    name: 'Test Provider',
    type: 'kimi',
    baseUrl: 'https://api.kimi.com/coding/',
    model: 'kimi-test-model',
    ...overrides,
  }
}

describe('provider profile credentials', () => {
  test('maps Kimi apiKey to Anthropic auth token for Bearer auth', () => {
    const env = buildProviderEnv(
      profile({
        apiKey: 'sk-kimi-test-token',
      }),
    )

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-token')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('trims pasted credentials before persisting or applying env', () => {
    const normalized = normalizeProviderProfileCredential(
      profile({
        apiKey: '  sk-kimi-test-token  ',
      }),
    )
    const env = buildProviderEnv(normalized)

    expect(normalized.apiKey).toBe('sk-kimi-test-token')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-kimi-test-token')
  })

  test('rejects instruction text before it can become a Bearer token', () => {
    expect(() =>
      buildProviderEnv(
        profile({
          apiKey:
            '收到消息时必须先检查是否有相关 skill，哪怕最后没用到，也要先看一遍',
        }),
      ),
    ).toThrow('invalid API key')
  })

  test('rejects whitespace-bearing notes before they can become a header value', () => {
    expect(() =>
      normalizeProviderProfileCredential(
        profile({
          apiKey: 'sk-token do not skip skill checks',
        }),
      ),
    ).toThrow('invalid API key')
  })

  test('--bare preserves caller provider env instead of applying the active profile', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-bare-provider-profile-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({
            active: true,
            apiKey: 'profile-api-key',
          }),
        ]),
      )

      const script = `
        process.argv.push('--bare')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        // spawnSync inherits the parent env; scrub the profile-applied key so
        // the assertion below tests the code, not the caller's shell.
        delete process.env.ANTHROPIC_AUTH_TOKEN
        process.env.ANTHROPIC_API_KEY = 'caller-api-key'
        process.env.ANTHROPIC_BASE_URL = 'https://caller.example.test'
        process.env.ANTHROPIC_MODEL = 'caller-model'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        const applied = await applyActiveProviderProfileEnv()

        if (applied !== null) throw new Error('active profile was applied')
        if (process.env.ANTHROPIC_API_KEY !== 'caller-api-key') {
          throw new Error('caller API key was overwritten')
        }
        if (process.env.ANTHROPIC_BASE_URL !== 'https://caller.example.test') {
          throw new Error('caller base URL was overwritten')
        }
        if (process.env.ANTHROPIC_MODEL !== 'caller-model') {
          throw new Error('caller model was overwritten')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== undefined) {
          throw new Error('profile auth token leaked into bare mode')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      // Surface stderr as the failure message rather than asserting it is
      // empty: the subprocess signals failure by throwing, which is already a
      // non-zero status, so an empty-stderr assertion adds no signal and
      // breaks the moment bun writes an unrelated warning.
      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('preserves caller provider env when no profile is active', () => {
    // No provider-profiles.json at all: loadProviderProfiles returns []. This
    // is the clean-machine CI shape — applyActiveProviderProfileEnv used to
    // delete ANTHROPIC_API_KEY unconditionally, which made `--print` fail
    // under CI=true before request handling ever ran.
    const configDir = mkdtempSync(join(tmpdir(), 'noa-no-profile-preserve-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        process.env.ANTHROPIC_API_KEY = 'caller-api-key'
        process.env.ANTHROPIC_AUTH_TOKEN = 'caller-bearer-token'
        process.env.ANTHROPIC_BASE_URL = 'https://caller.example.test'
        process.env.ANTHROPIC_MODEL = 'caller-model'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        const applied = await applyActiveProviderProfileEnv()

        if (applied !== null) throw new Error('unexpected active profile')
        if (process.env.ANTHROPIC_API_KEY !== 'caller-api-key') {
          throw new Error('caller API key was deleted with no profile active')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'caller-bearer-token') {
          throw new Error('caller auth token was deleted with no profile active')
        }
        if (process.env.ANTHROPIC_BASE_URL !== 'https://caller.example.test') {
          throw new Error('caller base URL was deleted with no profile active')
        }
        if (process.env.ANTHROPIC_MODEL !== 'caller-model') {
          throw new Error('caller model was deleted with no profile active')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('can explicitly clear stale provider env when returning to Claude login', () => {
    // Anthropic credential installation intentionally replaces a third-party
    // provider. This must stay distinct from a clean CI invocation with
    // caller-owned env: the latter stays intact, whereas the former must not
    // retain MiniMax routing or its model into the next session.
    const configDir = mkdtempSync(join(tmpdir(), 'noa-login-clear-provider-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        process.env.ANTHROPIC_AUTH_TOKEN = 'minimax-bearer-token'
        process.env.ANTHROPIC_BASE_URL = 'https://api.minimax.test'
        process.env.ANTHROPIC_MODEL = 'MiniMax-M3'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        await applyActiveProviderProfileEnv({ clearProviderStateWhenInactive: true })

        for (const key of [
          'ANTHROPIC_AUTH_TOKEN',
          'ANTHROPIC_BASE_URL',
          'ANTHROPIC_MODEL',
        ]) {
          if (process.env[key] !== undefined) {
            throw new Error('stale provider env survived Claude login: ' + key)
          }
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('surfaces settings persistence failure during explicit provider cleanup', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-login-clear-failure-'))
    try {
      writeFileSync(join(configDir, 'settings.json'), '{invalid-json')
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        process.env.ANTHROPIC_MODEL = 'MiniMax-M3'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        let error
        try {
          await applyActiveProviderProfileEnv({ clearProviderStateWhenInactive: true })
        } catch (caught) {
          error = caught
        }
        if (!error) throw new Error('expected provider settings cleanup to fail')
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('--bare explicit cleanup clears disk state but preserves caller env', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-bare-login-cleanup-'))
    try {
      writeFileSync(
        join(configDir, 'settings.json'),
        JSON.stringify({
          model: 'claude-opus-4-1',
          env: {
            ANTHROPIC_BASE_URL: 'https://api.minimax.test',
            ANTHROPIC_AUTH_TOKEN: 'minimax-token',
            ANTHROPIC_MODEL: 'MiniMax-M3',
          },
        }),
      )
      const script = `
        process.argv.push('--bare')
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        process.env.ANTHROPIC_BASE_URL = 'https://caller.example.test'
        process.env.ANTHROPIC_AUTH_TOKEN = 'caller-token'
        process.env.ANTHROPIC_MODEL = 'caller-model'

        const { readFileSync } = await import('fs')
        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        await applyActiveProviderProfileEnv({ clearProviderStateWhenInactive: true })

        const settings = JSON.parse(
          readFileSync(${JSON.stringify(join(configDir, 'settings.json'))}, 'utf8'),
        )
        if (Object.keys(settings.env ?? {}).some(key => key.startsWith('ANTHROPIC_'))) {
          throw new Error('persisted provider env survived bare cleanup')
        }
        if (settings.model !== 'claude-opus-4-1') {
          throw new Error('explicit first-party model was removed')
        }
        if (process.env.ANTHROPIC_BASE_URL !== 'https://caller.example.test') {
          throw new Error('bare cleanup changed caller base URL')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'caller-token') {
          throw new Error('bare cleanup changed caller auth token')
        }
        if (process.env.ANTHROPIC_MODEL !== 'caller-model') {
          throw new Error('bare cleanup changed caller model')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('explicit OAuth cleanup fails if a provider becomes active concurrently', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-reactivated-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({ active: true, apiKey: 'profile-api-key' }),
        ]),
      )
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        let error
        try {
          await applyActiveProviderProfileEnv({ clearProviderStateWhenInactive: true })
        } catch (caught) {
          error = caught
        }
        if (!error) throw new Error('expected concurrent activation to block OAuth cleanup')
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('applies the active provider profile env outside bare mode', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-profile-apply-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({
            active: true,
            apiKey: 'profile-api-key',
          }),
        ]),
      )

      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        // Seed stale routing env rather than scrubbing it. Scrubbing first
        // makes every "must not survive" assertion below pass even with
        // applyActiveProviderProfileEnv's delete loop removed — it cannot
        // tell "cleared by the loop" from "never set". A kimi profile writes
        // only the ANTHROPIC_* keys, so the bedrock/vertex/openai ones are
        // reachable exclusively through that loop.
        process.env.CLAUDE_CODE_USE_BEDROCK = '1'
        process.env.OPENAI_API_KEY = 'stale-openai-key'
        process.env.ANTHROPIC_VERTEX_PROJECT_ID = 'stale-project'
        process.env.ANTHROPIC_API_KEY = 'stale-x-api-key'
        process.env.ANTHROPIC_AUTH_TOKEN = 'stale-bearer-token'
        process.env.ANTHROPIC_BASE_URL = 'https://stale.example.test'
        process.env.ANTHROPIC_MODEL = 'stale-model'
        process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'stale-opus'

        const { applyActiveProviderProfileEnv } =
          await import('./src/utils/providerProfile.ts')
        const applied = await applyActiveProviderProfileEnv()

        if (applied?.id !== 'provider-profile-test') {
          throw new Error('active profile was not applied')
        }
        // Kimi authenticates via Bearer token, never x-api-key: the stale key
        // must be deleted, since nothing overwrites it.
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'profile-api-key') {
          throw new Error('profile auth token not applied')
        }
        if (process.env.ANTHROPIC_API_KEY !== undefined) {
          throw new Error('stale API key survived for a Bearer-auth provider')
        }
        // Routing env for other backends must not outlive the switch.
        if (process.env.CLAUDE_CODE_USE_BEDROCK !== undefined) {
          throw new Error('stale CLAUDE_CODE_USE_BEDROCK survived the switch')
        }
        if (process.env.OPENAI_API_KEY !== undefined) {
          throw new Error('stale OPENAI_API_KEY survived the switch')
        }
        if (process.env.ANTHROPIC_VERTEX_PROJECT_ID !== undefined) {
          throw new Error('stale ANTHROPIC_VERTEX_PROJECT_ID survived the switch')
        }
        // getNormalizedBaseUrl strips trailing slashes.
        if (process.env.ANTHROPIC_BASE_URL !== 'https://api.kimi.com/coding') {
          throw new Error('profile base URL not applied')
        }
        if (process.env.ANTHROPIC_MODEL !== 'kimi-test-model') {
          throw new Error('profile model not applied')
        }
        if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL !== 'kimi-test-model') {
          throw new Error('stale default model env survived the switch')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      // Surface stderr as the failure message rather than asserting it is
      // empty: the subprocess signals failure by throwing, which is already a
      // non-zero status, so an empty-stderr assertion adds no signal and
      // breaks the moment bun writes an unrelated warning.
      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('selecting a profile deleted since mount activates nothing', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-profile-ghost-'))
    try {
      writeFileSync(
        join(configDir, 'provider-profiles.json'),
        JSON.stringify([
          profile({ id: 'kept', name: 'Kept', active: true, apiKey: 'kept-key' }),
          profile({
            id: 'ghost',
            name: 'Ghost',
            active: false,
            apiKey: 'ghost-key',
            baseUrl: 'https://ghost.example.test/',
          }),
        ]),
      )

      // This is the contract /provider's guard rests on. The picker's list is a
      // snapshot taken at mount, so a profile can be deleted before the user
      // hits enter. setActiveProviderProfile resolves to null instead of
      // throwing, and applyActiveProviderProfileEnv then applies whichever
      // profile is still active — the command used to report the selected one
      // as switched while the session ran on the other.
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        delete process.env.CLAUDE_CODE_SIMPLE
        const { writeFileSync } = await import('fs')
        const {
          loadProviderProfiles,
          setActiveProviderProfile,
          applyActiveProviderProfileEnv,
        } = await import('./src/utils/providerProfile.ts')

        const snapshot = await loadProviderProfiles()
        writeFileSync(
          ${JSON.stringify(join(configDir, 'provider-profiles.json'))},
          JSON.stringify(snapshot.filter(p => p.id !== 'ghost')),
        )

        const activated = await setActiveProviderProfile('ghost')
        if (activated !== null) {
          throw new Error('expected null for a profile that is gone from disk')
        }

        const applied = await applyActiveProviderProfileEnv()
        if (applied?.id !== 'kept') {
          throw new Error('expected the still-active profile to be applied')
        }
        if (process.env.ANTHROPIC_BASE_URL !== 'https://api.kimi.com/coding') {
          throw new Error('env did not follow the still-active profile')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('concurrent profile mutations do not overwrite each other', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-concurrent-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        const { addProviderProfile, loadProviderProfiles } =
          await import('./src/utils/providerProfile.ts')

        await Promise.all(
          Array.from({ length: 12 }, (_, index) =>
            addProviderProfile({
              name: 'Provider ' + index,
              type: 'minimax',
              model: 'model-' + index,
            }),
          ),
        )
        const profiles = await loadProviderProfiles()
        if (profiles.length !== 12) {
          throw new Error('concurrent writes lost profiles: ' + profiles.length)
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('keeps provider-profiles.json owner-only, repairing legacy modes', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-mode-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        const { statSync, writeFileSync, chmodSync } = await import('fs')
        const { join } = await import('path')
        const { addProviderProfile } = await import('./src/utils/providerProfile.ts')
        const path = join(${JSON.stringify(configDir)}, 'provider-profiles.json')

        await addProviderProfile({ name: 'Fresh', type: 'kimi', apiKey: 'sk-fresh-key' })
        const created = statSync(path).mode & 0o777
        if (created !== 0o600) {
          throw new Error('new profiles file is ' + created.toString(8) + ', want 600')
        }

        // A file written by a build that predates the mode above.
        chmodSync(path, 0o644)
        await addProviderProfile({ name: 'Second', type: 'minimax', apiKey: 'sk-second-key' })
        const repaired = statSync(path).mode & 0o777
        if (repaired !== 0o600) {
          throw new Error('legacy profiles file left at ' + repaired.toString(8))
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('pins the Claude tier aliases for MiniMax as well as Kimi', () => {
    for (const type of ['kimi', 'minimax'] as const) {
      const env = buildProviderEnv(
        profile({ type, model: 'single-served-model', apiKey: 'sk-token' }),
      )
      // Both endpoints serve exactly one model; an unpinned alias resolves to a
      // claude-* id they do not have.
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('single-served-model')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('single-served-model')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('single-served-model')
      expect(env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('single-served-model')
    }
  })

  test('rejects any non-printable-ASCII credential, not just CJK', () => {
    for (const bad of ['sk-\u6d4b\u8bd5key', 'sk-\u30c6\u30b9\u30c8key', 'sk-\u043a\u043b\u044e\u0447', 'sk key', 'sk-\u0007key']) {
      expect(() =>
        normalizeProviderProfileCredential(profile({ apiKey: bad })),
      ).toThrow(/invalid API key/)
    }
    expect(
      normalizeProviderProfileCredential(profile({ apiKey: 'sk-ABC_123-x.y+z=' }))
        .apiKey,
    ).toBe('sk-ABC_123-x.y+z=')
  })

  test('a partial update leaves fields it does not mention alone', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-partial-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        const { addProviderProfile, updateProviderProfile } =
          await import('./src/utils/providerProfile.ts')

        const created = await addProviderProfile({
          name: 'Kimi', type: 'kimi', model: 'm1', apiKey: 'sk-keep-me',
        })
        // The setup wizard sends apiKey: undefined whenever its field is blank.
        const updated = await updateProviderProfile(created.id, {
          name: 'Kimi', type: 'kimi', model: 'm2', apiKey: undefined,
        })
        if (updated.apiKey !== 'sk-keep-me') {
          throw new Error('partial update erased the stored key: ' + updated.apiKey)
        }
        if (updated.model !== 'm2') {
          throw new Error('partial update did not apply model')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })

      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('does not carry a secret across a provider endpoint change', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-endpoint-key-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        const { addProviderProfile, updateProviderProfile } =
          await import('./src/utils/providerProfile.ts')

        const created = await addProviderProfile({
          name: 'Shared', type: 'openai', baseUrl: 'https://old.example/v1',
          model: 'old-model', apiKey: 'sk-old-secret',
        })
        const updated = await updateProviderProfile(created.id, {
          type: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1',
          model: 'local-model', apiKey: undefined,
        })
        if (updated.apiKey !== undefined) {
          throw new Error('old key survived endpoint change')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('deactivates a provider for next launch without breaking the current route', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-provider-next-launch-'))
    try {
      const script = `
        process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(configDir)}
        const { writeFileSync, readFileSync } = await import('fs')
        const { join } = await import('path')
        const m = await import('./src/utils/providerProfile.ts')
        const created = await m.addProviderProfile({
          name: 'MiniMax', type: 'minimax', baseUrl: 'https://api.minimax.test',
          model: 'm', apiKey: 'sk-current',
        })
        await m.setActiveProviderProfile(created.id)
        await m.applyActiveProviderProfileEnv()

        await m.deactivateProviderProfilesForNextLaunch()

        if (process.env.ANTHROPIC_BASE_URL !== 'https://api.minimax.test') {
          throw new Error('current route was removed')
        }
        if (process.env.ANTHROPIC_AUTH_TOKEN !== 'sk-current') {
          throw new Error('current credential was removed')
        }
        const profiles = JSON.parse(readFileSync(join(${JSON.stringify(configDir)}, 'provider-profiles.json'), 'utf8'))
        if (profiles.some(profile => profile.active)) {
          throw new Error('profile remained active on disk')
        }
        const settings = JSON.parse(readFileSync(join(${JSON.stringify(configDir)}, 'settings.json'), 'utf8'))
        if (Object.keys(settings.env ?? {}).some(key => key.startsWith('ANTHROPIC_') || key.startsWith('OPENAI_'))) {
          throw new Error('provider route remained persisted for next launch')
        }
      `
      const result = spawnSync('bun', ['--eval', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
      })
      if (result.status !== 0) throw new Error(result.stderr)
      expect(result.status).toBe(0)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

})
