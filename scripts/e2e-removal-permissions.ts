// Exercise Bash's real permission pipeline without executing removal commands.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const artifacts = process.argv.includes('--artifacts') ? resolve(process.argv[process.argv.indexOf('--artifacts') + 1]!) : mkdtempSync(join(tmpdir(), 'noa-removal-e2e-'))
mkdirSync(artifacts, { recursive: true })
for (const name of Object.keys(process.env)) if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
;(globalThis as any).MACRO = { VERSION: '1.17.0' }
const { getEmptyToolPermissionContext } = await import('../src/Tool.js')
const { hasPermissionsToUseTool } = await import('../src/utils/permissions/permissions.js')
const { BashTool } = await import('../src/tools/BashTool/BashTool.js')
const { createAssistantMessage } = await import('../src/utils/messages.js')
const dangerous = [
  '/usr/bin/sudo -iu root rm -rf /', '/usr/bin/env -S "rm -rf /"',
  'sudo -iu root rm -rf "$HOME"', 'sudo -Hu root rm -rf "$HOME"',
  'sudo -uroot rm -rf /', 'sudo --user=root rm -rf /', 'sudo -u root -- rm -rf /',
  'env -S "rm -rf /"', 'env --split-string="rm -rf /"', 'env -Srm -rf /', 'env -iS "rm -rf /"',
  'find "$HOME" -name "*" -delete', 'find / -iname "*" -a -delete',
  'env -S "rm\\_-rf\\_/"', 'env -S "rm -rf" "$HOME"',
  'find / -name "**" -delete', 'find / -name "fixture-specific-file" -o -delete',
  'find / -name "*" -a -delete -o -false', 'find / ! -false -delete',
  'find -delete', 'find -L -delete', 'find "$(pwd)" -delete',
]
const benign = [
  'sudo -iu root rm -rf build', 'sudo -uroot rm -rf build',
  'env -S "rm -rf build"', 'env --split-string="rm -rf build"',
  'env -S "rm -rf" "\\$HOME"', 'env -S "rm -rf" "build/has\'quote"',
  'find build -name "*.o" -o -delete',
  'find . -name "*.o" -delete', 'find / -name "fixture-specific-file" -delete',
  'find build -name "*" -delete', 'find build -delete', 'rm -rf build',
]
const observed: unknown[] = []
let passed = false
try {
  for (const mode of ['default', 'bypassPermissions']) {
    const toolPermissionContext = { ...getEmptyToolPermissionContext(), mode, alwaysAllowRules: { localSettings: ['Bash(*)'] } }
    const context: any = { getAppState: () => ({ toolPermissionContext }), abortController: new AbortController(), options: { isNonInteractiveSession: false, tools: [BashTool] }, messages: [] }
    for (const command of [...dangerous, ...benign]) {
      const result = await hasPermissionsToUseTool(BashTool, { command }, context, createAssistantMessage({ content: 'Permission fixture' }), 'fixture')
      observed.push({ mode, command, result })
      writeFileSync(join(artifacts, 'results.json'), JSON.stringify(observed, null, 2))
      if (dangerous.includes(command)) {
        assert.equal(result.behavior, 'ask', `${mode}: ${command}`)
        assert.equal(result.decisionReason?.type, 'safetyCheck', `${mode}: ${command}`)
      } else {
        assert.notEqual(result.decisionReason?.type, 'safetyCheck', `${mode}: ordinary cleanup was blocked`)
        if (mode === 'bypassPermissions') assert.equal(result.behavior, 'allow', command)
      }
    }
  }
  passed = true
  console.log(`PASS ${observed.length} permission decisions; no shell command executed`)
} finally {
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim() } catch {}
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, inputs: { dangerous, benign }, source_sha256: sha(resolve(import.meta.dir, '../src/tools/BashTool/pathValidation.ts')), transport: 'Real Bash permission pipeline including bypass-mode precedence; tool execution never invoked', observed: observed.length, exit_code: passed ? 0 : 1 }, null, 2))
}
