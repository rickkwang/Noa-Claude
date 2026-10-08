// @ts-nocheck
import { spawn } from 'bun'
import treeKill from 'tree-kill'
import { getCwd } from '../../utils/cwd.js'

export interface CommandResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

/**
 * Run a command using Bun.spawn with timeout and process group killing.
 */
export async function runCommand(
  command: string,
  timeoutMs: number,
): Promise<CommandResult> {
  const windows = process.platform === 'win32'
  const proc = spawn({
    cmd: windows ? [process.env.COMSPEC || 'cmd.exe', '/d', '/s', '/c', command] : ['/bin/sh', '-c', command],
    cwd: getCwd(),
    detached: !windows,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    if (windows) treeKill(proc.pid, 'SIGKILL')
    else {
      try { process.kill(-proc.pid, 'SIGKILL') }
      catch { proc.kill('SIGKILL') }
    }
  }, timeoutMs)
  const output = { stdout: '', stderr: '' }
  const drained = Promise.all([collect(proc.stdout, output, 'stdout'), collect(proc.stderr, output, 'stderr')])
  try {
    const exitCode = await proc.exited
    // A detached descendant (setsid) can hold the pipes open long after the
    // command itself exited, beyond the reach of the process-group kill.
    await Promise.race([drained, Bun.sleep(PIPE_GRACE_MS)])
    return { success: exitCode === 0 && !timedOut, ...output, exitCode, timedOut }
  } finally { clearTimeout(timeoutId) }
}

const PIPE_GRACE_MS = 100

async function collect(stream: ReadableStream<Uint8Array>, output: { stdout: string; stderr: string }, key: 'stdout' | 'stderr'): Promise<void> {
  const decoder = new TextDecoder()
  for await (const chunk of stream) output[key] += decoder.decode(chunk, { stream: true })
}

/**
 * Format auto-fix feedback for AI context.
 */
export function formatAutoFixFeedback(
  lintResult: CommandResult,
  testResult: CommandResult | null,
  lintCommand: string,
  testCommand: string | null,
  timeoutMs: number,
): string {
  const lines: string[] = ['<auto_fix_feedback>']

  if (!lintCommand) {
    // test-only configuration
  } else if (lintResult.timedOut) {
    lines.push(`Lint timed out after ${timeoutMs}ms: ${lintCommand}`)
  } else if (!lintResult.success) {
    lines.push(`Lint failed (exit ${lintResult.exitCode}): ${lintCommand}`)
    if (lintResult.stdout) {
      lines.push('--- lint stdout ---')
      lines.push(lintResult.stdout.slice(0, 2000))
    }
    if (lintResult.stderr) {
      lines.push('--- lint stderr ---')
      lines.push(lintResult.stderr.slice(0, 2000))
    }
  } else {
    lines.push(`Lint passed: ${lintCommand}`)
  }

  if (testCommand && testResult) {
    if (testResult.timedOut) {
      lines.push(`Test timed out after ${timeoutMs}ms: ${testCommand}`)
    } else if (!testResult.success) {
      lines.push(`Test failed (exit ${testResult.exitCode}): ${testCommand}`)
      if (testResult.stdout) {
        lines.push('--- test stdout ---')
        lines.push(testResult.stdout.slice(0, 2000))
      }
      if (testResult.stderr) {
        lines.push('--- test stderr ---')
        lines.push(testResult.stderr.slice(0, 2000))
      }
    } else {
      lines.push(`Tests passed: ${testCommand}`)
    }
  }

  lines.push('</auto_fix_feedback>')

  return lines.join('\n')
}
