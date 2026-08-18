// @ts-nocheck
import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'child_process'
import { mkdir, open, rm, stat } from 'fs/promises'
import { generateTaskId } from '../../Task.js'
import { type ShellCommand, wrapSpawn } from '../../utils/ShellCommand.js'
import { getTaskOutputDir } from '../../utils/task/diskOutput.js'
import { TaskOutput } from '../../utils/task/TaskOutput.js'

// Process-lifecycle coverage for the layer BashTool sits on: nothing else in
// the suite spawns a real child through wrapSpawn, so the timeout / abort /
// size-cap / background transitions were previously unverified end to end.

const spawned: ShellCommand[] = []

/**
 * Spawn a real `/bin/sh -c` in file mode — both fds land on the task output
 * file, exactly like BashTool's Shell.exec does.
 */
async function runInFileMode(
  script: string,
  opts: {
    timeout?: number
    shouldAutoBackground?: boolean
    maxOutputBytes?: number
    signal?: AbortSignal
  } = {},
): Promise<{ shellCommand: ShellCommand; taskOutput: TaskOutput }> {
  await mkdir(getTaskOutputDir(), { recursive: true })
  const taskOutput = new TaskOutput(generateTaskId('local_bash'), null, true)
  const handle = await open(taskOutput.path, 'w')
  const childProcess = spawn('/bin/sh', ['-c', script], {
    stdio: ['pipe', handle.fd, handle.fd],
    detached: true,
  })
  const shellCommand = wrapSpawn(
    childProcess,
    opts.signal ?? new AbortController().signal,
    opts.timeout ?? 30_000,
    taskOutput,
    opts.shouldAutoBackground ?? false,
    opts.maxOutputBytes,
  )
  await handle.close()
  spawned.push(shellCommand)
  return { shellCommand, taskOutput }
}

afterEach(async () => {
  for (const shellCommand of spawned.splice(0)) {
    try {
      shellCommand.kill()
      shellCommand.cleanup()
      await rm(shellCommand.taskOutput.path, { force: true })
    } catch {
      // best effort — the test already asserted what it cared about
    }
  }
})

describe('ShellCommand size watchdog', () => {
  // Regression: the watchdog used to be armed only inside background(), so the
  // whole foreground window (2 min by default) was uncapped. A runaway writer
  // sustains >1 GB/s in file mode, which fills the disk long before the
  // timeout fires.
  test('kills a FOREGROUND command whose output file exceeds the cap', async () => {
    const { shellCommand } = await runInFileMode(
      'while :; do printf "%0.sx" $(seq 1 4096); done',
      { maxOutputBytes: 256 * 1024, timeout: 60_000 },
    )

    const result = await shellCommand.result

    expect(shellCommand.status).toBe('killed')
    expect(result.stderr).toContain('output file exceeded')
    // The kill message must not claim the command was backgrounded.
    expect(result.stderr).not.toContain('Background command')
  }, 20_000)

  test('still kills a BACKGROUNDED command over the cap', async () => {
    const { shellCommand } = await runInFileMode(
      'while :; do printf "%0.sx" $(seq 1 4096); done',
      { maxOutputBytes: 256 * 1024, timeout: 60_000 },
    )
    expect(shellCommand.background('local_bash_test_bg')).toBe(true)
    expect(shellCommand.status).toBe('backgrounded')

    const result = await shellCommand.result

    expect(result.stderr).toContain('output file exceeded')
  }, 20_000)

  test('leaves a well-behaved command alone', async () => {
    const { shellCommand } = await runInFileMode('echo small')
    const result = await shellCommand.result
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe('small')
    expect(result.stderr).toBe('')
  }, 15_000)
})

