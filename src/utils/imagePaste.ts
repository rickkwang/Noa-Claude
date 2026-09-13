// @ts-nocheck
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { basename, dirname, isAbsolute, join } from 'path'
import { getImageProcessor } from '../tools/FileReadTool/imageProcessor.js'
import { quote } from './bash/shellQuote.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import { WindowsToWSLConverter } from './idePathConversion.js'
import {
  detectImageFormatFromBase64,
  type ImageDimensions,
  maybeResizeAndDownsampleImageBuffer,
  sniffImageMediaType,
} from './imageResizer.js'
import { logError } from './log.js'
import { getClaudeTempDir } from './permissions/filesystem.js'
import { getPlatform } from './platform.js'

// Threshold in characters for when to consider text a "large paste"
export const PASTE_THRESHOLD = 800

// Maximum size of a collapsed paste that can be re-expanded inline via
// "paste again to expand". Larger pastes stay collapsed so an expansion can't
// blow up the input layout.
export const PASTE_EXPAND_MAX_CHARS = 100_000

const SCREENSHOT_BASENAME = 'claude_cli_latest_screenshot'
const WSL_POWERSHELL =
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
// Drive-letter or UNC path, as Windows apps hand them to a WSL terminal.
const WINDOWS_PATH_RE = /^(?:[A-Za-z]:\\|\\\\)/

/** argv run without a shell, or a shell pipeline. */
type ClipboardCommand = readonly string[] | { shell: string }

