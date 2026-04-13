// @ts-nocheck
import { spawn } from 'bun'

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
  // Parse command string into args array
  const args = command.trim().split(/\s+/)

  return new Promise(resolve => {
    const timedOut = { value: false }

    const proc = spawn({
      cmd: args,
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Set up timeout using process group killing (like OpenClaude)
    // Must be after proc is declared so we can reference proc.pid in the callback
    const timeoutId = setTimeout(() => {
      timedOut.value = true
      // Kill the entire process group
      try {
        process.kill(-proc.pid, 'SIGTERM')
      } catch {
        // Process may have already exited
      }
    }, timeoutMs)

    let stdout = ''
    let stderr = ''

    proc.stdout?.text().then(text => {
      stdout = text
    })

    proc.stderr?.text().then(text => {
      stderr = text
    })

    proc.exited.then(code => {
      clearTimeout(timeoutId)
      resolve({
        success: code === 0 && !timedOut.value,
        stdout,
        stderr,
        exitCode: code,
        timedOut: timedOut.value,
      })
    })
  })
}

/**
 * Run lint command with retries.
 */
export async function runLintWithRetry(
  lintCommand: string,
  maxRetries: number,
  timeoutMs: number,
): Promise<CommandResult> {
  let lastResult: CommandResult | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Wait before retry
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }

    const result = await runCommand(lintCommand, timeoutMs)
    lastResult = result

    if (result.success) {
      return result
    }
  }

  return lastResult!
}

/**
 * Format auto-fix feedback for AI context.
 */
export function formatAutoFixFeedback(
  lintResult: CommandResult,
  testResult: CommandResult | null,
  lintCommand: string,
  testCommand: string | null,
): string {
  const lines: string[] = ['<auto_fix_feedback>']

  if (lintResult.timedOut) {
    lines.push(`Lint timed out after ${lintResult.timedOut}ms: ${lintCommand}`)
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
    if (lintResult.stdout) {
      lines.push(lintResult.stdout.slice(0, 500))
    }
  }

  if (testCommand && testResult) {
    if (testResult.timedOut) {
      lines.push(`Test timed out after ${testResult.timedOut}ms: ${testCommand}`)
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
      if (testResult.stdout) {
        lines.push(testResult.stdout.slice(0, 500))
      }
    }
  }

  lines.push('</auto_fix_feedback>')

  return lines.join('\n')
}
