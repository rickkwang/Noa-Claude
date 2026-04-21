// @ts-nocheck
/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */

import { withTimeout } from './sleep.js'

const CLEANUP_TIMEOUT_MS = 2000

// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.toLowerCase().trim()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function shouldLogCleanupDiagnostics(): boolean {
  return (
    isTruthyEnv(process.env.DEBUG) ||
    isTruthyEnv(process.env.DEBUG_SDK) ||
    process.argv.includes('--debug') ||
    process.argv.includes('-d') ||
    process.argv.includes('--debug-to-stderr') ||
    process.argv.includes('-d2e') ||
    process.argv.some(arg => arg.startsWith('--debug=')) ||
    process.argv.some(arg => arg === '--debug-file' || arg.startsWith('--debug-file='))
  )
}

function formatCleanupError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function logCleanupDiagnostic(cleanupName: string, error: unknown): void {
  if (!shouldLogCleanupDiagnostics()) return
  const timestamp = new Date().toISOString()
  const message = formatCleanupError(error)
  process.stderr.write(
    `${timestamp} [WARN] [cleanupRegistry] cleanup "${cleanupName}" failed: ${message}\n`,
  )
}

async function runCleanupFunction(cleanupFn: () => Promise<void>): Promise<void> {
  const cleanupName = cleanupFn.name || '<anonymous>'
  try {
    await withTimeout(
      cleanupFn(),
      CLEANUP_TIMEOUT_MS,
      'cleanup timed out',
    )
  } catch (error) {
    logCleanupDiagnostic(cleanupName, error)
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
