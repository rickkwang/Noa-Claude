// @ts-nocheck
import { afterAll, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'fs/promises'
import {
  BashTool,
  isAutobackgroundingAllowed,
  resolveTimeoutMs,
} from '../../tools/BashTool/BashTool.js'

// Result-shaping coverage for BashTool.call(). These run real commands through
// the real Shell/ShellCommand/TaskOutput stack — the fake context below is only
// what call() reads, no mocks of the execution path.

const createdFiles: string[] = []

function toolUseContext(abortController = new AbortController()) {
  return {
    abortController,
    getAppState: () => ({
      tasks: {},
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
      },
    }),
    setAppState: () => {},
    setToolJSX: () => {},
    readFileState: new Map(),
    updateFileHistoryState: () => {},
    options: { isNonInteractiveSession: true, tools: [], verbose: false },
    toolUseId: 'test-tool-use-id',
  }
}

/** Emits `lines` lines of ~200 chars — enough to blow past the 30 KB inline cap. */
function bigOutputScript(lines: number, exitCode: number): string {
  return `i=0; while [ $i -lt ${lines} ]; do printf '%0.sz' $(seq 1 200); echo " line$i"; i=$((i+1)); done; exit ${exitCode}`
}

afterAll(async () => {
  for (const file of createdFiles) {
    await rm(file, { force: true })
  }
})

