// Exercise bypass state boundaries without executing the requested Write.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const artifacts = process.argv.includes('--artifacts') ? resolve(process.argv[process.argv.indexOf('--artifacts') + 1]!) : mkdtempSync(join(tmpdir(), 'noa-bypass-state-e2e-'))
mkdirSync(artifacts, { recursive: true })
for (const name of Object.keys(process.env)) if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
process.env.CLAUDE_CODE_PRODUCT_DIR = process.env.CLAUDE_CONFIG_DIR
process.env.NODE_ENV = 'test'
;(globalThis as any).MACRO = { VERSION: '1.17.0' }

const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
const { FileWriteTool } = await import('../src/tools/FileWriteTool/FileWriteTool.js')
const { createAssistantMessage } = await import('../src/utils/messages.js')
const { applyPermissionUpdate, persistPermissionUpdate } = await import('../src/utils/permissions/PermissionUpdate.js')
const { initialPermissionModeFromCLI } = await import('../src/utils/permissions/permissionSetup.js')
const { hasPermissionsToUseTool } = await import('../src/utils/permissions/permissions.js')
const { resetSettingsCache } = await import('../src/utils/settings/settingsCache.js')

const observed: unknown[] = []
let passed = false
try {
  const base = getEmptyToolPermissionContext()
  const rejected = applyPermissionUpdate(base, { type: 'setMode', mode: 'bypassPermissions', destination: 'session' })
  assert.equal(rejected.mode, 'default')
  const available = { ...base, isBypassPermissionsModeAvailable: true }
  const accepted = applyPermissionUpdate(available, { type: 'setMode', mode: 'bypassPermissions', destination: 'session' })
  assert.equal(accepted.mode, 'bypassPermissions')
  observed.push({ setModeRejected: rejected.mode, setModeAccepted: accepted.mode })

  assert.equal(initialPermissionModeFromCLI({ permissionModeCli: undefined, dangerouslySkipPermissions: undefined, inheritedPermissionMode: 'bypassPermissions' }).mode, 'default')
  mkdirSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true })
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json'), JSON.stringify({ skipDangerousModePermissionPrompt: true }))
  resetSettingsCache()
  assert.equal(initialPermissionModeFromCLI({ permissionModeCli: undefined, dangerouslySkipPermissions: undefined, inheritedPermissionMode: 'bypassPermissions' }).mode, 'bypassPermissions')
  observed.push({ inheritedWithoutConsent: 'default', inheritedWithConsent: 'bypassPermissions' })

  const settingsPath = join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json')
  writeFileSync(settingsPath, '{}')
  resetSettingsCache()
  persistPermissionUpdate({ type: 'setMode', mode: 'bypassPermissions', destination: 'userSettings' })
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).permissions, undefined)
  persistPermissionUpdate({ type: 'setMode', mode: 'acceptEdits', destination: 'userSettings' })
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).permissions.defaultMode, 'acceptEdits')
  observed.push({ bypassPersisted: false, acceptEditsPersisted: true })

  for (const isNonInteractiveSession of [true, false]) {
    const toolPermissionContext = { ...available, mode: 'plan', prePlanMode: 'bypassPermissions' }
    const context: any = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext }),
      options: { isNonInteractiveSession, tools: [FileWriteTool] },
      messages: [],
    }
    const result = await hasPermissionsToUseTool(FileWriteTool, { file_path: join(artifacts, 'not-written.txt'), content: 'not written' }, context, createAssistantMessage({ content: 'Permission fixture' }), 'fixture')
    assert.equal(result.behavior, isNonInteractiveSession ? 'ask' : 'allow')
    observed.push({ isNonInteractiveSession, planWrite: result.behavior })
  }
  assert.equal(existsSync(join(artifacts, 'not-written.txt')), false)
  passed = true
  console.log('PASS bypass setMode, consent inheritance, persistence, and plan boundaries; no Write executed')
} finally {
  let revision = 'unavailable'
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(observed, null, 2))
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({
    command: process.argv,
    revision,
    transport: 'Real permission state and decision functions; tool execution never invoked',
    source_sha256: {
      permissionUpdate: sha(resolve(import.meta.dir, '../src/utils/permissions/PermissionUpdate.ts')),
      permissionSetup: sha(resolve(import.meta.dir, '../src/utils/permissions/permissionSetup.ts')),
      permissions: sha(resolve(import.meta.dir, '../src/utils/permissions/permissions.ts')),
    },
    observed: observed.length,
    exit_code: passed ? 0 : 1,
  }, null, 2))
}
console.log(`Evidence: ${artifacts}`)