type ClipboardCommands = {
  checkImage: ClipboardCommand
  saveImage: ClipboardCommand
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function powerShellLiteral(value: string): string {
  // PowerShell's tokenizer treats U+2018..U+201F as quote delimiters too, so
  // doubling ASCII quotes alone can't make such a value safe.
  if (/[‘-‟]/.test(value)) {
    throw new Error(
      'Cannot quote a path containing typographic quotes for PowerShell',
    )
  }
  return `'${value.replaceAll("'", "''")}'`
}

function getPowerShell(): string {
  if (getPlatform() !== 'wsl') return 'powershell'
  return existsSync(WSL_POWERSHELL) ? WSL_POWERSHELL : 'powershell.exe'
}

function getWslConverter(): WindowsToWSLConverter {
  return new WindowsToWSLConverter(process.env.WSL_DISTRO_NAME)
}

function windowsClipboardCommands(screenshotPath: string): ClipboardCommands {
  const powershell = getPowerShell()
  const savePath =
    getPlatform() === 'wsl'
      ? getWslConverter().toIDEPath(screenshotPath)
      : screenshotPath
  const clipboard = 'Add-Type -AssemblyName System.Windows.Forms;'
  // Clipboard access needs a single-threaded apartment.
  const run = (script: string) => [
    powershell,
    '-NoProfile',
    '-NonInteractive',
    '-Sta',
    '-Command',
    `${clipboard} ${script}`,
  ]
  return {
    checkImage: run(
      'if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 1 }',
    ),
    saveImage: run(
      `$img = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $img) { exit 1 }; $img.Save(${powerShellLiteral(savePath)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
    ),
  }
}

function getClipboardCommands(): {
  commands: ClipboardCommands
  screenshotPath: string
} {
  // Per-user private temp dir: a fixed name in shared /tmp could be
  // pre-created or symlinked by another user. A per-call name keeps two
  // overlapping reads (Cmd+V and Ctrl+V) from deleting each other's file.
  const screenshotPath = join(
    getClaudeTempDir(),
    `${SCREENSHOT_BASENAME}-${randomBytes(4).toString('hex')}.png`,
  )
  const platform = getPlatform()

  if (platform === 'macos') {
    return {
      screenshotPath,
      commands: {
        checkImage: ['osascript', '-e', 'the clipboard as «class PNGf»'],
        saveImage: [
          'osascript',
          '-e',
          'set png_data to (the clipboard as «class PNGf»)',
          '-e',
          `set fp to open for access POSIX file ${appleScriptString(screenshotPath)} with write permission`,
          '-e',
          'write png_data to fp',
          '-e',
          'close access fp',
        ],
      },
    }
  }

  if (platform === 'windows' || platform === 'wsl') {
    return { screenshotPath, commands: windowsClipboardCommands(screenshotPath) }
  }

  const out = quote([screenshotPath])
  return {
    screenshotPath,
    commands: {
      checkImage: {
        shell:
          'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
      },
      saveImage: {
        shell: `xclip -selection clipboard -t image/png -o > ${out} 2>/dev/null || wl-paste --type image/png > ${out} 2>/dev/null || xclip -selection clipboard -t image/bmp -o > ${out} 2>/dev/null || wl-paste --type image/bmp > ${out}`,
      },
    },
  }
}

function getClipboardPathCommand(): ClipboardCommand {
  switch (getPlatform()) {
    case 'macos':
      return [
        'osascript',
        '-e',
        'get POSIX path of (the clipboard as «class furl»)',
      ]
    case 'windows':
    case 'wsl':
      return [getPowerShell(), '-NoProfile', '-Command', 'Get-Clipboard']
    default:
      return {
        shell:
          'xclip -selection clipboard -t text/plain -o 2>/dev/null || wl-paste 2>/dev/null',
      }
  }
}

function runClipboardCommand(command: ClipboardCommand) {
  return 'shell' in command
    ? execFileNoThrowWithCwd(command.shell, [], { shell: true })
    : execFileNoThrowWithCwd(command[0], command.slice(1), {})
}

function isBmp(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d
}

export type ImageWithDimensions = {
  base64: string
  mediaType: string
  dimensions?: ImageDimensions
}

/**
 * Check if clipboard contains an image without retrieving it (macOS only).
 */
export async function hasImageInClipboard(): Promise<boolean> {
  if (getPlatform() !== 'macos') {
    return false
  }
  const result = await execFileNoThrowWithCwd('osascript', [
    '-e',
    'the clipboard as «class PNGf»',
  ])
  return result.code === 0
}

export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  let clipboard: ReturnType<typeof getClipboardCommands>
  try {
    clipboard = getClipboardCommands()
  } catch (e) {
    logError(e as Error)
    return null
  }
  const { commands, screenshotPath } = clipboard
  try {
    if ((await runClipboardCommand(commands.checkImage)).code !== 0) {
      return null
    }
    await getFsImplementation().mkdir(dirname(screenshotPath), { mode: 0o700 })
    if ((await runClipboardCommand(commands.saveImage)).code !== 0) {
      return null
    }

    // Async read: a multi-MB clipboard PNG read synchronously would stall
    // the TUI event loop.
    let imageBuffer = await getFsImplementation().readFileBytes(screenshotPath)

    // BMP is not supported by the API — convert to PNG.
    // This handles WSL2/Linux where Windows copies images as BMP.
    if (isBmp(imageBuffer)) {
      imageBuffer = await (await getImageProcessor())(imageBuffer)
        .png()
        .toBuffer()
    }

    const resized = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )
    const base64Image = resized.buffer.toString('base64')
    return {
      base64: base64Image,
      mediaType: detectImageFormatFromBase64(base64Image),
      dimensions: resized.dimensions,
    }
  } catch {
    return null
  } finally {
    void rm(screenshotPath, { force: true }).catch(() => {})
  }
}

async function getImagePathFromClipboard(): Promise<string | null> {
  try {
    const result = await runClipboardCommand(getClipboardPathCommand())
    if (result.code !== 0 || !result.stdout) {
      return null
    }
    return result.stdout.trim()
  } catch (e) {
    logError(e as Error)
    return null
  }
}

/**
 * Read the clipboard as plain text, or '' when it can't be read.
 */
export async function readClipboardText(): Promise<string> {
  const options = { timeout: 2000 }
  switch (getPlatform()) {
    case 'macos': {
      const result = await execFileNoThrowWithCwd('pbpaste', [], options)
      return result.code === 0 ? result.stdout : ''
    }
    case 'windows':
    case 'wsl': {
      const result = await execFileNoThrowWithCwd(
        getPowerShell(),
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw'],
        options,
      )
      return result.code === 0
        ? result.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '')
        : ''
    }
    case 'linux': {
      for (const [file, args] of [
        ['wl-paste', ['--no-newline']],
        ['xclip', ['-selection', 'clipboard', '-o']],
        ['xsel', ['--clipboard', '--output']],
      ] as const) {
        const result = await execFileNoThrowWithCwd(file, [...args], options)
        if (result.code === 0) return result.stdout
      }
      return ''
    }
    default:
      return ''
  }
}

/**
 * True when clipboard "text" is really binary data (e.g. an image format the
 * clipboard reader couldn't convert) that must not be pasted into the prompt.
 */
export function isBinaryClipboardText(text: string): boolean {
  if (text.includes('\x00')) return true
  const head = text.slice(0, 4096)
  if (head.length < 32) return false
  let replacementChars = 0
  for (const char of head) {
    if (char === '�') replacementChars++
  }
  return replacementChars / head.length > 0.05
}

/**
 * Regex pattern to match supported image file extensions. Kept in sync with
 * MIME_BY_EXT in BriefTool/upload.ts — attachments.ts uses this to set isImage
 * on the wire, and remote viewers fetch /preview iff isImage is true. An ext
 * here but not in MIME_BY_EXT (e.g. bmp) uploads as octet-stream and has no
 * /preview variant → broken thumbnail.
 */
export const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Remove shell escape backslashes from a dragged-in path. Windows paths —
 * native, or handed to a WSL terminal — keep their backslashes.
 */
function stripBackslashEscapes(path: string): string {
  const platform = getPlatform()
  if (
    platform === 'windows' ||
    (platform === 'wsl' && WINDOWS_PATH_RE.test(path))
  ) {
    return path
  }

  // Double backslashes are literal backslashes in the filename; single ones
  // escape the next char ("name\ \(15\).png" -> "name (15).png"). A random
  // placeholder keeps a literal placeholder string in the path from colliding.
  const placeholder = `__DOUBLE_BACKSLASH_${randomBytes(8).toString('hex')}__`
  return path
    .replaceAll('\\\\', placeholder)
    .replace(/\\(.)/g, '$1')
    .replace(new RegExp(placeholder, 'g'), '\\')
}

/**
 * Check if a given text represents an image file path
 */
export function isImageFilePath(text: string): boolean {
  return asImageFilePath(text) !== null
}

/**
 * Normalize text that might be an image file path: trims whitespace, removes
 * outer quotes and shell escapes. Returns null if it isn't an image path.
 */
function asImageFilePath(text: string): string | null {
  const unescaped = stripBackslashEscapes(removeOuterQuotes(text.trim()))
  return IMAGE_EXTENSION_REGEX.test(unescaped) ? unescaped : null
}

/**
 * Read a pasted or dragged-in image path.
 * @returns the image, or null when the text isn't a readable supported image
 * @throws ImageResizeError when the image can't be brought within API limits
 */
export async function tryReadImageFromPath(
  text: string,
): Promise<(ImageWithDimensions & { path: string }) | null> {
  const cleanedPath = asImageFilePath(text)
  if (!cleanedPath) {
    return null
  }

  let imagePath = cleanedPath
  if (getPlatform() === 'wsl' && WINDOWS_PATH_RE.test(imagePath)) {
    imagePath = getWslConverter().toLocalPath(imagePath)
  }

  let imageBuffer
  try {
    if (isAbsolute(imagePath)) {
      // Async read: large dragged-in images must not block the event loop.
      imageBuffer = await getFsImplementation().readFileBytes(imagePath)
    } else {
      // VSCode Terminal pastes just the filename on cmd-v, so match it against
      // the file on the clipboard.
      const clipboardPath = await getImagePathFromClipboard()
      if (clipboardPath && imagePath === basename(clipboardPath)) {
        imageBuffer = await getFsImplementation().readFileBytes(clipboardPath)
      }
    }
  } catch (e) {
    logError(e as Error)
    return null
  }
  if (!imageBuffer) {
    return null
  }
  if (imageBuffer.length === 0) {
    logForDebugging(`Image file is empty: ${imagePath}`, { level: 'warn' })
    return null
  }

  // BMP is not supported by the API — convert to PNG.
  if (isBmp(imageBuffer)) {
    imageBuffer = await (await getImageProcessor())(imageBuffer)
      .png()
      .toBuffer()
  }

  const detected = sniffImageMediaType(imageBuffer)
  if (detected === null) {
    logForDebugging(
      `Pasted path has image extension but content is not a supported image: ${imagePath}`,
      { level: 'warn' },
    )
    return null
  }

  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    imageBuffer.length,
    detected.slice(6),
  )
  return {
    path: imagePath,
    base64: resized.buffer.toString('base64'),
    mediaType: `image/${resized.mediaType}`,
    dimensions: resized.dimensions,
  }
}
