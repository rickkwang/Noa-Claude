/**
 * Getting a job's PTY host up before attaching to it — shared by the agents
 * view and `noa attach`.
 */
import { existsSync, rmSync } from 'fs'
import { isProcessRunning } from '../genericProcessUtils.js'
import { reviveJob } from './dispatch.js'
import { getJobSocketPath, type Job, readHostPid } from './jobs.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function waitForSocket(short: string, timeoutMs = 5000): Promise<boolean> {
  const path = getJobSocketPath(short)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    await sleep(50)
  }
  return false
}

/**
 * Make sure the job has a host to attach to, starting one only if it is
 * really gone. Read live, not from the last poll: a host that was just
 * spawned has no socket (or even host.json) yet, and one whose session just
 * exited is still shutting down with its socket already removed.
 */
export async function ensureHost(job: Job): Promise<boolean> {
  const socketPath = getJobSocketPath(job.short)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const pid = await readHostPid(job.short)
    const running = pid !== undefined && isProcessRunning(pid)
    if (running && existsSync(socketPath)) return true
    // Settled as dead: host.json names a pid that is gone, or no host ever
    // wrote one for a job the host has already finished with.
    if (pid !== undefined && !running) break
    if (pid === undefined && job.exitCode !== undefined) break
    await sleep(50)
  }
  if (existsSync(socketPath) && (await readHostPid(job.short).then(p => p !== undefined && isProcessRunning(p)))) return true
  // A host that crashed leaves its socket behind; don't mistake it for the
  // new host's.
  rmSync(socketPath, { force: true })
  reviveJob(job)
  return waitForSocket(job.short)
}
