// @ts-nocheck
/**
 * Project instruction file handling with Noa project path priority.
 *
 * Noa Claude prioritizes AGENTS.md over CLAUDE.md as the primary project
 * instruction file, with .noa-scoped files preferred within each filename tier.
 * This module provides utilities for finding and loading project instruction files.
 */

import { existsSync } from 'fs'
import { basename } from 'path'
import {
  FALLBACK_PROJECT_INSTRUCTION_FILE,
  getPreferredProjectMemoryFilePath,
  getProjectMemoryFileCandidates,
  PRIMARY_PROJECT_INSTRUCTION_FILE,
} from './productPaths.js'

export {
  FALLBACK_PROJECT_INSTRUCTION_FILE,
  PRIMARY_PROJECT_INSTRUCTION_FILE,
} from './productPaths.js'

/**
 * Get the path to the project instruction file.
 * Uses the same priority as the memory loader: .noa/AGENTS.md, AGENTS.md,
 * .noa/CLAUDE.md, then CLAUDE.md.
 *
 * @param dir - The directory to check for the project instruction file
 * @returns The absolute path to the project instruction file
 */
export function getProjectInstructionFilePath(dir: string): string | null {
  return getNearestProjectInstructionFilePath(dir)
}

/**
 * Check if a directory's selected project instruction file is AGENTS.md.
 *
 * @param dir - The directory to check
 * @returns True if the selected directory-level instruction is AGENTS.md
 */
export function hasAgentsMd(dir: string): boolean {
  const path = getDirectoryProjectInstructionFilePath(dir)
  return path !== null && basename(path) === PRIMARY_PROJECT_INSTRUCTION_FILE
}

/**
 * Check if a directory's selected project instruction file is CLAUDE.md.
 *
 * @param dir - The directory to check
 * @returns True if the selected directory-level instruction falls back to CLAUDE.md
 */
export function hasClaudeMdOnly(dir: string): boolean {
  const path = getDirectoryProjectInstructionFilePath(dir)
  return path !== null && basename(path) === FALLBACK_PROJECT_INSTRUCTION_FILE
}

/**
 * Find the nearest project instruction file in the current directory or any
 * ancestor directory using the same priority as the memory loader.
 *
 * @param dir - The directory to start searching from
 * @returns The nearest instruction file path, or null if none exists
 */
export function getNearestProjectInstructionFilePath(
  dir: string,
): string | null {
  const path = getPreferredProjectMemoryFilePath(dir)
  return existsSync(path) ? path : null
}

function getDirectoryProjectInstructionFilePath(dir: string): string | null {
  const path = getProjectMemoryFileCandidates(dir)[0]
  return path && existsSync(path) ? path : null
}
