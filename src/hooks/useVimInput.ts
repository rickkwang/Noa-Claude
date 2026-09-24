// @ts-nocheck
import React, { useCallback, useState } from 'react'
import type { Key } from '../ink.js'
import type { VimInputState, VimMode } from '../types/textInputTypes.js'
import { Cursor } from '../utils/Cursor.js'
import { getGraphemeSegmenter, lastGrapheme } from '../utils/intl.js'
import {
  executeVisualOperator,
  type OperatorContext,
} from '../vim/operators.js'
import { replayRecordedChange } from '../vim/replay.js'
import { resolveMotion } from '../vim/motions.js'
import { type TransitionContext, transition } from '../vim/transitions.js'
import {
  createInitialPersistentState,
  createInitialVimState,
  type InsertEntry,
  type PersistentState,
  type RecordedChange,
  type VimState,
} from '../vim/types.js'
import { countCharInString } from '../utils/stringUtils.js'
import { type UseTextInputProps, useTextInput } from './useTextInput.js'

type UseVimInputProps = Omit<UseTextInputProps, 'inputFilter'> & {
  onModeChange?: (mode: VimMode) => void
  onUndo?: () => void
  inputFilter?: UseTextInputProps['inputFilter']
}

// Text a NORMAL-mode command produced, not keys typed at the prompt: a leading
// "!" in it is text (a pasted line, the line o opened under, a repeated
// insert), never the shell-mode trigger it is when typed into an empty input.
const NORMAL_MODE_EDIT = { interpretLeadingModeCharacter: false } as const

