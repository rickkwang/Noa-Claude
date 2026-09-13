// @ts-nocheck
import type {
  Base64ImageSource,
  ImageBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import {
  API_IMAGE_MAX_BASE64_SIZE,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import {
  getImageProcessor,
  type SharpFunction,
  type SharpInstance,
} from '../tools/FileReadTool/imageProcessor.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { formatFileSize } from './format.js'
import { logError } from './log.js'

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

// Formats the Messages API accepts; anything else is re-encoded as PNG first.
const API_IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp'])

/**
 * Error thrown when image resizing fails and the image exceeds the API limit.
 */
export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageResizeError'
  }
}

/**
 * sharp/vips don't expose error codes, so decode failures (corrupt data,
 * unsupported encodings) are recognized by message.
 */
function isImageDecodeError(error: unknown): boolean {
  const message = errorMessage(error)
  return [
    'unsupported image format',
    'Input buffer',
    'Input file is missing',
    'corrupt header',
    'corrupt image',
    'premature end',
    'zlib: data error',
    'zero width',
    'zero height',
  ].some(fragment => message.includes(fragment))
}

function normalizeFormat(format: string): string {
  return format === 'jpg' ? 'jpeg' : format
}

/**
 * Identify a supported image by magic bytes. Returns null for anything that
 * isn't a PNG, JPEG, GIF or WebP — including files that merely carry an image
 * extension.
 */
export function sniffImageMediaType(buffer: Buffer): ImageMediaType | null {
  if (buffer.length < 4) return null
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF87a / GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif'
  }
  // RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/** Offset of the JPEG start-of-frame marker, which carries dimensions. */
function findJpegStartOfFrame(buffer: Buffer): number | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === 0xff) {
      offset++
      continue
    }
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (
      marker !== undefined &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return offset
    }
    // Standalone markers (RSTn, SOI, EOI, TEM) have no length field.
    if (
      marker === undefined ||
      (marker >= 0xd0 && marker <= 0xd9) ||
      marker === 0x01
    ) {
      offset += 2
      continue
    }
    const segmentLength = buffer.readUInt16BE(offset + 2)
    if (segmentLength < 2) return
    offset += 2 + segmentLength
  }
  return
}

/**
 * Read pixel dimensions from the file header without decoding, so the size
 * limits still hold when no image processor is available.
 */
export function readImageDimensionsFromHeader(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  if (buffer.length < 10) return
  if (sniffImageMediaType(buffer) === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  const startOfFrame = findJpegStartOfFrame(buffer)
  if (startOfFrame !== undefined) {
    return {
      height: buffer.readUInt16BE(startOfFrame + 5),
      width: buffer.readUInt16BE(startOfFrame + 7),
    }
  }
  if (sniffImageMediaType(buffer) === 'image/webp' && buffer.length >= 30) {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      }
    }
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') {
      return {
        width: buffer.readUIntLE(24, 3) + 1,
        height: buffer.readUIntLE(27, 3) + 1,
      }
    }
  }
  return
}

function isAnimatedWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 30 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP' &&
    buffer.toString('latin1', 12, 16) === 'VP8X' &&
    ((buffer[20] ?? 0) & 0x02) !== 0
  )
}

function describeUndecodableImage(buffer: Buffer): {
  reason: string
  advice: string
} {
  const startOfFrame = findJpegStartOfFrame(buffer)
  if (startOfFrame !== undefined && buffer[startOfFrame + 9] === 4) {
    return {
      reason: 'it is a CMYK JPEG, which cannot be decoded',
      advice: 'Re-save it as an RGB PNG or JPEG and try again.',
    }
  }
  if (isAnimatedWebp(buffer)) {
    return {
      reason: 'it is an animated WebP whose first frame cannot be decoded',
      advice: 'Save its first frame as a PNG or JPEG and try again.',
    }
  }
  return {
    reason:
      'its pixels could not be decoded (the file may be damaged, or use an unsupported encoding)',
    advice: 'Re-save it as a PNG or JPEG and try again.',
  }
}

export type ImageDimensions = {
  originalWidth?: number
  originalHeight?: number
  displayWidth?: number
  displayHeight?: number
}

export interface ResizeResult {
  buffer: Buffer
  mediaType: string
  dimensions?: ImageDimensions
}

interface ImageCompressionContext {
  imageBuffer: Buffer
  metadata: { width?: number; height?: number; format?: string }
  format: string
  maxBytes: number
  originalSize: number
}

interface CompressedImageResult {
  base64: string
  mediaType: Base64ImageSource['media_type']
  originalSize: number
}

