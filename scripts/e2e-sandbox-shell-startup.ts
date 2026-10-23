import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const artifacts = process.argv.includes('--artifacts')
  ? resolve(process.argv[process.argv.indexOf('--artifacts') + 1]!)
  : mkdtempSync(join(tmpdir(), 'noa-sandbox-shell-startup-'))
const project = join(artifacts, 'project')
const config = join(artifacts, 'config')
const home = join(artifacts, 'home')
const zdot = join(artifacts, 'zdot')
const marker = join(artifacts, 'startup-outside-sandbox')
const command = 'printf sandboxed-ok'
for (const dir of [project, config, home, zdot]) mkdirSync(dir, { recursive: true })
process.chdir(project)
for (const name of Object.keys(process.env)) {
  if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
}
delete process.env.ZDOTDIR
process.env.HOME = home
process.env.CLAUDE_CONFIG_DIR = config
process.env.CLAUDE_CODE_SHELL = '/bin/zsh'
process.env.SHELL = '/bin/zsh'
writeFileSync(
  join(config, 'settings.json'),
  JSON.stringify({ sandbox: { enabled: true } }),
)
;(globalThis as any).MACRO = { VERSION: '1.17.0' }

const { setCwdState } = await import('../src/bootstrap/state.js')
const { exec } = await import('../src/utils/Shell.js')
const { SandboxManager } = await import('../src/utils/sandbox/sandbox-adapter.js')

let passed = false
let skipped = false
const observed: Record<string, unknown> = { artifacts, command }
try {
  setCwdState(project)
  if (!SandboxManager.isSandboxingEnabled()) {
    skipped = true
    console.log(`SKIP sandboxing unavailable on this host; see ${artifacts}`)
  } else {
    await SandboxManager.initialize()
    const warmup = await exec(
      'true',
      new AbortController().signal,
      'bash',
      { shouldUseSandbox: true },
    )
    assert.equal((await warmup.result).code, 0)
    process.env.ZDOTDIR = zdot
    writeFileSync(join(zdot, '.zshenv'), `print startup-executed > '${marker}'\n`)

    const shell = await exec(command, new AbortController().signal, 'bash', {
      shouldUseSandbox: true,
    })
    const result = await shell.result
    Object.assign(observed, {
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      startupFileExecutedOutsideSandbox: existsSync(marker),
    })
    assert.equal(result.code, 0)
    assert.match(result.stdout, /sandboxed-ok/)
    assert.equal(existsSync(marker), false)
    passed = true
    console.log(`PASS sandboxed shell startup stayed inside the sandbox; see ${artifacts}`)
  }
} finally {
  let revision = 'unavailable'
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: resolve(import.meta.dir, '..'),
      encoding: 'utf8',
    }).trim()
  } catch {}
  writeFileSync(
    join(artifacts, 'verification.manifest.json'),
    JSON.stringify(
      {
        command: process.argv,
        revision,
        inputs: { command, shell: '/bin/zsh', zdot, marker },
        observed,
        skipped,
        exit_code: passed || skipped ? 0 : 1,
      },
      null,
      2,
    ),
  )
}
