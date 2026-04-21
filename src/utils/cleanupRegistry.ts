// @ts-nocheck
/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

import { withTimeout } from './sleep.js'
import { logDebugDiagnosticWarn } from './debugDiagnostics.js'

const CLEANUP_TIMEOUT_MS = 2000

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

async function runCleanupFunction(cleanupFn: () => Promise<void>): Promise<void> {
  const cleanupName = cleanupFn.name || '<anonymous>'
  try {
    await withTimeout(
      cleanupFn(),
      CLEANUP_TIMEOUT_MS,
      'cleanup timed out',
    )
  } catch (error) {
    logDebugDiagnosticWarn(
      'cleanupRegistry',
      `cleanup "${cleanupName}" failed`,
      error,
    )
  }
}

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
export function registerCleanup(cleanupFn: () => Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}

/**
 * Run all registered cleanup functions.
 * Each cleanup is individually timed out and caught so that one failure
 * or hang cannot block the others or crash the shutdown sequence.
 * Used internally by gracefulShutdown.
 */
export async function runCleanupFunctions(): Promise<void> {
  await Promise.all(
    Array.from(cleanupFunctions).map(runCleanupFunction),
  )
}

export async function _runCleanupFunctionForTesting(
  cleanupFn: () => Promise<void>,
): Promise<void> {
  await runCleanupFunction(cleanupFn)
}
