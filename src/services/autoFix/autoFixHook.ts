// @ts-nocheck
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { getAutoFixConfig } from './autoFixConfig.js'
import {
  formatAutoFixFeedback,
  runCommand,
  runLintWithRetry,
} from './autoFixRunner.js'

/**
 * Check if a tool name is a file editing tool.
 */
export function isFileEditTool(toolName: string): boolean {
  return toolName === FILE_EDIT_TOOL_NAME || toolName === FILE_WRITE_TOOL_NAME
}

/**
 * Run auto-fix if configured and applicable.
 * Returns formatted feedback string to inject into AI context, or null if no auto-fix.
 */
export async function runAutoFix(): Promise<string | null> {
  const config = getAutoFixConfig()

  if (!config || !config.enabled) {
    return null
  }

  if (!config.lint && !config.test) {
    return null
  }

  // Run lint first if configured
  if (config.lint) {
    const lintResult = await runLintWithRetry(
      config.lint,
      config.maxRetries,
      config.timeout,
    )

    // If lint fails, return feedback immediately
    if (!lintResult.success) {
      return formatAutoFixFeedback(lintResult, null, config.lint, null)
    }

    // If lint passes and test is configured, run test
    if (config.test) {
      const testResult = await runCommand(config.test, config.timeout)
      return formatAutoFixFeedback(lintResult, testResult, config.lint, config.test)
    }

    // Lint passed with no test command
    return formatAutoFixFeedback(lintResult, null, config.lint, null)
  }

  // Only test is configured (no lint)
  if (config.test) {
    const testResult = await runCommand(config.test, config.timeout)
    return formatAutoFixFeedback(
      { success: true, stdout: '', stderr: '', exitCode: 0, timedOut: false },
      testResult,
      '',
      config.test,
    )
  }

  return null
}