export function useVimInput(props: UseVimInputProps): VimInputState {
  const vimStateRef = React.useRef<VimState>(createInitialVimState())
  const [mode, setMode] = useState<VimMode>('INSERT')

  const persistentRef = React.useRef<PersistentState>(
    createInitialPersistentState(),
  )

  // inputFilter is applied once at the top of handleVimInput (not here) so
  // vim-handled paths that return without calling textInput.onInput still
  // run the filter — otherwise a stateful filter (e.g. lazy-space-after-
  // pill) stays armed across an Escape → NORMAL → INSERT round-trip.
  const textInput = useTextInput({ ...props, inputFilter: undefined })
  const { onModeChange, inputFilter } = props

  const switchToInsertMode = useCallback(
    (offset?: number, entry?: InsertEntry): void => {
      if (offset !== undefined) {
        textInput.setOffset(offset)
      }
      vimStateRef.current = {
        mode: 'INSERT',
        insertedText: '',
        insertEntry: entry,
      }
      setMode('INSERT')
      onModeChange?.('INSERT')
    },
    [textInput, onModeChange],
  )

  // Fold the current insert session into lastChange, as leaving insert mode
  // does.
  const commitInsert = useCallback((): void => {
    const current = vimStateRef.current
    if (current.mode !== 'INSERT') return
    if (current.changeToExtend) {
      // cw / cc / C / o ... then text: `.` repeats both, even when nothing
      // was typed (cw<Esc> repeats as a plain delete).
      persistentRef.current.lastChange = {
        ...current.changeToExtend,
        insertText: current.insertedText,
      }
    } else if (current.insertedText) {
      persistentRef.current.lastChange = {
        type: 'insert',
        text: current.insertedText,
        entry: current.insertEntry,
      }
    }
  }, [])

  const switchToNormalMode = useCallback((): void => {
    commitInsert()

    // Vim behavior: move cursor left by 1 when exiting insert mode
    // (unless at beginning of line or at offset 0)
    const offset = textInput.offset
    if (offset > 0 && props.value[offset - 1] !== '\n') {
      textInput.setOffset(offset - 1)
    }

    vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
    setMode('NORMAL')
    onModeChange?.('NORMAL')
  }, [commitInsert, onModeChange, textInput, props.value])

  const switchToVisualMode = useCallback((): void => {
    vimStateRef.current = {
      mode: 'VISUAL',
      visual: { linewise: false, anchor: textInput.offset },
    }
    setMode('VISUAL')
    onModeChange?.('VISUAL')
  }, [textInput, onModeChange])

  const switchToVisualLineMode = useCallback((): void => {
    const anchorLine = countCharInString(
      props.value.slice(0, textInput.offset),
      '\n',
    )
    vimStateRef.current = {
      mode: 'VISUAL_LINE',
      visual: { linewise: true, anchorLine },
    }
    setMode('VISUAL_LINE')
    onModeChange?.('VISUAL_LINE')
  }, [textInput, props.value, onModeChange])

  function createOperatorContext(
    cursor: Cursor,
    isReplay: boolean = false,
  ): OperatorContext {
    return {
      cursor,
      text: props.value,
      setText: (newText: string) => props.onChange(newText, NORMAL_MODE_EDIT),
      setOffset: (offset: number) => textInput.setOffset(offset),
      enterInsert: (offset: number, entry?: InsertEntry) =>
        switchToInsertMode(offset, entry),
      getRegister: () => persistentRef.current.register,
      setRegister: (content: string, linewise: boolean) => {
        persistentRef.current.register = content
        persistentRef.current.registerIsLinewise = linewise
      },
      getLastFind: () => persistentRef.current.lastFind,
      setLastFind: (type, char) => {
        persistentRef.current.lastFind = { type, char }
      },
      recordChange: isReplay
        ? () => {}
        : (change: RecordedChange) => {
            persistentRef.current.lastChange = change
            // The command just opened insert mode (it runs enterInsert before
            // recording): remember it so Esc can fold the typed text in.
            const state = vimStateRef.current
            if (state.mode === 'INSERT') {
              vimStateRef.current = { ...state, changeToExtend: change }
            }
          },
    }
  }

  function replayLastChange(): void {
    const change = persistentRef.current.lastChange
    if (!change) return
    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)
    const result = replayRecordedChange(
      change,
      createOperatorContext(cursor, true),
    )
    if (result.text !== props.value) {
      props.onChange(result.text, NORMAL_MODE_EDIT)
    }
    textInput.setOffset(result.offset)
  }

  // Compute [from, to) byte range for a visual selection.
  function getVisualRange(
    state: VimState & { mode: 'VISUAL' | 'VISUAL_LINE' },
    cursorOffset: number,
  ): [number, number] {
    const text = props.value
    if (state.mode === 'VISUAL_LINE') {
      const anchorLine = state.visual.anchorLine
      const currentLine = countCharInString(text.slice(0, cursorOffset), '\n')
      const topLine = Math.min(anchorLine, currentLine)
      const botLine = Math.max(anchorLine, currentLine)
      // start of topLine
      let lineStart = 0
      let nl = -1
      for (let i = 0; i < topLine; i++) {
        nl = text.indexOf('\n', nl + 1)
        if (nl === -1) { lineStart = text.length; break }
        lineStart = nl + 1
      }
      // end of botLine (include trailing newline if present)
      let lineEnd = lineStart
      let remaining = botLine - topLine + 1
      while (remaining > 0) {
        const next = text.indexOf('\n', lineEnd)
        if (next === -1) { lineEnd = text.length; break }
        lineEnd = next + 1
        remaining--
      }
      return [lineStart, lineEnd]
    } else {
      const anchor = state.visual.anchor
      return [Math.min(anchor, cursorOffset), Math.max(anchor, cursorOffset) + 1]
    }
  }

  function handleVisualInput(
    state: VimState & { mode: 'VISUAL' | 'VISUAL_LINE' },
    input: string,
    key: Key,
  ): void {
    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)
    const ctx = createOperatorContext(cursor, false)
    const linewise = state.mode === 'VISUAL_LINE'

    // Motion keys: move cursor, extending the selection
    let motionInput: string | null = null
    if (key.leftArrow) motionInput = 'h'
    else if (key.rightArrow) motionInput = 'l'
    else if (key.upArrow) motionInput = 'k'
    else if (key.downArrow) motionInput = 'j'
    else if ('hjklwbeWBE0$'.includes(input) && input.length === 1) motionInput = input
    else if (input === '^') motionInput = input

    if (motionInput !== null) {
      const target = resolveMotion(motionInput, cursor, 1)
      if (!target.equals(cursor)) {
        textInput.setOffset(target.offset)
      }
      return
    }

    // Operator keys: apply to selection then return to NORMAL
    if (input === 'd' || input === 'x') {
      const [from, to] = getVisualRange(state, textInput.offset)
      executeVisualOperator('delete', from, to, linewise, ctx)
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      setMode('NORMAL')
      onModeChange?.('NORMAL')
      return
    }

    if (input === 'y') {
      const [from, to] = getVisualRange(state, textInput.offset)
      executeVisualOperator('yank', from, to, linewise, ctx)
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      setMode('NORMAL')
      onModeChange?.('NORMAL')
      return
    }

    if (input === 'c') {
      const [from, to] = getVisualRange(state, textInput.offset)
      // executeVisualOperator 'change' calls ctx.enterInsert() internally
      executeVisualOperator('change', from, to, linewise, ctx)
      // state is now INSERT (set by enterInsert → switchToInsertMode)
      return
    }

    if (input === '~') {
      const [from, to] = getVisualRange(state, textInput.offset)
      const text = props.value
      let toggled = ''
      for (const { segment } of getGraphemeSegmenter().segment(text.slice(from, to))) {
        const up = segment.toUpperCase()
        toggled += up !== segment ? up : segment.toLowerCase()
      }
      props.onChange(text.slice(0, from) + toggled + text.slice(to))
      textInput.setOffset(from)
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      setMode('NORMAL')
      onModeChange?.('NORMAL')
      return
    }
  }

  function handleVimInput(rawInput: string, key: Key): void {
    const state = vimStateRef.current
    // Run inputFilter in all modes so stateful filters disarm on any key,
    // but only apply the transformed input in INSERT — NORMAL-mode command
    // lookups expect single chars and a prepended space would break them.
    const filtered = inputFilter ? inputFilter(rawInput, key) : rawInput
    const input = state.mode === 'INSERT' ? filtered : rawInput
    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)

    if (key.ctrl) {
      textInput.onInput(input, key)
      return
    }

    // NOTE(keybindings): This escape handler is intentionally NOT migrated to the keybindings system.
    // It's vim's standard INSERT->NORMAL mode switch - a vim-specific behavior that should not be
    // configurable via keybindings. Vim users expect Esc to always exit INSERT mode.
    if (key.escape && state.mode === 'INSERT') {
      switchToNormalMode()
      return
    }

    // Escape in NORMAL mode cancels any pending command (replace, operator, etc.)
    if (key.escape && state.mode === 'NORMAL') {
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      return
    }

    // Escape in VISUAL / VISUAL_LINE returns to NORMAL without changing text
    if (key.escape && (state.mode === 'VISUAL' || state.mode === 'VISUAL_LINE')) {
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      setMode('NORMAL')
      onModeChange?.('NORMAL')
      return
    }

    // Pass Enter to base handler regardless of mode (allows submission from NORMAL)
    if (key.return) {
      if (state.mode === 'INSERT') {
        // Enter usually submits, and the next prompt starts in the same
        // INSERT state. Close the insert session here, as Esc would, so a
        // pending change (cw ...) is not extended by the next prompt's typing
        // and replayed onto its text by `.`.
        commitInsert()
        vimStateRef.current = { mode: 'INSERT', insertedText: '' }
      }
      textInput.onInput(input, key)
      return
    }

    if (state.mode === 'INSERT') {
      // Track inserted text for dot-repeat
      if (key.backspace || key.delete) {
        if (state.insertedText.length > 0) {
          vimStateRef.current = {
            ...state,
            insertedText: state.insertedText.slice(
              0,
              -(lastGrapheme(state.insertedText).length || 1),
            ),
          }
        }
      } else {
        vimStateRef.current = {
          ...state,
          insertedText: state.insertedText + input,
        }
      }
      textInput.onInput(input, key)
      return
    }

    if (state.mode === 'VISUAL' || state.mode === 'VISUAL_LINE') {
      handleVisualInput(state, input, key)
      return
    }

    if (state.mode !== 'NORMAL') {
      return
    }

    // In idle state, delegate arrow keys to base handler for cursor movement
    // and history fallback (upOrHistoryUp / downOrHistoryDown)
    if (
      state.command.type === 'idle' &&
      (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)
    ) {
      textInput.onInput(input, key)
      return
    }

    const ctx: TransitionContext = {
      ...createOperatorContext(cursor, false),
      onUndo: props.onUndo,
      onDotRepeat: replayLastChange,
    }

    // Backspace/Delete are only mapped in motion-expecting states. In
    // literal-char states (replace, find, operatorFind), mapping would turn
    // r+Backspace into "replace with h" and df+Delete into "delete to next x".
    // Delete additionally skips count state: in vim, N<Del> removes a count
    // digit rather than executing Nx; we don't implement digit removal but
    // should at least not turn a cancel into a destructive Nx.
    const expectsMotion =
      state.command.type === 'idle' ||
      state.command.type === 'count' ||
      state.command.type === 'operator' ||
      state.command.type === 'operatorCount'

    // Map arrow keys to vim motions in NORMAL mode
    let vimInput = input
    if (key.leftArrow) vimInput = 'h'
    else if (key.rightArrow) vimInput = 'l'
    else if (key.upArrow) vimInput = 'k'
    else if (key.downArrow) vimInput = 'j'
    else if (expectsMotion && key.backspace) vimInput = 'h'
    else if (expectsMotion && state.command.type !== 'count' && key.delete)
      vimInput = 'x'

    // In idle NORMAL state, v/V enter visual modes
    if (state.command.type === 'idle') {
      if (vimInput === 'v') { switchToVisualMode(); return }
      if (vimInput === 'V') { switchToVisualLineMode(); return }
    }

    const result = transition(state.command, vimInput, ctx)

    if (result.execute) {
      result.execute()
    }

    // Update command state (only if execute didn't switch to INSERT)
    if (vimStateRef.current.mode === 'NORMAL') {
      if (result.next) {
        vimStateRef.current = { mode: 'NORMAL', command: result.next }
      } else if (result.execute) {
        vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      }
    }

    if (
      input === '?' &&
      state.mode === 'NORMAL' &&
      state.command.type === 'idle'
    ) {
      props.onChange('?')
    }
  }

  const setModeExternal = useCallback(
    (newMode: VimMode) => {
      if (newMode === 'INSERT') {
        vimStateRef.current = { mode: 'INSERT', insertedText: '' }
      } else if (newMode === 'VISUAL') {
        vimStateRef.current = {
          mode: 'VISUAL',
          visual: { linewise: false, anchor: textInput.offset },
        }
      } else if (newMode === 'VISUAL_LINE') {
        const anchorLine = countCharInString(
          props.value.slice(0, textInput.offset),
          '\n',
        )
        vimStateRef.current = {
          mode: 'VISUAL_LINE',
          visual: { linewise: true, anchorLine },
        }
      } else {
        vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      }
      setMode(newMode)
      onModeChange?.(newMode)
    },
    [onModeChange, textInput, props.value],
  )

  return {
    ...textInput,
    onInput: handleVimInput,
    mode,
    setMode: setModeExternal,
  }
}