describe('ShellCommand timeout', () => {
  // Regression: the timeout notice only exists on ExecResult.stderr. BashTool
  // used to drop that field, leaving the model with a bare "Exit code 143".
  test('kills on timeout and reports it on stderr', async () => {
    const { shellCommand } = await runInFileMode('sleep 30', { timeout: 300 })

    const result = await shellCommand.result

    expect(result.code).toBe(143)
    expect(result.stderr).toContain('Command timed out after')
    expect(shellCommand.status).toBe('killed')
  }, 15_000)

  test('auto-background handoff replaces the kill when a callback is set', async () => {
    const { shellCommand } = await runInFileMode('sleep 2', {
      timeout: 300,
      shouldAutoBackground: true,
    })
    let handedOff = false
    shellCommand.onTimeout?.(backgroundFn => {
      handedOff = true
      backgroundFn('local_bash_test_timeout_bg')
    })

    const result = await shellCommand.result

    expect(handedOff).toBe(true)
    expect(result.code).toBe(0)
    expect(result.backgroundTaskId).toBe('local_bash_test_timeout_bg')
    // Backgrounding clears the foreground timeout — the command was allowed to
    // run past it rather than being killed at 300ms.
    expect(result.stderr).not.toContain('timed out')
  }, 15_000)

  test('background() clears the timeout so a long task survives it', async () => {
    const { shellCommand } = await runInFileMode('sleep 1; echo done', {
      timeout: 200,
    })
    expect(shellCommand.background('local_bash_test_survives')).toBe(true)

    const result = await shellCommand.result

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('done')
    expect(result.stderr).not.toContain('timed out')
  }, 15_000)

  test('background() is rejected once the command is no longer running', async () => {
    const { shellCommand } = await runInFileMode('echo x')
    await shellCommand.result
    expect(shellCommand.status).toBe('completed')
    expect(shellCommand.background('local_bash_test_late')).toBe(false)
  }, 15_000)
})

describe('ShellCommand abort', () => {
  test('a plain abort kills the command and marks it interrupted', async () => {
    const abortController = new AbortController()
    const { shellCommand } = await runInFileMode('sleep 30', {
      signal: abortController.signal,
    })
    abortController.abort('user-cancel')

    const result = await shellCommand.result

    expect(result.interrupted).toBe(true)
    expect(result.code).toBe(137)
    expect(shellCommand.status).toBe('killed')
  }, 15_000)

  test("abort reason 'interrupt' deliberately does NOT kill", async () => {
    const abortController = new AbortController()
    const { shellCommand } = await runInFileMode('sleep 0.3; echo survived', {
      signal: abortController.signal,
    })
    abortController.abort('interrupt')

    const result = await shellCommand.result

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('survived')
  }, 15_000)
})

describe('ShellCommand exit-code mapping', () => {
  test('propagates a non-zero exit code without marking it interrupted', async () => {
    const { shellCommand } = await runInFileMode('echo boom 1>&2; exit 7')
    const result = await shellCommand.result
    expect(result.code).toBe(7)
    expect(result.interrupted).toBe(false)
    // stderr is interleaved into the shared output file, not ExecResult.stderr
    expect(result.stdout).toContain('boom')
    expect(result.stderr).toBe('')
  }, 15_000)

  test('small output is inlined and the output file is dropped', async () => {
    const { shellCommand, taskOutput } = await runInFileMode('echo inline-me')
    const result = await shellCommand.result

    expect(result.outputFilePath).toBeUndefined()
    expect(taskOutput.outputFileRedundant).toBe(true)
    // deleteOutputFile() is fire-and-forget; give it a turn to land.
    await new Promise(resolve => setTimeout(resolve, 50))
    await expect(stat(taskOutput.path)).rejects.toThrow()
  }, 15_000)

  test('large output stays on disk and is reported to the caller', async () => {
    const { shellCommand, taskOutput } = await runInFileMode(
      'i=0; while [ $i -lt 400 ]; do printf "%0.sy" $(seq 1 200); echo; i=$((i+1)); done',
    )
    const result = await shellCommand.result

    expect(result.outputFilePath).toBe(taskOutput.path)
    expect(result.outputTaskId).toBe(taskOutput.taskId)
    expect(result.outputFileSize).toBeGreaterThan(result.stdout.length)
  }, 15_000)
})