/**
 * Resizes an image buffer to meet the API's size and dimension constraints.
 */
export async function maybeResizeAndDownsampleImageBuffer(
  imageBuffer: Buffer,
  originalSize: number,
  ext: string,
): Promise<ResizeResult> {
  if (imageBuffer.length === 0) {
    // sharp would throw "Unable to determine image format", and the fallback's
    // `0 ≤ 5MB` check would pass an empty string the API rejects.
    throw new ImageResizeError('Image file is empty (0 bytes)')
  }
  try {
    const sharp = await getImageProcessor()
    let buffer = imageBuffer
    let size = originalSize
    let metadata = await sharp(buffer).metadata()
    let format = normalizeFormat(metadata.format ?? ext)
    if (!API_IMAGE_FORMATS.has(format)) {
      buffer = await sharp(imageBuffer).png().toBuffer()
      size = buffer.length
      metadata = await sharp(buffer).metadata()
      format = 'png'
    }

    if (!metadata.width || !metadata.height) {
      const header = readImageDimensionsFromHeader(buffer)
      if (
        header === undefined ||
        header.width > IMAGE_MAX_WIDTH ||
        header.height > IMAGE_MAX_HEIGHT
      ) {
        throw new ImageResizeError(
          `Unable to resize image — could not verify image dimensions are within the ${IMAGE_MAX_WIDTH}x${IMAGE_MAX_HEIGHT}px API limit.`,
        )
      }
      if (size > IMAGE_TARGET_RAW_SIZE) {
        const compressedBuffer = await sharp(buffer)
          .jpeg({ quality: 80 })
          .toBuffer()
        return { buffer: compressedBuffer, mediaType: 'jpeg' }
      }
      return { buffer, mediaType: format }
    }

    const originalWidth = metadata.width
    const originalHeight = metadata.height
    let width = originalWidth
    let height = originalHeight

    if (
      size <= IMAGE_TARGET_RAW_SIZE &&
      width <= IMAGE_MAX_WIDTH &&
      height <= IMAGE_MAX_HEIGHT
    ) {
      return {
        buffer,
        mediaType: format,
        dimensions: {
          originalWidth,
          originalHeight,
          displayWidth: width,
          displayHeight: height,
        },
      }
    }

    const needsDimensionResize =
      width > IMAGE_MAX_WIDTH || height > IMAGE_MAX_HEIGHT
    const isPng = format === 'png'

    // Within dimension limits but too many bytes: try compression first to
    // keep full resolution.
    if (!needsDimensionResize && size > IMAGE_TARGET_RAW_SIZE) {
      // PNG compression first to preserve transparency
      if (isPng) {
        const pngCompressed = await sharp(buffer)
          .png({ compressionLevel: 9, palette: true })
          .toBuffer()
        if (pngCompressed.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: pngCompressed,
            mediaType: 'png',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }
      for (const quality of [80, 60, 40, 20]) {
        const compressedBuffer = await sharp(buffer)
          .jpeg({ quality })
          .toBuffer()
        if (compressedBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: compressedBuffer,
            mediaType: 'jpeg',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }
      // Quality reduction alone wasn't enough, fall through to resize
    }

    if (width > IMAGE_MAX_WIDTH) {
      height = Math.round((height * IMAGE_MAX_WIDTH) / width)
      width = IMAGE_MAX_WIDTH
    }

    if (height > IMAGE_MAX_HEIGHT) {
      width = Math.round((width * IMAGE_MAX_HEIGHT) / height)
      height = IMAGE_MAX_HEIGHT
    }

    // Always create a fresh sharp(buffer) instance per operation: reusing one
    // after toBuffer() doesn't reliably apply a new output format.
    logForDebugging(`Resizing to ${width}x${height}`)
    const resizedImageBuffer = await sharp(buffer)
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer()

    if (resizedImageBuffer.length > IMAGE_TARGET_RAW_SIZE) {
      if (isPng) {
        const pngCompressed = await sharp(buffer)
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png({ compressionLevel: 9, palette: true })
          .toBuffer()
        if (pngCompressed.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: pngCompressed,
            mediaType: 'png',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }

      for (const quality of [80, 60, 40, 20]) {
        const compressedBuffer = await sharp(buffer)
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality })
          .toBuffer()
        if (compressedBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: compressedBuffer,
            mediaType: 'jpeg',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }
      // Still too large: shrink further and compress aggressively
      const smallerWidth = Math.min(width, 1000)
      const smallerHeight = Math.round(
        (height * smallerWidth) / Math.max(width, 1),
      )
      logForDebugging('Still too large, compressing with JPEG')
      const compressedBuffer = await sharp(buffer)
        .resize(smallerWidth, smallerHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 20 })
        .toBuffer()
      logForDebugging(`JPEG compressed buffer size: ${compressedBuffer.length}`)
      return {
        buffer: compressedBuffer,
        mediaType: 'jpeg',
        dimensions: {
          originalWidth,
          originalHeight,
          displayWidth: smallerWidth,
          displayHeight: smallerHeight,
        },
      }
    }

    return {
      buffer: resizedImageBuffer,
      // The processor may re-encode formats it can't write (sips: webp → png).
      mediaType: detectImageFormatFromBuffer(resizedImageBuffer).slice(6),
      dimensions: {
        originalWidth,
        originalHeight,
        displayWidth: width,
        displayHeight: height,
      },
    }
  } catch (error) {
    if (error instanceof ImageResizeError) throw error
    logError(error as Error)

    const mediaType = detectImageFormatFromBuffer(imageBuffer).slice(6)
    // The API limit is on the base64-encoded length
    const base64Size = Math.ceil((originalSize * 4) / 3)

    // Size-under-5MB does not imply dimensions-under-cap, so the header must
    // prove the dimensions before the raw buffer is passed through.
    const header = readImageDimensionsFromHeader(imageBuffer)
    if (header === undefined) {
      throw new ImageResizeError(
        'Unable to resize image — image processing is unavailable and dimensions could not be read from the file header. ' +
          'Please convert the image to PNG, JPEG, GIF, or WebP.',
      )
    }
    const overDim =
      header.width > IMAGE_MAX_WIDTH || header.height > IMAGE_MAX_HEIGHT

    if (base64Size <= API_IMAGE_MAX_BASE64_SIZE && !overDim) {
      return { buffer: imageBuffer, mediaType }
    }

    if (isImageDecodeError(error)) {
      const { reason, advice } = describeUndecodableImage(imageBuffer)
      const limit = overDim
        ? `at ${header.width}x${header.height}px it is over the ${IMAGE_MAX_WIDTH}x${IMAGE_MAX_HEIGHT}px limit`
        : `it is over the ${formatFileSize(API_IMAGE_MAX_BASE64_SIZE)} API limit (${formatFileSize(originalSize)} raw, ${formatFileSize(base64Size)} base64)`
      throw new ImageResizeError(
        `Unable to resize image — ${reason}, and ${limit}, so it cannot be sent. ${advice}`,
      )
    }

    throw new ImageResizeError(
      overDim
        ? `Unable to resize image — dimensions exceed the ${IMAGE_MAX_WIDTH}x${IMAGE_MAX_HEIGHT}px limit and image processing failed. ` +
            `Please resize the image to reduce its pixel dimensions.`
        : `Unable to resize image (${formatFileSize(originalSize)} raw, ${formatFileSize(base64Size)} base64). ` +
            `The image exceeds the ${formatFileSize(API_IMAGE_MAX_BASE64_SIZE)} API limit and compression failed. ` +
            `Please resize the image manually or use a smaller image.`,
    )
  }
}

export interface ImageBlockWithDimensions {
  block: ImageBlockParam
  dimensions?: ImageDimensions
}

/**
 * Resizes an image content block if needed
 * Takes an image ImageBlockParam and returns a resized version if necessary
 * Also returns dimension information for coordinate mapping
 */
export async function maybeResizeAndDownsampleImageBlock(
  imageBlock: ImageBlockParam,
): Promise<ImageBlockWithDimensions> {
  // Only process base64 images
  if (imageBlock.source.type !== 'base64') {
    return { block: imageBlock }
  }

  const imageBuffer = Buffer.from(imageBlock.source.data, 'base64')
  const originalSize = imageBuffer.length
  const mediaType = imageBlock.source.media_type
  const ext = mediaType?.split('/')[1] || 'png'

  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    originalSize,
    ext,
  )

  return {
    block: {
      type: 'image',
      source: {
        type: 'base64',
        media_type:
          `image/${resized.mediaType}` as Base64ImageSource['media_type'],
        data: resized.buffer.toString('base64'),
      },
    },
    dimensions: resized.dimensions,
  }
}

