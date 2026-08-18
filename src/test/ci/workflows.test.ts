import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'bun:test'
import { parse } from 'yaml'
import { getInteractiveSmokeCommand } from '../../../scripts/interactive-smoke-command.ts'

const repoRoot = resolve(import.meta.dir, '../../..')

describe('GitHub Actions workflow contracts', () => {
  test('PR Quality Gate runs the repository quality command', () => {
    const workflow = parse(
      readFileSync(resolve(repoRoot, '.github/workflows/pr-quality-gate.yml'), 'utf8'),
    )
    const commands = workflow.jobs.quality.steps
      .map((step: { run?: string }) => step.run)
      .filter((command: unknown): command is string => typeof command === 'string')

    expect(commands).toContain('bun run check:quality')
  })

  test('engineering smoke uses the util-linux script command contract', () => {
    expect(getInteractiveSmokeCommand('linux', "/tmp/Noa Claude's/bin/noa.js")).toEqual({
      command: 'timeout',
      args: [
        '3',
        '/usr/bin/script',
        '-q',
        '-c',
        `/bin/bash -lc '/tmp/Noa Claude'"'"'s/bin/noa.js'`,
        '/dev/null',
      ],
    })
  })

  test('engineering smoke preserves the BSD script contract on macOS', () => {
    expect(getInteractiveSmokeCommand('darwin', '/tmp/noa.js')).toEqual({
      command: 'timeout',
      args: [
        '3',
        '/usr/bin/script',
        '-q',
        '/dev/null',
        '/bin/zsh',
        '-lc',
        '/tmp/noa.js',
      ],
    })
  })

  test('Engineering Live Smoke accepts an auth token', () => {
    const fakeBinDir = mkdtempSync(resolve(tmpdir(), 'noa-live-smoke-bin-'))
    try {
      const fakeBun = resolve(fakeBinDir, 'bun')
      writeFileSync(fakeBun, '#!/bin/sh\nexit 0\n')
      chmodSync(fakeBun, 0o755)

      const result = spawnSync(process.execPath, [
        resolve(repoRoot, 'scripts/smoke-engineering-live.mjs'),
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: 'test-auth-token',
        },
      })
      const output = `${result.stdout}${result.stderr}`

      expect(output).not.toContain('Missing ANTHROPIC_API_KEY for live smoke')
      expect(output).toContain('Running engineering smoke baseline before live checks')
    } finally {
      rmSync(fakeBinDir, { recursive: true, force: true })
    }
  })
})
