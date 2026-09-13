// @ts-nocheck
import { basename } from 'path'
import React from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import type { InputEvent, Key } from '../ink.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  getImageFromClipboard,
  isImageFilePath,
  PASTE_THRESHOLD,
  tryReadImageFromPath,
} from '../utils/imagePaste.js'
import type { ImageDimensions } from '../utils/imageResizer.js'
import { logError } from '../utils/log.js'
import { getPlatform } from '../utils/platform.js'

const CLIPBOARD_CHECK_DEBOUNCE_MS = 50

const PLAIN_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  wheelUp: false,
  wheelDown: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  fn: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
}
const RETURN_KEY: Key = { ...PLAIN_KEY, return: true }

// Dragging several files sends newline- or space-separated paths. Spaces
// inside a path arrive escaped, so split only on a space that precedes an
// absolute path (`/…` or `C:\…`).
function splitPastedLines(text: string): string[] {
  return text
    .split(/ (?=\/|[A-Za-z]:\\)/)
    .flatMap(part => part.split('\n'))
    .filter(line => line.trim())
}

type PasteHandlerProps = {
  onPaste?: (text: string) => void
  onInput: (input: string, key: Key) => void
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void
}

export function usePasteHandler({
  onPaste,
  onInput,
  onImagePaste,
}: PasteHandlerProps): {
  wrappedOnInput: (input: string, key: Key, event: InputEvent) => void
  isPasting: boolean
} {
  const [isPasting, setIsPasting] = React.useState(false)
  const [settledTextPastes, setSettledTextPastes] = React.useState(0)
  const isMountedRef = React.useRef(true)
  // Set from the moment a paste arrives until its content is committed.
  const pasteInFlightRef = React.useRef(false)
  // Enter pressed while a paste was in flight (e.g. paste + Enter in one stdin
  // chunk). Replayed after a text paste commits; dropped after an image read.
  const deferredReturnRef = React.useRef(false)
  const onInputRef = React.useRef(onInput)
  onInputRef.current = onInput

  const platform = React.useMemo(() => getPlatform(), [])
  const canReadClipboardImage = platform === 'macos' || platform === 'wsl'

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Runs after the pasted text has committed, so a replayed Enter submits it.
  React.useEffect(() => {
    if (settledTextPastes === 0) return
    const timer = setTimeout(() => {
      pasteInFlightRef.current = false
      if (deferredReturnRef.current) {
        deferredReturnRef.current = false
        onInputRef.current('', RETURN_KEY)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [settledTextPastes])

  const finishImagePaste = React.useCallback(() => {
    if (!isMountedRef.current) return
    pasteInFlightRef.current = false
    deferredReturnRef.current = false
    setIsPasting(false)
  }, [])

  const checkClipboardForImageImpl = React.useCallback(() => {
    if (!onImagePaste || !isMountedRef.current) return

    void getImageFromClipboard()
      .then(imageData => {
        if (imageData && isMountedRef.current) {
          onImagePaste(
            imageData.base64,
            imageData.mediaType,
            undefined, // no filename for clipboard images
            imageData.dimensions,
          )
        }
      })
      .catch(error => {
        if (isMountedRef.current) {
          logError(error as Error)
        }
      })
      .finally(finishImagePaste)
  }, [onImagePaste, finishImagePaste])

  const checkClipboardForImage = useDebounceCallback(
    checkClipboardForImageImpl,
    CLIPBOARD_CHECK_DEBOUNCE_MS,
  )

  function emitText(text: string): void {
    if (onPaste) {
      onPaste(text)
    } else {
      onInputRef.current(text, PLAIN_KEY)
    }
  }

  function handlePastedText(text: string): void {
    pasteInFlightRef.current = true
    setIsPasting(true)

    // A terminal focus report can ride along as a bare `[I`/`[O` tail.
    const rawEmpty = text === '' || text === '[I' || text === '[O'
    const pastedText = text.replace(/\[[IO]$/, '')

    // Cmd+V on an image sends an empty bracketed paste; the image itself is
    // on the clipboard.
    if (rawEmpty && canReadClipboardImage && onImagePaste) {
      checkClipboardForImage()
      return
    }

    const lines = splitPastedLines(pastedText)
    const imagePaths = onImagePaste ? lines.filter(isImageFilePath) : []
    if (imagePaths.length === 0) {
      emitText(pastedText)
      setIsPasting(false)
      setSettledTextPastes(n => n + 1)
      return
    }

    const textLines = lines.filter(line => !isImageFilePath(line))
    const isTempScreenshot =
      /\/TemporaryItems\/.*screencaptureui.*\/Screenshot/i.test(pastedText)

    void Promise.all(imagePaths.map(path => tryReadImageFromPath(path)))
      .then(results => {
        if (!isMountedRef.current) return
        const images = results.filter(
          (r): r is NonNullable<typeof r> => r !== null,
        )
        if (images.length > 0) {
          for (const image of images) {
            onImagePaste(
              image.base64,
              image.mediaType,
              basename(image.path),
              image.dimensions,
              image.path,
            )
          }
          if (textLines.length > 0) {
            emitText(textLines.join('\n'))
          }
          finishImagePaste()
        } else if (isTempScreenshot && platform === 'macos') {
          // A dropped screenshot thumbnail's temp file is already gone, but
          // the image is still on the clipboard.
          checkClipboardForImage()
        } else {
          emitText(pastedText)
          finishImagePaste()
        }
      })
      .catch(error => {
        if (!isMountedRef.current) return
        // Keep the dropped path as text rather than stranding the prompt in
        // "Pasting text…".
        logForDebugging(`Image paste read failed: ${errorMessage(error)}`, {
          level: 'error',
        })
        emitText(pastedText)
        finishImagePaste()
      })
  }

  const wrappedOnInput = (input: string, key: Key, event: InputEvent): void => {
    if (pasteInFlightRef.current && key.return) {
      deferredReturnRef.current = true
      return
    }

    if (event.keypress.isPasted) {
      handlePastedText(input)
      return
    }

    // Without bracketed paste, a paste arrives as one oversized chunk, and a
    // dropped image path as a single chunk containing the path.
    if (
      (onPaste || onImagePaste) &&
      !key.ctrl &&
      !key.meta &&
      (input.length > PASTE_THRESHOLD ||
        (onImagePaste && splitPastedLines(input).some(isImageFilePath)))
    ) {
      handlePastedText(input)
      return
    }

    onInput(input, key)
  }

  return {
    wrappedOnInput,
    isPasting,
  }
}
