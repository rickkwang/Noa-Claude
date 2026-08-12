// @ts-nocheck
import { allowsWriteWithoutPriorRead } from '../../constants/systemPromptCompact.js'
import type { ToolUseContext } from '../../Tool.js'
import { checkReadPermissionForTool } from '../../utils/permissions/filesystem.js'
import { FileReadTool } from '../FileReadTool/FileReadTool.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
import { REPL_TOOL_NAME } from '../REPLTool/constants.js'

/** Trailing dots and spaces are stripped the way Windows resolves them. */
export function isNotebookPath(filePath: string): boolean {
  return filePath.replace(/[. ]+$/, '').toLowerCase().endsWith('.ipynb')
}

/**
 * Skipping the pre-read is only defensible when the model could have read the
 * file unprompted, so a context that can write but has no reading tool keeps
 * the guard.
 */
function hasAReadingTool(toolName: string, context: ToolUseContext): boolean {
  const tools = context.options?.tools ?? []
  const has = (name: string) => tools.some(tool => tool.name === name)
  return !(
    has(toolName) &&
    !has(FILE_READ_TOOL_NAME) &&
    !has(REPL_TOOL_NAME)
  )
}

function readIsAutoAllowed(
  filePath: string,
  context: ToolUseContext,
): boolean {
  const permissionContext = context.getAppState().toolPermissionContext
  let decision
  try {
    decision = checkReadPermissionForTool(
      FileReadTool,
      { file_path: filePath },
      permissionContext,
    )
  } catch {
    // Undecidable reads keep the guard rather than failing the whole write.
    return false
  }
  if (decision.behavior === 'allow') return true
  if (decision.behavior !== 'ask') return false
  if (permissionContext.mode !== 'bypassPermissions') return false
  const reason = decision.decisionReason
  return !(reason?.type === 'rule' && reason.rule.ruleBehavior === 'ask')
}

/**
 * Whether `toolName` may overwrite an existing file the session has never read.
 * Callers must apply this to both validateInput and call, or validate lets a
 * write through that call then rejects as unexpectedly modified.
 */
export function canSkipPreRead(
  toolName: string,
  filePath: string,
  context: ToolUseContext,
): boolean {
  return (
    allowsWriteWithoutPriorRead(context.options?.mainLoopModel) &&
    hasAReadingTool(toolName, context) &&
    readIsAutoAllowed(filePath, context)
  )
}
