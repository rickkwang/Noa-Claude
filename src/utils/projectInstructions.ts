// @ts-nocheck
/**
 * Project instruction file handling with AGENTS.md priority.
 *
 * Noa Claude prioritizes AGENTS.md over CLAUDE.md as the primary project instruction file.
 * This module provides utilities for finding and loading project instruction files.
 */

import { existsSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, parse } from 'path'
import { findGitRoot } from './git.js'
import { normalizePathForComparison } from './file.js'

export const PRIMARY_PROJECT_INSTRUCTION_FILE = 'AGENTS.md'
export const FALLBACK_PROJECT_INSTRUCTION_FILE = 'CLAUDE.md'

/**
 * Get the path to the project instruction file.
 * Prefers AGENTS.md if it exists, otherwise falls back to CLAUDE.md.
 *
 * @param dir - The directory to check for the project instruction file
 * @returns The absolute path to the project instruction file
 */
export function getProjectInstructionFilePath(dir: string): string | null {
  return getNearestProjectInstructionFilePath(dir)
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
export function hasClaudeMdOnly(dir: string): boolean {
  return (
    existsSync(join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE)) &&
    !hasAgentsMd(dir)
  )
}

/**
 * @deprecated Use hasClaudeMdOnly instead.
 * Kept only for transitional compatibility with older imports.
 */
export const hasClaueMdOnly = hasClaudeMdOnly

/**
 * Check if a directory has either AGENTS.md or CLAUDE.md.
 *
 * @param dir - The directory to check
 * @returns True if either project instruction file exists
 */
export function hasProjectInstructionFile(dir: string): boolean {
  return getNearestProjectInstructionFilePath(dir) !== null
}

/**
 * Find the nearest project instruction file in the current directory or any
 * ancestor directory, preferring AGENTS.md over CLAUDE.md at each level.
 *
 * @param dir - The directory to start searching from
 * @returns The nearest instruction file path, or null if none exists
 */
export function getNearestProjectInstructionFilePath(
  dir: string,
): string | null {
  const home = homedir()
  const stopBoundary = findGitRoot(dir)
  const root = parse(dir).root
  let current = dir
  while (true) {
    if (
      normalizePathForComparison(current) ===
      normalizePathForComparison(home)
    ) {
      return null
    }

    const agentsPath = join(current, PRIMARY_PROJECT_INSTRUCTION_FILE)
    if (existsSync(agentsPath)) {
      return agentsPath
    }

    const claudePath = join(current, FALLBACK_PROJECT_INSTRUCTION_FILE)
    if (existsSync(claudePath)) {
      return claudePath
    }

    if (
      stopBoundary !== null &&
      normalizePathForComparison(current) ===
        normalizePathForComparison(stopBoundary)
    ) {
      return null
    }

    const parent = dirname(current)
    if (parent === current || current === root) {
      return null
    }
    current = parent
  }
}
