import { hasBinaryExtension } from '../../constants/files.js'
import { readFileSyncWithMetadata } from '../../utils/fileRead.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { expandPath } from '../../utils/path.js'
import { getDefaultFileReadingLimits } from '../FileReadTool/limits.js'
import { parseSingleFileGrepCommand } from './grepReadParser.js'

function grepOutputShowsEditableLines(stdout: string): boolean {
  const lines = stdout.split('\n')
  return (
    lines.some(line => line.trim() !== '') &&
    !lines.some(line => /^Binary file .+ matches$/.test(line))
  )
}

/** Register a single-file grep target as "read", so Edit can proceed. */
export async function maybeRegisterGrepRead(
  command: string,
  stdout: string,
  readFileState: FileStateCache,
): Promise<void> {
  const rawPath = parseSingleFileGrepCommand(command)
  if (!rawPath) return
  if (!grepOutputShowsEditableLines(stdout)) return
  if (rawPath !== rawPath.trim()) return
  if (rawPath.startsWith('~')) return
  const absoluteFilePath = expandPath(rawPath)
  if (hasBinaryExtension(absoluteFilePath)) return
  try {
    const fs = getFsImplementation()
    const stat = await fs.stat(absoluteFilePath)
    if (!stat.isFile()) return
    // Match the normal Read path's full-file eligibility and content
    // normalization so Edit/Write staleness checks compare like with like.
    if (stat.size > getDefaultFileReadingLimits().maxSizeBytes) return
    const { content } = readFileSyncWithMetadata(absoluteFilePath)
    readFileState.set(absoluteFilePath, {
      content,
      timestamp: Math.floor(stat.mtimeMs),
      offset: undefined,
      limit: undefined,
    })
  } catch {
    // ENOENT, permission, decode error -- leave readFileState untouched.
  }
}
