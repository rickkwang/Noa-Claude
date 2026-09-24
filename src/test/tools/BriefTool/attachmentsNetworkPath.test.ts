import { describe, expect, test } from 'bun:test'
import {
  resolveAttachments,
  validateAttachmentPaths,
} from '../../../tools/BriefTool/attachments.js'

// A path that would stat through to a network mount must be refused from the
// string alone, before the permission check has run.
describe('BriefTool attachment network paths', () => {
  test('validate refuses UNC paths', async () => {
    const r = await validateAttachmentPaths(['//server/share/f.png'])
    expect(r.result).toBe(false)
    expect((r as { message: string }).message).toContain('UNC network path')
  })

  test('validate refuses macOS kernel-redirected prefixes', async () => {
    for (const p of ['/.vol/1/2', '/.file/id=1.2', '/tmp/../.nofollow/x']) {
      const r = await validateAttachmentPaths([p])
      expect(r.result).toBe(false)
      expect((r as { message: string }).message).toContain('/.vol, /.file, /.nofollow or /.resolve')
    }
  })

  test('resolve throws instead of statting a network path', async () => {
    await expect(
      resolveAttachments(['/.resolve/1/x'], { replBridgeEnabled: false }),
    ).rejects.toThrow('network path')
  })
})

describe('BriefTool attachment symlinks', () => {
  test('validate refuses a link that leads to a network path', async () => {
    const { mkdtempSync, rmSync, symlinkSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = mkdtempSync(join(tmpdir(), 'brief-link-'))
    try {
      symlinkSync('/.vol/1/2', join(dir, 'l.png'))
      const r = await validateAttachmentPaths([join(dir, 'l.png')])
      expect(r.result).toBe(false)
      expect((r as { message: string }).message).toContain('symbolic link')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