describe('resolveTimeoutMs', () => {
  // Regression: `timeout` used to be used raw (`timeout || default`), so a
  // model-supplied 10-hour value became a 10-hour foreground budget even
  // though the schema advertises a 10-minute ceiling.
  const withEnv = <T,>(env: Record<string, string>, fn: () => T): T => {
    const saved = new Map<string, string | undefined>()
    for (const [key, value] of Object.entries(env)) {
      saved.set(key, process.env[key])
      process.env[key] = value
    }
    try {
      return fn()
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }

  test('clamps a timeout above the advertised maximum', () => {
    withEnv(
      { BASH_DEFAULT_TIMEOUT_MS: '120000', BASH_MAX_TIMEOUT_MS: '600000' },
      () => {
        expect(resolveTimeoutMs(10 * 60 * 60 * 1000)).toBe(600_000)
      },
    )
  })

  test('passes through a timeout inside the range', () => {
    withEnv(
      { BASH_DEFAULT_TIMEOUT_MS: '120000', BASH_MAX_TIMEOUT_MS: '600000' },
      () => {
        expect(resolveTimeoutMs(5_000)).toBe(5_000)
      },
    )
  })

  test('falls back to the default for undefined, zero, NaN and negatives', () => {
    withEnv(
      { BASH_DEFAULT_TIMEOUT_MS: '120000', BASH_MAX_TIMEOUT_MS: '600000' },
      () => {
        expect(resolveTimeoutMs(undefined)).toBe(120_000)
        expect(resolveTimeoutMs(0)).toBe(120_000)
        expect(resolveTimeoutMs(Number.NaN)).toBe(120_000)
        // A negative delay would make setTimeout fire immediately, killing the
        // command the instant it starts.
        expect(resolveTimeoutMs(-1)).toBe(120_000)
      },
    )
  })

  test('honours env overrides of both bounds', () => {
    withEnv(
      { BASH_DEFAULT_TIMEOUT_MS: '1000', BASH_MAX_TIMEOUT_MS: '2000' },
      () => {
        expect(resolveTimeoutMs(undefined)).toBe(1_000)
        expect(resolveTimeoutMs(9_999)).toBe(2_000)
      },
    )
  })
})

describe('isAutobackgroundingAllowed', () => {
  // Regression: splitCommand_DEPRECATED returns whole subcommands, so comparing
  // parts[0] against the disallow list only matched a bare `sleep`. Every real
  // `sleep <n>` was auto-backgrounded on timeout instead of staying foreground.
  test('rejects sleep with arguments, not just bare sleep', () => {
    expect(isAutobackgroundingAllowed('sleep')).toBe(false)
    expect(isAutobackgroundingAllowed('sleep 300')).toBe(false)
    expect(isAutobackgroundingAllowed('  sleep   300  ')).toBe(false)
  })

  test('looks at the leading subcommand of a compound command', () => {
    expect(isAutobackgroundingAllowed('sleep 300 && echo done')).toBe(false)
    // The long-running work is the build, not the trailing sleep.
    expect(isAutobackgroundingAllowed('npm run build && sleep 1')).toBe(true)
  })

  test('allows everything else, without prefix false-positives', () => {
    expect(isAutobackgroundingAllowed('npm run build')).toBe(true)
    expect(isAutobackgroundingAllowed('ls -la')).toBe(true)
    expect(isAutobackgroundingAllowed('sleepy --forever')).toBe(true)
    expect(isAutobackgroundingAllowed('')).toBe(true)
  })
})

describe('BashTool.call result shaping', () => {
  test('successful command returns stdout and an empty stderr', async () => {
    const result = await BashTool.call(
      { command: 'echo hello-from-test' },
      toolUseContext(),
    )
    expect(result.data.stdout).toContain('hello-from-test')
    // In file mode the command's own stderr is interleaved into stdout;
    // data.stderr must stay empty rather than duplicating it.
    expect(result.data.stderr).toBe('')
    expect(result.data.interrupted).toBe(false)
  }, 30_000)

  test("command stderr is interleaved into stdout, not into data.stderr", async () => {
    const result = await BashTool.call(
      { command: 'echo to-stdout; echo to-stderr 1>&2' },
      toolUseContext(),
    )
    expect(result.data.stdout).toContain('to-stdout')
    expect(result.data.stdout).toContain('to-stderr')
    expect(result.data.stderr).toBe('')
  }, 30_000)

  test('failing command throws ShellError carrying the exit code and output', async () => {
    let error: any
    try {
      await BashTool.call(
        { command: 'echo out; echo err 1>&2; exit 3' },
        toolUseContext(),
      )
    } catch (e) {
      error = e
    }
    expect(error?.name).toBe('ShellError')
    expect(error?.code).toBe(3)
    expect(error?.stderr).toContain('out')
    expect(error?.stderr).toContain('err')
  }, 30_000)

  // Regression: ExecResult.stderr was dropped entirely. It is the only carrier
  // for ShellCommand's synthetic diagnostics (timeout, size-cap kill, spawn
  // failure, aborted-before-spawn), so failures surfaced as a bare exit code.
  test('pre-spawn abort surfaces its diagnostic instead of a bare exit code', async () => {
    const abortController = new AbortController()
    abortController.abort('user-cancel')

    let error: any
    try {
      await BashTool.call({ command: 'echo never-runs' }, toolUseContext(abortController))
    } catch (e) {
      error = e
    }
    expect(error?.name).toBe('ShellError')
    expect(error?.stderr).toContain('aborted before execution')
  }, 30_000)

  // Regression: the persist-to-disk step ran *after* the ShellError throw, so a
  // failed command with a long log lost both its tail (inline output is capped
  // at the first 30 KB) and any pointer to the full file.
  test('failed command with large output still gets a persisted-output path', async () => {
    let error: any
    try {
      await BashTool.call({ command: bigOutputScript(300, 1) }, toolUseContext())
    } catch (e) {
      error = e
    }
    expect(error?.name).toBe('ShellError')
    expect(error?.code).toBe(1)

    const match = /saved to: (\S+)/.exec(error?.stderr ?? '')
    expect(match).not.toBeNull()

    const persistedPath = match![1]!
    createdFiles.push(persistedPath)
    const persisted = await readFile(persistedPath, 'utf8')
    // The whole log is on disk, including the tail the inline result drops.
    expect(persisted).toContain(' line0\n')
    expect(persisted).toContain('line299')
    expect(persisted.length).toBeGreaterThan(error.stderr.length)
  }, 60_000)

  test('successful command with large output still persists (no regression)', async () => {
    const result = await BashTool.call(
      { command: bigOutputScript(300, 0) },
      toolUseContext(),
    )
    expect(result.data.persistedOutputPath).toBeTruthy()
    createdFiles.push(result.data.persistedOutputPath!)
    expect(result.data.persistedOutputSize).toBeGreaterThan(
      result.data.stdout.length,
    )
    const persisted = await readFile(result.data.persistedOutputPath!, 'utf8')
    expect(persisted).toContain('line299')
  }, 60_000)

  test('small output is not persisted', async () => {
    const result = await BashTool.call(
      { command: 'echo tiny' },
      toolUseContext(),
    )
    expect(result.data.persistedOutputPath).toBeUndefined()
  }, 30_000)
})
