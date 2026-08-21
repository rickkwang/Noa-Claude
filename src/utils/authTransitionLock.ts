import { mkdir } from 'fs/promises'
import { getClaudeConfigHomeDir } from './envUtils.js'
import * as lockfile from './lockfile.js'

export async function withAuthTransitionLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const configDir = getClaudeConfigHomeDir()
  await mkdir(configDir, { recursive: true })
  const release = await lockfile.lock(configDir, {
    realpath: false,
    retries: { retries: 40, minTimeout: 10, maxTimeout: 100 },
  })
  try {
    return await operation()
  } finally {
    await release()
  }
}
