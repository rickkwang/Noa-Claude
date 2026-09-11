import type { StructuredPatchHunk } from 'diff'
import { resolve } from 'path'
import * as React from 'react'
import { useMemo } from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import { getCwd } from '../../utils/cwd.js'
import { isFileWithinReadSizeLimit, readFileSafe } from '../../utils/file.js'
import { findGitRoot } from '../../utils/git.js'
import { Divider } from '../design-system/Divider.js'
import { StructuredDiff } from '../StructuredDiff.js'

/** Files above this are diffed without syntax context from their contents. */
const MAX_CONTEXT_FILE_BYTES = 1_000_000

// StructuredDiff lives in a type-unchecked module, so its prop types don't
// survive the import.
const TypedStructuredDiff = StructuredDiff as (props: {
  patch: StructuredPatchHunk
  filePath: string
  firstLine: string | null
  fileContent?: string
  dim: boolean
  width: number
}) => React.ReactNode

type Props = {
  filePath: string
  hunks: StructuredPatchHunk[]
  isLargeFile?: boolean
  isBinary?: boolean
  isTruncated?: boolean
  isUntracked?: boolean
  /** Columns to render into. Defaults to the terminal width less the dialog's inset. */
  width?: number
}

/**
 * One file's diff, shared by the `/diff` dialog and the diff panel. Renders
 * every parsed line (at most 400) — the container scrolls, not this.
 */
export function DiffDetailView({
  filePath,
  hunks,
  isLargeFile,
  isBinary,
  isTruncated,
  isUntracked,
  width,
}: Props): React.ReactNode {
  const { columns } = useTerminalSize()
  const contentWidth = width ?? columns - 4

  const fileContent = useMemo(() => {
    if (!filePath || isBinary || isLargeFile || isUntracked) return undefined
    // Diff paths are repo-root-relative (`diff.relative=false`).
    const root = findGitRoot(getCwd()) ?? getCwd()
    const fullPath = resolve(root, filePath)
    if (!isFileWithinReadSizeLimit(fullPath, MAX_CONTEXT_FILE_BYTES)) {
      return undefined
    }
    return readFileSafe(fullPath) ?? undefined
  }, [filePath, isBinary, isLargeFile, isUntracked])
  const firstLine = fileContent?.split('\n')[0] ?? null

  if (isUntracked) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{filePath}</Text>
          <Text dimColor> (untracked)</Text>
        </Box>
        <Divider width={contentWidth} />
        <Box flexDirection="column">
          <Text dimColor italic>
            New file not yet staged.
          </Text>
          <Text dimColor italic>
            Run `git add :/{filePath}` to see line counts.
          </Text>
        </Box>
      </Box>
    )
  }

  if (isBinary || isLargeFile) {
    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text bold>{filePath}</Text>
        </Box>
        <Divider width={contentWidth} />
        <Box flexDirection="column">
          <Text dimColor italic>
            {isBinary
              ? 'Binary file - cannot display diff'
              : 'Large file - diff exceeds 1 MB limit'}
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text bold>{filePath}</Text>
        {isTruncated && <Text dimColor> (truncated)</Text>}
      </Box>
      <Divider width={contentWidth} />
      <Box flexDirection="column">
        {hunks.length === 0 ? (
          <Text dimColor>No diff content</Text>
        ) : (
          hunks.map((hunk, index) => (
            <TypedStructuredDiff
              key={index}
              patch={hunk}
              filePath={filePath}
              firstLine={firstLine}
              fileContent={fileContent}
              dim={false}
              width={contentWidth}
            />
          ))
        )}
      </Box>
      {isTruncated && (
        <Text dimColor italic>
          … diff truncated (exceeded 400 line limit)
        </Text>
      )}
    </Box>
  )
}
