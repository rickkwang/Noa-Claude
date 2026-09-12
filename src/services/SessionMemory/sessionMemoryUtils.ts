// @ts-nocheck
/**
 * Session Memory utility functions that can be imported without circular dependencies.
 * These are separate from the main sessionMemory.ts to avoid importing runAgent.
 */

import { isFsInaccessible } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { logEvent } from '../analytics/index.js'


/**
 * Configuration for session memory extraction thresholds
 */
export type SessionMemoryConfig = {
  /** Minimum context window tokens before initializing session memory.
   * Uses the same token counting as autocompact (input + output + cache tokens)
   * to ensure consistent behavior between the two features. */
  minimumMessageTokensToInit: number
  /** Minimum context window growth (in tokens) between session memory updates.
   * Uses the same token counting as autocompact (tokenCountWithEstimation)
   * to measure actual context growth, not cumulative API usage. */
  minimumTokensBetweenUpdate: number
  /** Number of tool calls between session memory updates */
  toolCallsBetweenUpdates: number
}

// Default configuration values
export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  minimumMessageTokensToInit: 10000,
  minimumTokensBetweenUpdate: 5000,
  toolCallsBetweenUpdates: 3,
}

// Current session memory configuration
let sessionMemoryConfig: SessionMemoryConfig = {
  ...DEFAULT_SESSION_MEMORY_CONFIG,
}

// Track context size at last memory extraction (for minimumTokensBetweenUpdate)
let tokensAtLastExtraction = 0

// Track whether session memory has been initialized (met minimumMessageTokensToInit)
let sessionMemoryInitialized = false

/**
 * Get the current session memory content
 */
export async function getSessionMemoryContent(): Promise<string | null> {
  const fs = getFsImplementation()
  const memoryPath = getSessionMemoryPath()

  try {
    const content = await fs.readFile(memoryPath, { encoding: 'utf-8' })

    logEvent('tengu_session_memory_loaded', {
      content_length: content.length,
    })

    return content
  } catch (e: unknown) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

/**
 * Set the session memory configuration
 */
export function setSessionMemoryConfig(
  config: Partial<SessionMemoryConfig>,
): void {
  sessionMemoryConfig = {
    ...sessionMemoryConfig,
    ...config,
  }
}

/**
 * Get the current session memory configuration
 */
export function getSessionMemoryConfig(): SessionMemoryConfig {
  return { ...sessionMemoryConfig }
}

/**
 * Record the context size at the time of extraction.
 * Used to measure context growth for minimumTokensBetweenUpdate threshold.
 */
export function recordExtractionTokenCount(currentTokenCount: number): void {
  tokensAtLastExtraction = currentTokenCount
}

/**
 * Check if session memory has been initialized (met minimumTokensToInit threshold)
 */
export function isSessionMemoryInitialized(): boolean {
  return sessionMemoryInitialized
}

/**
 * Mark session memory as initialized
 */
export function markSessionMemoryInitialized(): void {
  sessionMemoryInitialized = true
}

/**
 * Check if we've met the threshold to initialize session memory.
 * Uses total context window tokens (same as autocompact) for consistent behavior.
 */
export function hasMetInitializationThreshold(
  currentTokenCount: number,
): boolean {
  return currentTokenCount >= sessionMemoryConfig.minimumMessageTokensToInit
}

/**
 * Check if we've met the threshold for the next update.
 * Measures actual context window growth since last extraction
 * (same metric as autocompact and initialization threshold).
 */
export function hasMetUpdateThreshold(currentTokenCount: number): boolean {
  const tokensSinceLastExtraction = currentTokenCount - tokensAtLastExtraction
  return (
    tokensSinceLastExtraction >= sessionMemoryConfig.minimumTokensBetweenUpdate
  )
}

/**
 * Get the configured number of tool calls between updates
 */
export function getToolCallsBetweenUpdates(): number {
  return sessionMemoryConfig.toolCallsBetweenUpdates
}

/**
 * Reset session memory state (useful for testing)
 */
export function resetSessionMemoryState(): void {
  sessionMemoryConfig = { ...DEFAULT_SESSION_MEMORY_CONFIG }
  tokensAtLastExtraction = 0
  sessionMemoryInitialized = false
}
