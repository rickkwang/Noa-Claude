import { exec } from 'child_process'
import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { AuthRefreshSupervisor } from '../../utils/authRefreshProcess.js'
import * as cleanupRegistry from '../../utils/cleanupRegistry.js'

// Capture the supervisor's shutdown hook instead of running the global
// registry, which would also fire cleanups other test files registered.
const registered = new Set<() => Promise<void>>()
const registerSpy = spyOn(cleanupRegistry, 'registerCleanup').mockImplementation(
  fn => {
    registered.add(fn)
    return () => registered.delete(fn)
  },
)
afterEach(() => registered.clear())
afterAll(() => registerSpy.mockRestore())

// awsAuthRefresh / gcpAuthRefresh run through a shell. exec()'s own timeout
// only signals that shell, leaving `aws sso login` / `gcloud auth login`
// running (and, on Windows, holding their localhost callback port).

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, ms = 2000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise(r => setTimeout(r, 25))
  }
  return !isAlive(pid)
}

/** Shell that backgrounds a long-lived grandchild, reports its pid, waits. */
function startRefresh(timeoutMs: number) {
  const child = exec('sleep 30 & echo $!; wait')
  const supervisor = new AuthRefreshSupervisor(child, timeoutMs)
  const grandchild = new Promise<number>(resolve =>
    child.stdout!.once('data', d => resolve(Number(String(d).trim()))),
  )
  const closed = new Promise<void>(resolve =>
    child.on('close', () => {
      supervisor.settle()
      resolve()
    }),
  )
  return { supervisor, grandchild, closed }
}

test.skipIf(process.platform === 'win32')(
  'a timeout kills the whole command tree, not just the shell',
  async () => {
    const { supervisor, grandchild, closed } = startRefresh(200)
    const pid = await grandchild
    await closed
    expect(supervisor.killReason).toBe('timeout')
    expect(await waitDead(pid)).toBe(true)
    // settle() unregisters the shutdown hook.
    expect(registered.size).toBe(0)
    expect(registerSpy).toHaveBeenCalled()
  },
  5000,
)

test.skipIf(process.platform === 'win32')(
  'shutdown kills a refresh still in flight',
  async () => {
    const { supervisor, grandchild, closed } = startRefresh(60_000)
    const pid = await grandchild
    expect(registered.size).toBe(1)
    await Promise.all([...registered].map(fn => fn()))
    await closed
    expect(supervisor.killReason).toBe('shutdown')
    expect(await waitDead(pid)).toBe(true)
  },
  5000,
)
