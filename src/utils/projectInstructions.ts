// @ts-nocheck
/**
 * Project instruction file handling with AGENTS.md priority.
 *
 * OpenClaude prioritizes AGENTS.md over CLAUDE.md as the primary project instruction file.
 * This module provides utilities for finding and loading project instruction files.
 */

import { existsSync } from 'fs'
import { join } from 'path'

export const PRIMARY_PROJECT_INSTRUCTION_FILE = 'AGENTS.md'
export const FALLBACK_PROJECT_INSTRUCTION_FILE = 'CLAUDE.md'

/**
 * Get the path to the project instruction file.
 * Prefers AGENTS.md if it exists, otherwise falls back to CLAUDE.md.
 *
 * @param dir - The directory to check for the project instruction file
 * @returns The absolute path to the project instruction file
 */
export function getProjectInstructionFilePath(dir: string): string {
  const primaryPath = join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE)
  const fallbackPath = join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE)

  if (existsSync(primaryPath)) {
    return primaryPath
  }
  return fallbackPath
}

/**
 * Check if a directory has an AGENTS.md file.
 *
 * @param dir - The directory to check
 * @returns True if AGENTS.md exists in the directory
 */
export function hasAgentsMd(dir: string): boolean {
  return existsSync(join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE))
}

/**
 * Check if a directory has a CLAUDE.md file (but no AGENTS.md).
 *
 * @param dir - The directory to check
 * @returns True if CLAUDE.md exists but AGENTS.md does not
 */
export function hasClaueMdOnly(dir: string): boolean {
  return (
    existsSync(join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE)) &&
    !hasAgentsMd(dir)
  )
}
