import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises'
import type { ExecResult } from '../../utils/ShellCommand.js'
import {
  ensureToolResultsDir,
  getToolResultPath,
} from '../../utils/toolResultStorage.js'

/** Hard cap on what we keep on disk for one command's output. */
const MAX_PERSISTED_SIZE = 64 * 1024 * 1024

export type PersistedOutput = {
  path?: string
  size?: number
}

/**
 * Persist a command's output file so the model can read past the inline cap.
 *
 * The inline result only ever carries the first getMaxOutputLength() bytes
 * (TaskOutput reads the file head), so anything longer needs a path. Hardlink
 * the output file into the tool-results dir, falling back to a copy across
 * filesystems. Over 64 MB the source is truncated first — link() shares the
 * inode, so the cap applies to both names.
 *
 * MUST be called before the caller throws on a failed command. A non-zero exit
 * is exactly when the tail matters (compiler errors and failing-test summaries
 * live at the end of a long log) and the inline result can only carry the head.
 * The extra syscalls on the failure path do not orphan anything: the hardlink
 * shares the task output file's inode, so it costs no bytes, and session
 * cleanup owns the tool-results directory either way.
 *
 * Shared by BashTool and PowerShellTool — they had drifting copies.
 */
export async function persistLargeOutput(
  result: ExecResult,
): Promise<PersistedOutput> {
  if (!result.outputFilePath || !result.outputTaskId) {
    return {}
  }
  let size: number | undefined
  try {
    const fileStat = await fsStat(result.outputFilePath)
    size = fileStat.size
    await ensureToolResultsDir()
    const dest = getToolResultPath(result.outputTaskId, false)
    if (fileStat.size > MAX_PERSISTED_SIZE) {
      await fsTruncate(result.outputFilePath, MAX_PERSISTED_SIZE)
    }
    try {
      await link(result.outputFilePath, dest)
    } catch {
      await copyFile(result.outputFilePath, dest)
    }
    return { path: dest, size }
  } catch {
    // File may already be gone — the inline stdout preview is sufficient.
    return { size }
  }
}
