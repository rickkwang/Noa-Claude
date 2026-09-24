import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import type { Message } from '../../types/message.js'
import { extractReadFilesFromMessages } from '../../utils/queryHelpers.js'
import { TOOL_RESULT_CLEARED_MESSAGE } from '../../utils/toolResultStorage.js'

// Resume rebuilds readFileState from the transcript. Each restored entry has to
// describe the file as the model last saw it — otherwise Edit/Write validate
// against the wrong baseline and changed-file notices diff the wrong content.

const dir = mkdtempSync(join(tmpdir(), 'noa-restore-read-state-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const T0 = '2026-09-01T10:00:00.000Z'
let seq = 0

function toolUse(name: string, input: Record<string, unknown>) {
  const id = `toolu_${++seq}`
  const message = {
    type: 'assistant',
    uuid: `a-${id}`,
    message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  } as unknown as Message
  return { id, message }
}

function toolResult(
  id: string,
  content: string,
  opts: { toolUseResult?: unknown; isError?: boolean; timestamp?: string } = {},
): Message {
  return {
    type: 'user',
    uuid: `u-${id}`,
    timestamp: opts.timestamp ?? T0,
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: id, content, ...(opts.isError ? { is_error: true } : {}) },
      ],
    },
    ...(opts.toolUseResult !== undefined ? { toolUseResult: opts.toolUseResult } : {}),
  } as unknown as Message
}

function numbered(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(6)}→${line}`)
    .join('\n')
}

describe('extractReadFilesFromMessages', () => {
  test('restores the exact bytes the Read saw, indentation and trailing newline included', () => {
    const path = join(dir, 'indented.py')
    const raw = '    indented first line\nbody\n'
    const use = toolUse(FILE_READ_TOOL_NAME, { file_path: path })
    const cache = extractReadFilesFromMessages(
      [
        use.message,
        toolResult(use.id, numbered(raw), {
          toolUseResult: { type: 'text', file: { filePath: path, content: raw, numLines: 3, startLine: 1, totalLines: 3 } },
        }),
      ],
      dir,
    )
    expect(cache.get(path)?.content).toBe(raw)
  })

  test('still reconstructs from the numbered text when there is no structured result', () => {
    const path = join(dir, 'legacy.txt')
    const use = toolUse(FILE_READ_TOOL_NAME, { file_path: path })
    const cache = extractReadFilesFromMessages(
      [use.message, toolResult(use.id, numbered('alpha\nbeta'))],
      dir,
    )
    expect(cache.get(path)?.content).toBe('alpha\nbeta')
  })

  test('does not cache a Read result that microcompact already cleared', () => {
    const path = join(dir, 'cleared.txt')
    const use = toolUse(FILE_READ_TOOL_NAME, { file_path: path })
    const cache = extractReadFilesFromMessages(
      [use.message, toolResult(use.id, TOOL_RESULT_CLEARED_MESSAGE)],
      dir,
    )
    expect(cache.get(path)).toBeUndefined()
  })

  test('does not cache the content of a Write that failed', () => {
    const path = join(dir, 'never-written.txt')
    const use = toolUse(FILE_WRITE_TOOL_NAME, { file_path: path, content: 'new content' })
    const cache = extractReadFilesFromMessages(
      [
        use.message,
        toolResult(use.id, 'File has not been read yet. Read it first before writing to it.', { isError: true }),
      ],
      dir,
    )
    expect(cache.get(path)).toBeUndefined()
  })

  test('restores an edited file from disk when nothing changed it since the Edit', () => {
    const path = join(dir, 'edited.txt')
    writeFileSync(path, 'after edit\n')
    const editedAt = new Date(Date.now() + 1000).toISOString()
    const use = toolUse(FILE_EDIT_TOOL_NAME, { file_path: path, old_string: 'a', new_string: 'b' })
    const cache = extractReadFilesFromMessages(
      [use.message, toolResult(use.id, 'The file has been updated.', { timestamp: editedAt })],
      dir,
    )
    expect(cache.get(path)?.content).toBe('after edit\n')
  })

  test('drops an edited file that changed after the Edit, including its earlier Read', () => {
    const path = join(dir, 'changed-later.txt')
    writeFileSync(path, 'changed while the session was closed\n')
    const read = toolUse(FILE_READ_TOOL_NAME, { file_path: path })
    const edit = toolUse(FILE_EDIT_TOOL_NAME, { file_path: path, old_string: 'a', new_string: 'b' })
    // The Edit happened at T0; the file on disk is newer than that.
    utimesSync(path, new Date(), new Date())
    const cache = extractReadFilesFromMessages(
      [
        read.message,
        toolResult(read.id, numbered('before edit'), {
          toolUseResult: { type: 'text', file: { filePath: path, content: 'before edit', numLines: 1, startLine: 1, totalLines: 1 } },
        }),
        edit.message,
        toolResult(edit.id, 'The file has been updated.'),
      ],
      dir,
    )
    expect(cache.get(path)).toBeUndefined()
  })
})
