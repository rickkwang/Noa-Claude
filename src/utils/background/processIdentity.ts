import { execFile } from 'child_process'
import { tmpdir } from 'os'

/** An immutable identity check for Unix PTY processes, independent of their changing title. */
export function processBirth(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 1 || process.platform === 'win32') return Promise.resolve(undefined)
  return new Promise(resolve => {
    try {
      execFile('ps', ['-p', String(pid), '-o', 'lstart='], {
        cwd: tmpdir(), timeout: 1000,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined))
    } catch { resolve(undefined) }
  })
}
