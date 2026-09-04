import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertToSandboxRuntimeConfig } from '../../../utils/sandbox/sandbox-adapter.js'
import { resetSettingsCache } from '../../../utils/settings/settingsCache.js'

// SandboxRuntimeConfig is `z.infer` of a very large schema and TS gives up on
// the nested shape, so narrow the two sections this test asserts on.
type FsConfig = {
  allowWrite?: string[]
  denyWrite?: string[]
  denyRead?: string[]
  allowRead?: string[]
}
type NetConfig = { allowedDomains?: string[]; deniedDomains?: string[] }

function fsOf(config: { filesystem?: unknown }): FsConfig {
  return (config.filesystem ?? {}) as FsConfig
}
function netOf(config: { network?: unknown }): NetConfig {
  return (config.network ?? {}) as NetConfig
}

// sandbox-adapter used to keep a local copy of the permission rule parser that
// could not parse a rule whose content contained a parenthesis. An unparsed
// rule yields no ruleContent, and convertToSandboxRuntimeConfig skips those —
// so `deny: ["Edit(//x/Docs (v2)/**)"]` never reached denyWrite and a folder
// the user marked read-only stayed writable from a sandboxed Bash command.

describe('permission rules whose paths contain parentheses', () => {
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

  function writeSettings(permissions: Record<string, string[]>): void {
    const configDir = mkdtempSync(join(tmpdir(), 'noa-paren-rules-'))
    tempDirs.push(configDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({ permissions }),
    )
    resetSettingsCache()
  }

  test('a deny rule for a literal-parenthesis path reaches the sandbox', () => {
    writeSettings({
      deny: ['Edit(//srv/Read Only (v2)/**)', 'Read(//srv/Secrets (prod)/**)'],
    })

    const config = convertToSandboxRuntimeConfig({})

    expect(fsOf(config).denyWrite).toContain('/srv/Read Only (v2)/**')
    expect(fsOf(config).denyRead).toContain('/srv/Secrets (prod)/**')
  })

  test('a deny rule in the escaped form the rule writer emits reaches the sandbox', () => {
    // permissionRuleValueToString escapes parens, so this is what /permissions
    // and the permission prompt actually persist for such a path.
    writeSettings({ deny: ['Edit(//srv/Read Only \\(v2\\)/**)'] })

    const config = convertToSandboxRuntimeConfig({})

    expect(fsOf(config).denyWrite).toContain('/srv/Read Only (v2)/**')
  })

  test('an allow rule for a parenthesis path reaches the sandbox write allowlist', () => {
    writeSettings({ allow: ['Edit(//srv/Build Output (ci)/**)'] })

    const config = convertToSandboxRuntimeConfig({})

    expect(fsOf(config).allowWrite).toContain('/srv/Build Output (ci)/**')
  })

  test('a WebFetch domain rule is unaffected by the parser change', () => {
    // Domains are read from the merged settings argument, not per-source.
    const permissions = {
      allow: ['WebFetch(domain:example.com)'],
      deny: ['WebFetch(domain:evil.example)'],
    }
    writeSettings(permissions)

    const config = convertToSandboxRuntimeConfig({ permissions })

    expect(netOf(config).allowedDomains).toContain('example.com')
    expect(netOf(config).deniedDomains).toContain('evil.example')
  })

  // `Edit`, `Edit(*)` and `Edit()` all mean "the Edit tool", not a path. The
  // permission layer agrees: getRuleByContentsForToolName only builds a path
  // pattern for a rule with a defined ruleContent, so a tool-wide rule matches
  // no path there. The old local parser disagreed for the `(*)` spelling alone
  // and pushed a bare `*` into the sandbox's allowWrite/denyWrite. Both layers
  // now read these rules the same way.
  test('tool-wide rules contribute no filesystem paths', () => {
    writeSettings({
      allow: ['Edit', 'Edit(*)', 'Edit()'],
      deny: ['Read', 'Read(*)', 'Read()'],
    })

    const config = convertToSandboxRuntimeConfig({})

    expect(fsOf(config).allowWrite).not.toContain('*')
    expect(fsOf(config).allowWrite).not.toContain('')
    expect(fsOf(config).denyRead).not.toContain('*')
    expect(fsOf(config).denyRead).not.toContain('')
  })
})
