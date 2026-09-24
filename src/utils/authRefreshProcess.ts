import type { ChildProcess } from 'child_process'
import treeKill from 'tree-kill'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'

export type AuthRefreshKillReason = 'timeout' | 'shutdown'

/**
 * Bounds an awsAuthRefresh / gcpAuthRefresh child by a deadline and by our own
 * exit. The command runs through a shell, so exec()'s `timeout` option only
 * signals that shell: `aws sso login` / `gcloud auth login` underneath keep
 * running — on Windows still holding their localhost OAuth callback port — and
 * keep our stdout/stderr pipes open, so 'close' never fires. Killing the whole
 * tree and destroying the pipes fixes both.
 *
 * Call settle() from the child's 'close' handler.
 */
export class AuthRefreshSupervisor {
  #child: ChildProcess
  #timer: ReturnType<typeof setTimeout>
  #unregisterCleanup: () => void
  #killing: Promise<void> | undefined
  #killReason: AuthRefreshKillReason | undefined

  constructor(child: ChildProcess, timeoutMs: number) {
    this.#child = child
    this.#timer = setTimeout(() => void this.#kill('timeout'), timeoutMs)
    this.#unregisterCleanup = registerCleanup(() => this.#kill('shutdown'))
  }

  get killReason(): AuthRefreshKillReason | undefined {
    return this.#killReason
  }

  settle(): void {
    clearTimeout(this.#timer)
    this.#unregisterCleanup()
  }

  #kill(reason: AuthRefreshKillReason): Promise<void> {
    this.#killing ??= this.#killTree(reason)
    return this.#killing
  }

  async #killTree(reason: AuthRefreshKillReason): Promise<void> {
    this.#killReason = reason
    this.#child.stdout?.destroy()
    this.#child.stderr?.destroy()
    const pid = this.#child.pid
    if (
      pid === undefined ||
      this.#child.exitCode !== null ||
      this.#child.signalCode !== null
    ) {
      return
    }
    try {
      await new Promise<void>((resolve, reject) =>
        treeKill(pid, 'SIGTERM', err => (err ? reject(err) : resolve())),
      )
    } catch (error) {
      logForDebugging(
        `auth refresh: process-tree kill failed (${errorMessage(error)}); signalling the command only`,
        { level: 'error' },
      )
      try {
        this.#child.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
  }
}
