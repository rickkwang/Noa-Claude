// Exercise the real Bash permission pipeline for dangerouslyDisableSandbox with
// sandboxing enabled from settings. No shell command is executed.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const artifacts = process.argv.includes('--artifacts') ? resolve(process.argv[process.argv.indexOf('--artifacts') + 1]!) : mkdtempSync(join(tmpdir(), 'noa-sandbox-override-e2e-'))
mkdirSync(join(artifacts, 'config'), { recursive: true })
mkdirSync(join(artifacts, 'project'), { recursive: true })
// Run from an empty project so the checkout's .noa settings cannot leak in.
process.chdir(join(artifacts, 'project'))
for (const name of Object.keys(process.env)) if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
const settingsPath = join(artifacts, 'config', 'settings.json')
const writeSandbox = (sandbox: Record<string, unknown>) => writeFileSync(settingsPath, JSON.stringify({ sandbox }))
writeSandbox({ enabled: true })
;(globalThis as any).MACRO = { VERSION: '1.17.0' }
const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
const { hasPermissionsToUseTool, checkRuleBasedPermissions } = await import('../src/utils/permissions/permissions.js')
const { BashTool } = await import('../src/tools/BashTool/BashTool.js')
const { SandboxManager } = await import('../src/utils/sandbox/sandbox-adapter.js')
const { resetSettingsCache } = await import('../src/utils/settings/settingsCache.js')
const { createAssistantMessage } = await import('../src/utils/messages.js')

if (!SandboxManager.isSandboxingEnabled()) {
  // macOS always ships sandbox-exec, so a miss there is a detection regression.
  if (process.platform === 'darwin') throw new Error(`sandboxing reported unavailable on macOS; see ${artifacts}`)
  console.log(`SKIP sandboxing unavailable on this host (${process.platform}); see ${artifacts}`)
  process.exit(0)
}

type Case = { name: string, mode?: string, allow?: string[], sandbox?: Record<string, unknown>, input: Record<string, unknown>, behavior: string, reason?: string, hookPath?: boolean }
const command = 'echo noa-sandbox-override'
const escape = { command, dangerouslyDisableSandbox: true }
const cases: Case[] = [
  { name: 'escape asks', input: escape, behavior: 'ask', reason: 'sandboxOverride' },
  { name: 'sandboxed call runs', input: { command }, behavior: 'allow' },
  { name: 'whole-tool allow rule does not cover an escape', allow: ['Bash'], input: escape, behavior: 'ask', reason: 'sandboxOverride' },
  { name: 'content allow rule covers the escape', allow: [`Bash(${command})`], input: escape, behavior: 'allow', reason: 'rule' },
  { name: 'compound command allowed by rules covers the escape', allow: ['Bash(echo:*)'], input: { command: 'echo a && echo b', dangerouslyDisableSandbox: true }, behavior: 'allow', reason: 'subcommandResults' },
  { name: 'bypassPermissions allows the escape', mode: 'bypassPermissions', input: escape, behavior: 'allow', reason: 'mode' },
  { name: 'policy forbids unsandboxed: stays sandboxed', sandbox: { enabled: true, allowUnsandboxedCommands: false }, input: escape, behavior: 'allow' },
  { name: 'hook allow cannot skip the escape prompt', hookPath: true, input: escape, behavior: 'ask', reason: 'sandboxOverride' },
]

const observed: unknown[] = []
let passed = false
try {
  for (const c of cases) {
    writeSandbox(c.sandbox ?? { enabled: true })
    resetSettingsCache()
    const toolPermissionContext = { ...getEmptyToolPermissionContext(), mode: c.mode ?? 'default', alwaysAllowRules: { localSettings: c.allow ?? [] } }
    const context: any = { getAppState: () => ({ toolPermissionContext }), abortController: new AbortController(), options: { isNonInteractiveSession: false, tools: [BashTool] }, messages: [] }
    const result: any = c.hookPath
      ? await checkRuleBasedPermissions(BashTool, c.input, context)
      : await hasPermissionsToUseTool(BashTool, c.input, context, createAssistantMessage({ content: 'Permission fixture' }), 'fixture')
    observed.push({ ...c, result })
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify(observed, null, 2))
    assert.equal(result?.behavior, c.behavior, c.name)
    if (c.reason) assert.equal(result.decisionReason?.type, c.reason, c.name)
  }
  passed = true
  console.log(`PASS ${observed.length} sandbox-override decisions; no shell command executed`)
} finally {
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, inputs: cases, transport: 'Real Bash permission pipeline with sandboxing enabled from settings; tool execution never invoked', observed: observed.length, exit_code: passed ? 0 : 1 }, null, 2))
}