/**
 * Like maybeResizeAndDownsampleImageBlock, but an image that can't be brought
 * within limits becomes a text note instead of failing the whole prompt.
 */
export async function resizeImageBlockOrPlaceholder(
  imageBlock: ImageBlockParam,
): Promise<{
  block: ImageBlockParam | TextBlockParam
  dimensions?: ImageDimensions
}> {
  try {
    return await maybeResizeAndDownsampleImageBlock(imageBlock)
  } catch (error) {
    if (!(error instanceof ImageResizeError)) throw error
    return {
      block: {
        type: 'text',
        text: `[Image could not be processed: ${error.message}]`,
      },
    }
  }
}

/**
 * Compresses an image buffer to fit within a maximum byte size.
 *
 * Strategies get progressively more aggressive, because simple compression
 * often fails for large screenshots, photos, or complex gradients:
 * 1. Preserve the original format with progressive resizing
 * 2. For PNG: palette optimization and color reduction
 * 3. Last resort: JPEG with aggressive compression
 */
export async function compressImageBuffer(
  imageBuffer: Buffer,
  maxBytes: number = IMAGE_TARGET_RAW_SIZE,
  originalMediaType?: string,
): Promise<CompressedImageResult> {
  const fallbackFormat = normalizeFormat(
    originalMediaType?.split('/')[1] || 'jpeg',
  )

  try {
    const sharp = await getImageProcessor()
    let buffer = imageBuffer
    let metadata = await sharp(buffer).metadata()
    let format = normalizeFormat(metadata.format || fallbackFormat)
    if (!API_IMAGE_FORMATS.has(format)) {
      buffer = await sharp(imageBuffer).png().toBuffer()
      metadata = await sharp(buffer).metadata()
      format = 'png'
    }
    const originalSize = imageBuffer.length

    const context: ImageCompressionContext = {
      imageBuffer: buffer,
      metadata,
      format,
      maxBytes,
      originalSize,
    }

    if (buffer.length <= maxBytes) {
      return createCompressedImageResult(buffer, format, originalSize)
    }

    const resizedResult = await tryProgressiveResizing(context, sharp)
    if (resizedResult) {
      return resizedResult
    }

    if (format === 'png') {
      const palettizedResult = await tryPalettePNG(context, sharp)
      if (palettizedResult) {
        return palettizedResult
      }
    }

    const jpegResult = await tryJPEGConversion(context, 50, sharp)
    if (jpegResult) {
      return jpegResult
    }

    return await createUltraCompressedJPEG(context, sharp)
  } catch (error) {
    logError(error as Error)

    // If original image is within the requested limit, allow it through
    if (imageBuffer.length <= maxBytes) {
      return {
        base64: imageBuffer.toString('base64'),
        mediaType: detectImageFormatFromBuffer(imageBuffer),
        originalSize: imageBuffer.length,
      }
    }

    if (isImageDecodeError(error)) {
      const { reason, advice } = describeUndecodableImage(imageBuffer)
      throw new ImageResizeError(
        `Unable to compress image (${formatFileSize(imageBuffer.length)}) to fit within ${formatFileSize(maxBytes)} — ${reason}. ${advice}`,
      )
    }

    throw new ImageResizeError(
      `Unable to compress image (${formatFileSize(imageBuffer.length)}) to fit within ${formatFileSize(maxBytes)}. ` +
        `Please use a smaller image.`,
    )
  }
}

