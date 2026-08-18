// @ts-nocheck
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { generateTaskId } from '../../Task.js'
import { persistLargeOutput } from '../../tools/shared/persistLargeOutput.js'
import { getTaskOutputDir, getTaskOutputPath } from '../../utils/task/diskOutput.js'

// Shared by BashTool and PowerShellTool. Both used to run this AFTER throwing
// on a failed command, so a failing build/test with a long log lost both its
// tail (the inline result only carries the head) and any pointer to the file.

const created: string[] = []

async function writeOutputFile(contents: string): Promise<{
  taskId: string
  path: string
}> {
  await mkdir(getTaskOutputDir(), { recursive: true })
  const taskId = generateTaskId('local_bash')
  const path = getTaskOutputPath(taskId)
  await writeFile(path, contents)
  created.push(path)
  return { taskId, path }
}

afterEach(async () => {
  for (const path of created.splice(0)) {
    await rm(path, { force: true })
  }
})

describe('persistLargeOutput', () => {
  test('no-ops when the result carries no output file', async () => {
    expect(await persistLargeOutput({ code: 0 })).toEqual({})
    expect(
      await persistLargeOutput({ code: 0, outputFilePath: '/x' }),
    ).toEqual({})
    expect(await persistLargeOutput({ code: 0, outputTaskId: 'x' })).toEqual({})
  })

  test('links the output file into tool-results and reports path + size', async () => {
    const body = 'head\n'.repeat(1000) + 'TAIL-MARKER\n'
    const { taskId, path } = await writeOutputFile(body)

    const persisted = await persistLargeOutput({
      code: 1,
      outputFilePath: path,
      outputTaskId: taskId,
    })

    expect(persisted.path).toBeTruthy()
    created.push(persisted.path)
    expect(persisted.size).toBe(Buffer.byteLength(body))

    // The tail — the part the inline result drops — is readable from the copy.
    const copied = await readFile(persisted.path, 'utf8')
    expect(copied).toBe(body)
    expect(copied).toContain('TAIL-MARKER')
  })

  test('shares the inode rather than duplicating bytes', async () => {
    const { taskId, path } = await writeOutputFile('x'.repeat(4096))
    const persisted = await persistLargeOutput({
      code: 1,
      outputFilePath: path,
      outputTaskId: taskId,
    })
    created.push(persisted.path)

    const [source, dest] = await Promise.all([stat(path), stat(persisted.path)])
    // Same inode → the second name costs no additional disk.
    expect(dest.ino).toBe(source.ino)
    expect(dest.nlink).toBeGreaterThan(1)
  })

  test('degrades quietly when the output file is already gone', async () => {
    const persisted = await persistLargeOutput({
      code: 1,
      outputFilePath: join(getTaskOutputDir(), 'does-not-exist.output'),
      outputTaskId: generateTaskId('local_bash'),
    })
    expect(persisted).toEqual({})
  })
})
