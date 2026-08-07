// @ts-nocheck
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { FileEditTool } from '../../tools/FileEditTool/FileEditTool.js'
import { getFileModificationTime } from '../../utils/file.js'
import { FileStateCache } from '../../utils/fileStateCache.js'

// Regression coverage for the stale-read rescue added to FileEditTool:
// validateInput() and call() each run their own independent staleness
// check against readFileState, and both must agree on when old_string
// still uniquely applying to the *current* on-disk content is enough to
// skip forcing a re-read. A rescue that validateInput approves but call()
// doesn't recognize would approve the edit for the user and then throw
// FILE_UNEXPECTEDLY_MODIFIED_ERROR when actually executed.
describe('FileEditTool stale-read rescue (validateInput + call agreement)', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-edit-tool-test-'))
    filePath = join(dir, 'target.txt')
    process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
    process.env.CLAUDE_CODE_SIMPLE = '1'
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
    delete process.env.CLAUDE_CODE_SIMPLE
  })

  function makeContext() {
    return {
      readFileState: new FileStateCache(100, 25 * 1024 * 1024),
      dynamicSkillDirTriggers: new Set(),
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
    }
  }

  test('an edit whose old_string still uniquely applies survives both checks and writes the file', async () => {
    const original = 'alpha\nbeta\ngamma\n'
    writeFileSync(filePath, original)
    const readTimestamp = getFileModificationTime(filePath)

    const context = makeContext()
    context.readFileState.set(filePath, {
      content: original,
      timestamp: readTimestamp,
      offset: undefined,
      limit: undefined,
    })

    // Simulate an external change (e.g. a linter) touching unrelated content
    // and bumping mtime, while the region old_string targets stays intact.
    const changed = 'alpha\nBETA-CHANGED-BY-LINTER\ngamma\n'
    writeFileSync(filePath, changed)
    const future = new Date(readTimestamp + 5000)
    utimesSync(filePath, future, future)

    const input = {
      file_path: filePath,
      old_string: 'gamma',
      new_string: 'GAMMA',
      replace_all: false,
    }

    const validation = await FileEditTool.validateInput(input, context)
    expect(validation.result).toBe(true)

    // This is the regression: call() used to re-derive staleness on its own
    // and throw even though validateInput just approved the same edit.
    const result = await FileEditTool.call(input, context, undefined, {
      uuid: 'test-uuid',
    })
    expect(result.data.newString).toBe('GAMMA')

    const written = await Bun.file(filePath).text()
    expect(written).toBe('alpha\nBETA-CHANGED-BY-LINTER\nGAMMA\n')
  })

  test('an edit whose old_string became ambiguous after the external change is still rejected', async () => {
    const original = 'alpha\nbeta\ngamma\n'
    writeFileSync(filePath, original)
    const readTimestamp = getFileModificationTime(filePath)

    const context = makeContext()
    context.readFileState.set(filePath, {
      content: original,
      timestamp: readTimestamp,
      offset: undefined,
      limit: undefined,
    })

    // External change makes old_string ("gamma") match twice — no longer a
    // safe rescue target, so this must still be treated as stale.
    const changed = 'alpha\nbeta\ngamma\ngamma\n'
    writeFileSync(filePath, changed)
    const future = new Date(readTimestamp + 5000)
    utimesSync(filePath, future, future)

    const input = {
      file_path: filePath,
      old_string: 'gamma',
      new_string: 'GAMMA',
      replace_all: false,
    }

    const validation = await FileEditTool.validateInput(input, context)
    expect(validation.result).toBe(false)
    expect(validation.errorCode).toBe(7)
  })
})