/**
 * Compresses an image buffer to fit within a token limit.
 * Converts tokens to bytes using the formula: maxBytes = (maxTokens / 0.125) * 0.75
 */
export async function compressImageBufferWithTokenLimit(
  imageBuffer: Buffer,
  maxTokens: number,
  originalMediaType?: string,
): Promise<CompressedImageResult> {
  // base64 uses about 4/3 the original size, so we reverse this
  const maxBase64Chars = Math.floor(maxTokens / 0.125)
  const maxBytes = Math.floor(maxBase64Chars * 0.75)

  return compressImageBuffer(imageBuffer, maxBytes, originalMediaType)
}

/**
 * Compresses an image block to fit within a maximum byte size.
 * Wrapper around compressImageBuffer for ImageBlockParam.
 */
export async function compressImageBlock(
  imageBlock: ImageBlockParam,
  maxBytes: number = IMAGE_TARGET_RAW_SIZE,
): Promise<ImageBlockParam> {
  if (imageBlock.source.type !== 'base64') {
    return imageBlock
  }

  const imageBuffer = Buffer.from(imageBlock.source.data, 'base64')
  if (imageBuffer.length <= maxBytes) {
    return imageBlock
  }

  const compressed = await compressImageBuffer(imageBuffer, maxBytes)

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: compressed.mediaType,
      data: compressed.base64,
    },
  }
}

// Helper functions for compression pipeline

function createCompressedImageResult(
  buffer: Buffer,
  mediaType: string,
  originalSize: number,
): CompressedImageResult {
  return {
    base64: buffer.toString('base64'),
    mediaType:
      `image/${normalizeFormat(mediaType)}` as Base64ImageSource['media_type'],
    originalSize,
  }
}

