import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readImageWithTokenBudget } from '../../tools/FileReadTool/FileReadTool.js'

describe('readImageWithTokenBudget source cap', () => {
  test('refuses a regular file over the cap before reading it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'noa-image-cap-'))
    try {
      const filePath = join(dir, 'over.png')
      writeFileSync(filePath, Buffer.alloc(64))
      await expect(
        readImageWithTokenBudget(filePath, 100, 32),
      ).rejects.toThrow(/File is too large to read as an image/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refuses a pipe or device that never ends', async () => {
    if (!existsSync('/dev/zero')) {
      return
    }
    await expect(
      readImageWithTokenBudget('/dev/zero', 100, 1024),
    ).rejects.toThrow(/is a pipe or a device, not a regular file/)
  })
})
