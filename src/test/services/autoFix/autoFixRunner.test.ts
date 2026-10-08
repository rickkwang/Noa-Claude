import { describe, expect, test } from 'bun:test'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from '../../../services/autoFix/autoFixRunner.js'

describe('autoFix command execution', () => {
  test('enforces the deadline for a running command', async () => {
    const started = performance.now()
    const result = await runCommand('/bin/sleep 0.6', 50)
    expect(result.timedOut).toBe(true)
    expect(result.success).toBe(false)
    expect(performance.now() - started).toBeLessThan(500)
  })
  test('preserves shell quoting and operators', async () => {
    const result = await runCommand('printf "hello world" && printf "diagnostic" >&2', 1000)
    expect(result).toMatchObject({ success: true, stdout: 'hello world', stderr: 'diagnostic', exitCode: 0 })
  })

  test('timeout stops the shell and its child before later side effects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noa-autofix-timeout-'))
    const marker = join(dir, 'finished')
    const started = join(dir, 'started')
    try {
      const result = await runCommand(`/bin/sh -c "touch '${started}'; sleep 0.5; touch '${marker}'" & wait`, 150)
      expect(result.timedOut).toBe(true)
      expect(result.success).toBe(false)
      expect(existsSync(started)).toBe(true)
      await Bun.sleep(600)
      expect(existsSync(marker)).toBe(false)
      expect((await runCommand(`touch '${marker}'`, 1000)).success).toBe(true)
      expect(existsSync(marker)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('returns when the command exits even if a detached descendant holds its output open', async () => {
    const started = performance.now()
    const result = await runCommand(`perl -e 'use POSIX; setsid(); sleep 3' & echo lint-ok`, 2000)
    expect(result).toMatchObject({ success: true, timedOut: false, exitCode: 0 })
    expect(result.stdout.trim()).toBe('lint-ok')
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