async function tryProgressiveResizing(
  context: ImageCompressionContext,
  sharp: SharpFunction,
): Promise<CompressedImageResult | null> {
  const scalingFactors = [1.0, 0.75, 0.5, 0.25]

  for (const scalingFactor of scalingFactors) {
    const newWidth = Math.round(
      (context.metadata.width || 2000) * scalingFactor,
    )
    const newHeight = Math.round(
      (context.metadata.height || 2000) * scalingFactor,
    )

    let resizedImage = sharp(context.imageBuffer).resize(newWidth, newHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })

    resizedImage = applyFormatOptimizations(resizedImage, context.format)

    const resizedBuffer = await resizedImage.toBuffer()

    if (resizedBuffer.length <= context.maxBytes) {
      return createCompressedImageResult(
        resizedBuffer,
        detectImageFormatFromBuffer(resizedBuffer).slice(6),
        context.originalSize,
      )
    }
  }

  return null
}

function applyFormatOptimizations(
  image: SharpInstance,
  format: string,
): SharpInstance {
  switch (format) {
    case 'png':
      return image.png({
        compressionLevel: 9,
        palette: true,
      })
    case 'jpeg':
      return image.jpeg({ quality: 80 })
    case 'webp':
      return image.webp({ quality: 80 })
    default:
      return image
  }
}

async function tryPalettePNG(
  context: ImageCompressionContext,
  sharp: SharpFunction,
): Promise<CompressedImageResult | null> {
  const palettePng = await sharp(context.imageBuffer)
    .resize(800, 800, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({
      compressionLevel: 9,
      palette: true,
      colors: 64,
    })
    .toBuffer()

  if (palettePng.length <= context.maxBytes) {
    return createCompressedImageResult(palettePng, 'png', context.originalSize)
  }

  return null
}

async function tryJPEGConversion(
  context: ImageCompressionContext,
  quality: number,
  sharp: SharpFunction,
): Promise<CompressedImageResult | null> {
  const jpegBuffer = await sharp(context.imageBuffer)
    .resize(600, 600, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality })
    .toBuffer()

  if (jpegBuffer.length <= context.maxBytes) {
    return createCompressedImageResult(jpegBuffer, 'jpeg', context.originalSize)
  }

  return null
}

async function createUltraCompressedJPEG(
  context: ImageCompressionContext,
  sharp: SharpFunction,
): Promise<CompressedImageResult> {
  const ultraCompressedBuffer = await sharp(context.imageBuffer)
    .resize(400, 400, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 20 })
    .toBuffer()

  return createCompressedImageResult(
    ultraCompressedBuffer,
    'jpeg',
    context.originalSize,
  )
}

/**
 * Detect image format from a buffer using magic bytes, defaulting to PNG.
 */
export function detectImageFormatFromBuffer(buffer: Buffer): ImageMediaType {
  return sniffImageMediaType(buffer) ?? 'image/png'
}

/**
 * Detect image format from base64 data using magic bytes, defaulting to PNG.
 */
export function detectImageFormatFromBase64(
  base64Data: string,
): ImageMediaType {
  try {
    return detectImageFormatFromBuffer(Buffer.from(base64Data, 'base64'))
  } catch {
    return 'image/png'
  }
}

/**
 * Creates a text description of image metadata including dimensions and source path.
 * Returns null if no useful metadata is available.
 */
export function createImageMetadataText(
  dims: ImageDimensions,
  sourcePath?: string,
): string | null {
  const { originalWidth, originalHeight, displayWidth, displayHeight } = dims
  // Checks for undefined/null and zero to prevent division by zero
  if (
    !originalWidth ||
    !originalHeight ||
    !displayWidth ||
    !displayHeight ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    if (sourcePath) {
      return `[Image source: ${sourcePath}]`
    }
    return null
  }
  const wasResized =
    originalWidth !== displayWidth || originalHeight !== displayHeight

  if (!wasResized && !sourcePath) {
    return null
  }

  const parts: string[] = []

  if (sourcePath) {
    parts.push(`source: ${sourcePath}`)
  }

  if (wasResized) {
    const scaleFactor = originalWidth / displayWidth
    parts.push(
      `original ${originalWidth}x${originalHeight}, displayed at ${displayWidth}x${displayHeight}. Multiply coordinates by ${scaleFactor.toFixed(2)} to map to original image.`,
    )
  }

  return `[Image: ${parts.join(', ')}]`
}
