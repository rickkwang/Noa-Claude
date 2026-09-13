import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { createSipsProcessor } from '../../../tools/FileReadTool/imageProcessor.js'
import { detectImageFormatFromBuffer } from '../../../utils/imageResizer.js'

const onDarwin = process.platform === 'darwin'

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#3366cc' },
  })
    .png()
    .toBuffer()
}

describe.skipIf(!onDarwin)('sips image processor', () => {
  const sips = createSipsProcessor()

  test('reads metadata', async () => {
    const meta = await sips(await solidPng(300, 200)).metadata()
    expect(meta).toEqual({ width: 300, height: 200, format: 'png' })
  })

  test('resizes inside the box without enlarging and re-encodes as jpeg', async () => {
    const out = await sips(await solidPng(3000, 2000))
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer()
    expect(detectImageFormatFromBuffer(out)).toBe('image/jpeg')
    expect(await sips(out).metadata()).toMatchObject({ width: 2000, height: 1333 })

    const small = await sips(await solidPng(100, 50))
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .toBuffer()
    expect(await sips(small).metadata()).toMatchObject({ width: 100, height: 50 })
  })

  test('rejects non-image input instead of returning garbage', async () => {
    await expect(sips(Buffer.from('not an image')).metadata()).rejects.toThrow()
    await expect(sips(Buffer.from('not an image')).png().toBuffer()).rejects.toThrow()
  })
})
