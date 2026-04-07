// @ts-nocheck
import { logForDebugging } from './debug.js'

/**
 * Compatibility shim for worktree attribution hook installation.
 *
 * The commit-attribution feature is gated and the current build path only
 * needs a stable module surface for dynamic import. Keep this lightweight so
 * the rest of the worktree flow can proceed even when the attribution hook
 * implementation is not available in this build.
 */
export async function installPrepareCommitMsgHook(
  worktreePath: string,
  worktreeHooksDir?: string,
): Promise<void> {
  logForDebugging(
    `[postCommitAttribution] attribution hook install requested for ${worktreePath}${worktreeHooksDir ? ` (hooksDir=${worktreeHooksDir})` : ''}`,
  )
}
