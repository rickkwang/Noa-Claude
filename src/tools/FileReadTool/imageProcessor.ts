// @ts-nocheck
import type { Buffer } from 'buffer'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

export type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

export type SharpFunction = (input: Buffer) => SharpInstance

let imageProcessorModule: { default: SharpFunction } | null = null

export async function getImageProcessor(): Promise<SharpFunction> {
  if (imageProcessorModule) {
    return imageProcessorModule.default
  }

  // Single structural cast: our SharpFunction is a subset of sharp's actual type surface.
  try {
    const imported = (await import(
      'sharp'
    )) as unknown as MaybeDefault<SharpFunction>
    const sharp = unwrapDefault(imported)
    if (typeof sharp === 'function') {
      imageProcessorModule = { default: sharp }
      return sharp
    }
  } catch (error) {
    if (process.platform !== 'darwin') throw error
  }

  // A compiled binary can't load sharp's external native addon. On macOS the
  // system `sips` tool covers the resize/re-encode subset we use, so large
  // images still get downsampled instead of rejected.
  if (process.platform === 'darwin') {
    logForDebugging('sharp not available, using sips image processor')
    imageProcessorModule = { default: createSipsProcessor() }
    return imageProcessorModule.default
  }
  throw new Error('Native image processor module not available')
}

// Dynamic import shape varies by module interop mode — ESM yields { default: fn }, CJS yields fn directly.
type MaybeDefault<T> = T | { default: T }

function unwrapDefault<T extends (...args: never[]) => unknown>(
  mod: MaybeDefault<T>,
): T {
  return typeof mod === 'function' ? mod : mod.default
}

const SIPS_TIMEOUT_MS = 60_000
// Formats sips can write. Anything else (webp) is re-encoded as PNG; callers
// label output by magic bytes, not by the format they asked for.
const SIPS_WRITABLE_FORMATS = new Set(['png', 'jpeg', 'gif'])

type SipsMetadata = { width: number; height: number; format: string }

async function withSipsInput<T>(
  input: Buffer,
  fn: (dir: string, inPath: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'noa-sips-'))
  try {
    const inPath = join(dir, 'input')
    await writeFile(inPath, input)
    return await fn(dir, inPath)
  } finally {
    void rm(dir, { recursive: true, force: true })
  }
}

async function runSips(args: string[]): Promise<string> {
  const result = await execFileNoThrowWithCwd('sips', args, {
    timeout: SIPS_TIMEOUT_MS,
    preserveOutputOnError: true,
  })
  if (result.code !== 0) {
    throw new Error(`sips failed: ${result.stderr || result.error || result.code}`)
  }
  return result.stdout
}

async function readSipsMetadata(inPath: string): Promise<SipsMetadata> {
  // sips exits 0 on unreadable input ("not a valid file - skipping"), so a
  // missing field is the failure signal.
  const stdout = await runSips([
    '-g',
    'pixelWidth',
    '-g',
    'pixelHeight',
    '-g',
    'format',
    inPath,
  ])
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1])
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1])
  const format = stdout.match(/format:\s*(\S+)/)?.[1]
  if (!width || !height || !format) {
    throw new Error('sips: unsupported image format')
  }
  return { width, height, format }
}

export function createSipsProcessor(): SharpFunction {
  return (input: Buffer) => {
    let resizeTo: { width: number; height: number; withoutEnlargement?: boolean } | null =
      null
    let output: { format: string; quality?: number } | null = null

    const instance: SharpInstance = {
      metadata: () => withSipsInput(input, (_dir, inPath) => readSipsMetadata(inPath)),
      resize(width, height, options) {
        resizeTo = { width, height, withoutEnlargement: options?.withoutEnlargement }
        return instance
      },
      jpeg(options) {
        output = { format: 'jpeg', quality: options?.quality }
        return instance
      },
      png() {
        output = { format: 'png' }
        return instance
      },
      webp() {
        output = { format: 'webp' }
        return instance
      },
      toBuffer: () =>
        withSipsInput(input, async (dir, inPath) => {
          const meta = await readSipsMetadata(inPath)
          const args: string[] = []
          if (resizeTo) {
            // Every caller uses fit: 'inside' — scale to fit within the box.
            let scale = Math.min(resizeTo.width / meta.width, resizeTo.height / meta.height)
            if (resizeTo.withoutEnlargement) scale = Math.min(scale, 1)
            const width = Math.max(1, Math.round(meta.width * scale))
            const height = Math.max(1, Math.round(meta.height * scale))
            if (width !== meta.width || height !== meta.height) {
              args.push('-z', String(height), String(width))
            }
          }
          const requested = output?.format ?? meta.format
          const format = SIPS_WRITABLE_FORMATS.has(requested) ? requested : 'png'
          args.push('-s', 'format', format)
          if (format === 'jpeg' && output?.quality !== undefined) {
            args.push('-s', 'formatOptions', String(output.quality))
          }
          const outPath = join(dir, `output.${format}`)
          await runSips([...args, inPath, '--out', outPath])
          try {
            return await readFile(outPath)
          } catch {
            throw new Error('sips: image conversion produced no output')
          }
        }),
    }
    return instance
  }
}
