import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { tryReadImageFromPath } from '../../utils/imagePaste.js'
import {
  readImageDimensionsFromHeader,
  resizeImageBlockOrPlaceholder,
  sniffImageMediaType,
} from '../../utils/imageResizer.js'

function solid(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: '#3366cc' },
  })
}

describe('image header parsing', () => {
  test('sniffs supported formats and rejects everything else', async () => {
    expect(sniffImageMediaType(await solid(8, 8).png().toBuffer())).toBe('image/png')
    expect(sniffImageMediaType(await solid(8, 8).jpeg().toBuffer())).toBe('image/jpeg')
    expect(sniffImageMediaType(await solid(8, 8).gif().toBuffer())).toBe('image/gif')
    expect(sniffImageMediaType(await solid(8, 8).webp().toBuffer())).toBe('image/webp')
    expect(sniffImageMediaType(Buffer.from('<!doctype html><html>'))).toBeNull()
  })

  test('reads dimensions for every supported format without decoding', async () => {
    for (const encode of ['png', 'jpeg', 'gif', 'webp'] as const) {
      const buffer = await solid(3000, 1234)[encode]().toBuffer()
      expect(readImageDimensionsFromHeader(buffer)).toEqual({ width: 3000, height: 1234 })
    }
    expect(readImageDimensionsFromHeader(Buffer.from('not an image at all'))).toBeUndefined()
  })
})

describe('resizeImageBlockOrPlaceholder', () => {
  test('turns an unprocessable image into a text note instead of throwing', async () => {
    const result = await resizeImageBlockOrPlaceholder({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: '' },
    })
    expect(result.block.type).toBe('text')
    expect((result.block as { text: string }).text).toStartWith('[Image could not be processed:')
  })
})

describe('tryReadImageFromPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'noa-paste-'))

  test('returns null for a file with an image extension but non-image content', async () => {
    const fake = join(dir, 'login-page.png')
    writeFileSync(fake, '<!doctype html><html><body>Sign in</body></html>')
    expect(await tryReadImageFromPath(fake)).toBeNull()
  })

  test('labels the image by its content, not its extension', async () => {
    const mislabeled = join(dir, 'photo.png')
    writeFileSync(mislabeled, await solid(40, 30).jpeg().toBuffer())
    const image = await tryReadImageFromPath(`'${mislabeled}'`)
    expect(image?.mediaType).toBe('image/jpeg')
    expect(image?.path).toBe(mislabeled)
  })
})
