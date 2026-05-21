import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { getNearestProjectInstructionFilePath } from './projectInstructions.js'
import { PRODUCT_PROJECT_DIR as PRODUCT_PROJECT_DIR_NAME } from './productPathConstants.js'

export const PRODUCT_PROJECT_DIR = PRODUCT_PROJECT_DIR_NAME

export const PRIMARY_PROJECT_INSTRUCTION_FILE = 'AGENTS.md'
export const FALLBACK_PROJECT_INSTRUCTION_FILE = 'CLAUDE.md'
export const PRODUCT_MEMORY_FILENAME = 'CLAUDE.md' // Legacy name, use PRIMARY_PROJECT_INSTRUCTION_FILE for new code
export const PRODUCT_LAUNCH_CONFIG = 'launch.json'
export const PRODUCT_SCHEDULED_TASKS_FILE = 'scheduled_tasks.json'
export const PRODUCT_SCHEDULED_TASKS_LOCK = 'scheduled_tasks.lock'
export const PRODUCT_MCP_FILENAME = 'mcp.json'
export const LEGACY_MCP_FILENAME = '.mcp.json'

export function getPrimaryProjectConfigRoot(cwd: string): string {
  return join(cwd, PRODUCT_PROJECT_DIR)
}

export function getProjectConfigRoots(cwd: string): string[] {
  return [getPrimaryProjectConfigRoot(cwd)]
}

export function getPrimaryProjectSubdir(cwd: string, subdir: string): string {
  return join(getPrimaryProjectConfigRoot(cwd), subdir)
}

export function getProjectSubdirCandidates(
  cwd: string,
  subdir: string,
): string[] {
  return getProjectConfigRoots(cwd).map(root => join(root, subdir))
}

export function getPrimaryProjectFile(cwd: string, filename: string): string {
  return join(getPrimaryProjectConfigRoot(cwd), filename)
}

export function getProjectFileCandidates(
  cwd: string,
  filename: string,
): string[] {
  return getProjectConfigRoots(cwd).map(root => join(root, filename))
}

export function getPrimaryProjectSettingsRelativePath(
  filename: 'settings.json' | 'settings.local.json',
): string {
  return join(PRODUCT_PROJECT_DIR, filename)
}

export function getProjectSettingsRelativePathCandidates(
  filename: 'settings.json' | 'settings.local.json',
): string[] {
  return [getPrimaryProjectSettingsRelativePath(filename)]
}

export function getProjectMemoryFileCandidates(cwd: string): string[] {
  return Array.from(
    new Set([
      ...getProjectConfigRoots(cwd).flatMap(root => [
        join(root, PRIMARY_PROJECT_INSTRUCTION_FILE),
        join(root, FALLBACK_PROJECT_INSTRUCTION_FILE),
      ]),
      join(cwd, PRIMARY_PROJECT_INSTRUCTION_FILE),
      join(cwd, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ]),
  )
}

export function getPreferredProjectMemoryFilePath(cwd: string): string {
  const nearestInstruction = getNearestProjectInstructionFilePath(cwd)
  if (nearestInstruction !== null) {
    return nearestInstruction
  }
  return join(cwd, PRIMARY_PROJECT_INSTRUCTION_FILE)
}

export function getProjectRulesDirCandidates(cwd: string): string[] {
  return getProjectSubdirCandidates(cwd, 'rules')
}

export function getProjectWorktreeDirCandidates(cwd: string): string[] {
  return getProjectSubdirCandidates(cwd, 'worktrees')
}

export function getPrimaryProjectScheduledTasksPath(cwd: string): string {
  return getPrimaryProjectFile(cwd, PRODUCT_SCHEDULED_TASKS_FILE)
}

export function getProjectScheduledTasksPathCandidates(cwd: string): string[] {
  return getProjectFileCandidates(cwd, PRODUCT_SCHEDULED_TASKS_FILE)
}

export function getPrimaryProjectScheduledTasksLockPath(cwd: string): string {
  return getPrimaryProjectFile(cwd, PRODUCT_SCHEDULED_TASKS_LOCK)
}

export function getProjectScheduledTasksLockCandidates(cwd: string): string[] {
  return getProjectFileCandidates(cwd, PRODUCT_SCHEDULED_TASKS_LOCK)
}

export function getProjectLaunchConfigCandidates(cwd: string): string[] {
  return getProjectFileCandidates(cwd, PRODUCT_LAUNCH_CONFIG)
}

export function getPrimaryProjectMcpPath(cwd: string): string {
  return getPrimaryProjectFile(cwd, PRODUCT_MCP_FILENAME)
}

export function getProjectMcpPathCandidates(cwd: string): string[] {
  return [getPrimaryProjectMcpPath(cwd)]
}

export function getUserScopedSubdir(subdir: string): string {
  return join(getClaudeConfigHomeDir(), subdir)
}
