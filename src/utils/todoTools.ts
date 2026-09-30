import { modelNeedsTodoTools } from '../constants/systemPromptCompact.js'
import type { Tools } from '../Tool.js'
import { TASK_CREATE_TOOL_NAME } from '../tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '../tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '../tools/TaskListTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '../tools/TaskUpdateTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '../tools/TodoWriteTool/constants.js'
import { isAgentSwarmsEnabled } from './agentSwarmsEnabled.js'
import { isBgSession } from './background/bgJob.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

const TODO_TOOL_NAMES = new Set([
  TODO_WRITE_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
])

let launchOptIn = false

/**
 * Naming any task-tracking tool in --tools or --allowedTools asks for the
 * family explicitly, so the model gate below no longer applies.
 */
export function setTodoToolsOptInFromCLI(toolNames: string[]): void {
  launchOptIn = toolNames.some(name =>
    TODO_TOOL_NAMES.has(name.replace(/\(.*$/, '').trim()),
  )
}

/**
 * Whether the main-loop model gets the task-tracking tools at all. Which family
 * it gets is isTodoV2Enabled()'s call; this only decides whether to offer one.
 *
 * NOA_CLAUDE_ENABLE_TODO_TOOLS (legacy: CLAUDE_CODE_ENABLE_TODO_TOOLS) forces
 * either answer. Agent teams keep them because teammates coordinate through
 * the shared task list.
 */
export function areTodoToolsEnabled(model: string | undefined): boolean {
  const override =
    process.env.NOA_CLAUDE_ENABLE_TODO_TOOLS ??
    process.env.CLAUDE_CODE_ENABLE_TODO_TOOLS
  if (isEnvTruthy(override)) return true
  if (isEnvDefinedFalsy(override)) return false

  if (launchOptIn || isBgSession() || isAgentSwarmsEnabled()) return true
  return modelNeedsTodoTools(model)
}

/**
 * The model is only known after the tool pool is built (--model resolves late
 * at startup, /model switches mid-session), so the gate runs over the finished
 * pool rather than inside each tool's isEnabled().
 */
export function filterTodoToolsForModel(
  tools: Tools,
  model: string | undefined,
): Tools {
  if (areTodoToolsEnabled(model)) return tools
  return tools.filter(tool => !TODO_TOOL_NAMES.has(tool.name))
}
