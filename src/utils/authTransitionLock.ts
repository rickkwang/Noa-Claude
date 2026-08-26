import { mkdir, realpath } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import * as lockfile from './lockfile.js'

/**
 * Serialize every secure OAuth credential mutation across processes. The
 * dedicated target avoids colliding with unrelated config-directory locks,
 * while canonicalizing its parent prevents path aliases from bypassing it.
 */
export async function acquireAuthTransitionLock(
  options: { retries?: number | { retries: number; minTimeout: number; maxTimeout: number } } = {},
): Promise<() => Promise<void>> {
  const configDir = getClaudeConfigHomeDir()
  await mkdir(configDir, { recursive: true })
  const canonicalConfigDir = await realpath(configDir)
  return lockfile.lock(join(canonicalConfigDir, '.auth-transition'), {
    realpath: false,
    retries: options.retries ?? { retries: 40, minTimeout: 10, maxTimeout: 100 },
  })
}

export async function withAuthTransitionLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireAuthTransitionLock()
  try {
    return await operation()
  } finally {
    await release()
  }
}
