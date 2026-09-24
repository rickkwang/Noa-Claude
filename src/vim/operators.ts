// @ts-nocheck
/**
 * Vim Operator Functions
 *
 * Pure functions for executing vim operators (delete, change, yank, etc.)
 */

import {
  Cursor,
  isVimPunctuation,
  isVimWhitespace,
  isVimWordChar,
} from '../utils/Cursor.js'
import { firstGrapheme, lastGrapheme } from '../utils/intl.js'
import { countCharInString } from '../utils/stringUtils.js'
import {
  isInclusiveMotion,
  isLinewiseMotion,
  resolveMotion,
} from './motions.js'
import { findTextObject } from './textObjects.js'
import type {
  FindType,
  Operator,
  RecordedChange,
  TextObjScope,
} from './types.js'

/**
 * Context for operator execution.
 */
export type OperatorContext = {
  cursor: Cursor
  text: string
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange: (change: RecordedChange) => void
}

/**
 * Record a change for `.` — yanks change nothing, so they never replace the
 * change `.` repeats.
 */
function recordChange(
  op: Operator,
  ctx: OperatorContext,
  change: RecordedChange,
): void {
  if (op !== 'yank') ctx.recordChange(change)
}

// Motions that always succeed, so an operator over an empty range still runs:
// c0 in column 0 or c$ on an empty line enter insert mode, where ch in column
// 0 (h cannot move) does nothing.
const NEVER_FAILING_MOTIONS = new Set(['0', '^', '$'])

/**
 * Execute an operator with a simple motion.
 */
export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: OperatorContext,
): void {
  if (op === 'change' && (motion === 'w' || motion === 'W')) {
    const range = getChangeWordRange(ctx.cursor, motion === 'W', count)
    applyOperator(op, range.from, range.to, ctx)
    recordChange(op, ctx, { type: 'operator', op, motion, count })
    return
  }

  const target = resolveMotion(motion, ctx.cursor, count)
  // j/k past the first or last line land on the text's start or end rather
  // than staying put; under an operator that is a failed motion (dj on the
  // last line does nothing), not a one-line range.
  const lineOf = (offset: number): number =>
    countCharInString(ctx.text.slice(0, offset), '\n')
  if (
    (motion === 'j' || motion === 'k') &&
    lineOf(target.offset) === lineOf(ctx.cursor.offset)
  ) {
    return
  }
  if (target.equals(ctx.cursor)) {
    if (op === 'change' && NEVER_FAILING_MOTIONS.has(motion)) {
      applyOperator(op, ctx.cursor.offset, ctx.cursor.offset, ctx)
      recordChange(op, ctx, { type: 'operator', op, motion, count })
    }
    return
  }

  const range = getOperatorRange(ctx.cursor, target, motion)
  applyOperator(op, range.from, range.to, ctx, range.linewise, range.motionStart)
  recordChange(op, ctx, { type: 'operator', op, motion, count })
}

/**
 * Execute an operator with a find motion.
 */
export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  const targetOffset = ctx.cursor.findCharacter(char, findType, count)
  if (targetOffset === null) return

  const target = new Cursor(ctx.cursor.measuredText, targetOffset)
  const range = getOperatorRangeForFind(ctx.cursor, target, findType)

  applyOperator(op, range.from, range.to, ctx)
  ctx.setLastFind(findType, char)
  recordChange(op, ctx, { type: 'operatorFind', op, find: findType, char, count })
}

/**
 * Execute an operator with a text object.
 */
export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: OperatorContext,
): void {
  const range = findTextObject(
    ctx.text,
    ctx.cursor.offset,
    objType,
    scope === 'inner',
  )
  if (!range) return

  applyOperator(op, range.start, range.end, ctx)
  recordChange(op, ctx, { type: 'operatorTextObj', op, objType, scope, count })
}

/**
 * Execute a line operation (dd, cc, yy).
 */
export function executeLineOp(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  // Calculate logical line by counting newlines before cursor offset
  // (cursor.getPosition() returns wrapped line which is wrong for this)
  const currentLine = countCharInString(text.slice(0, ctx.cursor.offset), '\n')
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const lineStart = ctx.cursor.startOfLogicalLine().offset
  let lineEnd = lineStart
  for (let i = 0; i < linesToAffect; i++) {
    const nextNewline = text.indexOf('\n', lineEnd)
    lineEnd = nextNewline === -1 ? text.length : nextNewline + 1
  }

  let content = text.slice(lineStart, lineEnd)
  // Ensure linewise content ends with newline for paste detection
  if (!content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, true)

  if (op === 'yank') {
    ctx.setOffset(lineStart)
  } else if (op === 'delete') {
    let deleteStart = lineStart
    const deleteEnd = lineEnd

    // If deleting to end of file and there's a preceding newline, include it
    // This ensures deleting the last line doesn't leave a trailing newline
    if (
      deleteEnd === text.length &&
      deleteStart > 0 &&
      text[deleteStart - 1] === '\n'
    ) {
      deleteStart -= 1
    }

    const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
    ctx.setText(newText || '')
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1),
    )
    ctx.setOffset(Math.min(deleteStart, maxOff))
  } else if (op === 'change') {
    // For single line, just clear it
    if (lines.length === 1) {
      ctx.setText('')
      ctx.enterInsert(0)
    } else {
      // Delete all affected lines, replace with single empty line, enter insert
      const beforeLines = lines.slice(0, currentLine)
      const afterLines = lines.slice(currentLine + linesToAffect)
      const newText = [...beforeLines, '', ...afterLines].join('\n')
      ctx.setText(newText)
      ctx.enterInsert(lineStart)
    }
  }

  recordChange(op, ctx, { type: 'lineOp', op, count })
}

/**
 * Execute delete character (x command).
 */
export function executeX(count: number, ctx: OperatorContext): void {
  const from = ctx.cursor.offset

  if (from >= ctx.text.length) return

  // Advance by graphemes, not code units
  let endCursor = ctx.cursor
  for (let i = 0; i < count && !endCursor.isAtEnd(); i++) {
    endCursor = endCursor.right()
  }
  const to = endCursor.offset

  const deleted = ctx.text.slice(from, to)
  const newText = ctx.text.slice(0, from) + ctx.text.slice(to)

  ctx.setRegister(deleted, false)
  ctx.setText(newText)
  const maxOff = Math.max(
    0,
    newText.length - (lastGrapheme(newText).length || 1),
  )
  ctx.setOffset(Math.min(from, maxOff))
  ctx.recordChange({ type: 'x', count })
}

/**
 * Execute replace character (r command).
 */
export function executeReplace(
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  let offset = ctx.cursor.offset
  let newText = ctx.text

  for (let i = 0; i < count && offset < newText.length; i++) {
    const graphemeLen = firstGrapheme(newText.slice(offset)).length || 1
    newText =
      newText.slice(0, offset) + char + newText.slice(offset + graphemeLen)
    offset += char.length
  }

  ctx.setText(newText)
  ctx.setOffset(Math.max(0, offset - char.length))
  ctx.recordChange({ type: 'replace', char, count })
}

/**
 * Execute toggle case (~ command).
 */
export function executeToggleCase(count: number, ctx: OperatorContext): void {
  const startOffset = ctx.cursor.offset

  if (startOffset >= ctx.text.length) return

  let newText = ctx.text
  let offset = startOffset
  let toggled = 0

  while (offset < newText.length && toggled < count) {
    const grapheme = firstGrapheme(newText.slice(offset))
    const graphemeLen = grapheme.length

    const toggledGrapheme =
      grapheme === grapheme.toUpperCase()
        ? grapheme.toLowerCase()
        : grapheme.toUpperCase()

    newText =
      newText.slice(0, offset) +
      toggledGrapheme +
      newText.slice(offset + graphemeLen)
    offset += toggledGrapheme.length
    toggled++
  }

  ctx.setText(newText)
  // Cursor moves to position after the last toggled character
  // At end of line, cursor can be at the "end" position
  ctx.setOffset(offset)
  ctx.recordChange({ type: 'toggleCase', count })
}

/**
 * Execute join lines (J command).
 */
export function executeJoin(count: number, ctx: OperatorContext): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = ctx.cursor.getPosition()

  if (currentLine >= lines.length - 1) return

  const linesToJoin = Math.min(count, lines.length - currentLine - 1)
  let joinedLine = lines[currentLine]!
  const cursorPos = joinedLine.length

  for (let i = 1; i <= linesToJoin; i++) {
    const nextLine = (lines[currentLine + i] ?? '').trimStart()
    if (nextLine.length > 0) {
      if (!joinedLine.endsWith(' ') && joinedLine.length > 0) {
        joinedLine += ' '
      }
      joinedLine += nextLine
    }
  }

  const newLines = [
    ...lines.slice(0, currentLine),
    joinedLine,
    ...lines.slice(currentLine + linesToJoin + 1),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(newLines, currentLine) + cursorPos)
  ctx.recordChange({ type: 'join', count })
}

/**
 * Execute paste (p/P command).
 */
export function executePaste(
  after: boolean,
  count: number,
  ctx: OperatorContext,
): void {
  const register = ctx.getRegister()
  if (!register) return

  const isLinewise = register.endsWith('\n')
  const content = isLinewise ? register.slice(0, -1) : register

  if (isLinewise) {
    const text = ctx.text
    const lines = text.split('\n')
    const { line: currentLine } = ctx.cursor.getPosition()

    const insertLine = after ? currentLine + 1 : currentLine
    const contentLines = content.split('\n')
    const repeatedLines: string[] = []
    for (let i = 0; i < count; i++) {
      repeatedLines.push(...contentLines)
    }

    const newLines = [
      ...lines.slice(0, insertLine),
      ...repeatedLines,
      ...lines.slice(insertLine),
    ]

    const newText = newLines.join('\n')
    ctx.setText(newText)
    ctx.setOffset(getLineStartOffset(newLines, insertLine))
  } else {
    const textToInsert = content.repeat(count)
    const insertPoint =
      after && ctx.cursor.offset < ctx.text.length
        ? ctx.cursor.measuredText.nextOffset(ctx.cursor.offset)
        : ctx.cursor.offset

    const newText =
      ctx.text.slice(0, insertPoint) +
      textToInsert +
      ctx.text.slice(insertPoint)
    const lastGr = lastGrapheme(textToInsert)
    const newOffset = insertPoint + textToInsert.length - (lastGr.length || 1)

    ctx.setText(newText)
    ctx.setOffset(Math.max(insertPoint, newOffset))
  }
  ctx.recordChange({ type: 'paste', after, count })
}

/**
 * Execute indent (>> command).
 */
export function executeIndent(
  dir: '>' | '<',
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = ctx.cursor.getPosition()
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const indent = '  ' // Two spaces

  for (let i = 0; i < linesToAffect; i++) {
    const lineIdx = currentLine + i
    const line = lines[lineIdx] ?? ''

    if (dir === '>') {
      lines[lineIdx] = indent + line
    } else if (line.startsWith(indent)) {
      lines[lineIdx] = line.slice(indent.length)
    } else if (line.startsWith('\t')) {
      lines[lineIdx] = line.slice(1)
    } else {
      // Remove as much leading whitespace as possible up to indent length
      let removed = 0
      let idx = 0
      while (
        idx < line.length &&
        removed < indent.length &&
        /\s/.test(line[idx]!)
      ) {
        removed++
        idx++
      }
      lines[lineIdx] = line.slice(idx)
    }
  }

  const newText = lines.join('\n')
  const currentLineText = lines[currentLine] ?? ''
  const firstNonBlank = (currentLineText.match(/^\s*/)?.[0] ?? '').length

  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(lines, currentLine) + firstNonBlank)
  ctx.recordChange({ type: 'indent', dir, count })
}

/**
 * Execute open line (o/O command).
 */
export function executeOpenLine(
  direction: 'above' | 'below',
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = ctx.cursor.getPosition()

  const insertLine = direction === 'below' ? currentLine + 1 : currentLine
  const newLines = [
    ...lines.slice(0, insertLine),
    '',
    ...lines.slice(insertLine),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
  ctx.enterInsert(getLineStartOffset(newLines, insertLine))
  ctx.recordChange({ type: 'openLine', direction })
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Offset of the first non-blank on the line starting at lineStart. */
function firstNonBlankOffset(text: string, lineStart: number): number {
  let i = lineStart
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  // An all-blank line has no non-blank: stay on its last blank (or its start
  // when empty) rather than on the newline or past the end of the text.
  if (i >= text.length || text[i] === '\n') {
    return i > lineStart ? i - 1 : lineStart
  }
  return i
}

/**
 * Calculate the offset of a line's start position.
 */
function getLineStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0)
}

function getOperatorRange(
  cursor: Cursor,
  target: Cursor,
  motion: string,
): { from: number; to: number; linewise: boolean; motionStart: number } {
  const text = cursor.text
  // Where a yank leaves the cursor: the start of the motion (yj stays put,
  // yk moves up), not the start of the widened linewise range.
  const motionStart = Math.min(cursor.offset, target.offset)
  let from = motionStart
  let to = Math.max(cursor.offset, target.offset)
  let linewise = false

  if (isLinewiseMotion(motion)) {
    // Whole lines, from the start of the first to past the newline ending the
    // last (or to the end of the text). applyOperator decides what happens to
    // the newlines at the edges.
    linewise = true
    // (lastIndexOf clamps a negative start to 0 and would find a newline
    // there, so line 1 is handled explicitly.)
    from = from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1
    const nextNewline = text.indexOf('\n', to)
    to = nextNewline === -1 ? text.length : nextNewline + 1
  } else if (motion === 'w' || motion === 'W') {
    to = clampWordMotionAtLineEnd(text, from, to)
  } else if (isInclusiveMotion(motion) && cursor.offset <= target.offset) {
    to = cursor.measuredText.nextOffset(to)
  }

  // Word motions can land inside an [Image #N] chip; extend the range to
  // cover the whole chip so dw/cw/yw never leave a partial placeholder.
  if (!linewise) {
    from = cursor.snapOutOfImageRef(from, 'start')
    to = cursor.snapOutOfImageRef(to, 'end')
  }

  return { from, to, linewise, motionStart }
}

/**
 * w/W under an operator stop at the end of the line they leave: when the
 * motion crosses a line break to reach the next line's first word, the
 * operated text ends at that line break (vim's exclusive-motion rule). An empty
 * line is the exception — there the line break is all there is to operate on.
 */
function clampWordMotionAtLineEnd(
  text: string,
  from: number,
  to: number,
): number {
  if (text[from] === '\n') return to
  const lastNewline = text.lastIndexOf('\n', to - 1)
  if (lastNewline < from) return to
  if (text.slice(lastNewline + 1, to).trim() !== '') return to
  return lastNewline
}

/**
 * Range for cw / cW. Unlike dw, it changes to the end of the word under the
 * cursor and never reaches into the next one: on the last character of a word
 * or a one-letter word it changes just that. On blanks it behaves like dw,
 * changing the blanks up to the next word, and on an empty line it changes
 * nothing (it only enters insert mode).
 */
function getChangeWordRange(
  cursor: Cursor,
  bigWord: boolean,
  count: number,
): { from: number; to: number } {
  const text = cursor.text
  const from = cursor.offset
  const current = firstGrapheme(text.slice(from))
  if (current === '' || current === '\n') return { from, to: from }

  if (isVimWhitespace(current)) {
    const target = resolveMotion(bigWord ? 'W' : 'w', cursor, count)
    return { from, to: clampWordMotionAtLineEnd(text, from, target.offset) }
  }

  const sameClass = (grapheme: string): boolean =>
    grapheme !== '' &&
    (bigWord
      ? !isVimWhitespace(grapheme)
      : isVimWordChar(current)
        ? isVimWordChar(grapheme)
        : isVimPunctuation(grapheme))
  let end = cursor
  const next = firstGrapheme(text.slice(cursor.measuredText.nextOffset(from)))
  if (sameClass(next)) {
    end = bigWord ? cursor.endOfWORD() : cursor.endOfVimWord()
  }
  for (let i = 1; i < count; i++) {
    end = bigWord ? end.endOfWORD() : end.endOfVimWord()
  }
  const to = Math.min(text.length, cursor.measuredText.nextOffset(end.offset))
  return {
    from: cursor.snapOutOfImageRef(from, 'start'),
    to: cursor.snapOutOfImageRef(to, 'end'),
  }
}

/**
 * Get the range for a find-based operator.
 * Note: _findType is unused because Cursor.findCharacter already adjusts
 * the offset for t/T motions. All find types are treated as inclusive here.
 */
function getOperatorRangeForFind(
  cursor: Cursor,
  target: Cursor,
  _findType: FindType,
): { from: number; to: number } {
  const from = Math.min(cursor.offset, target.offset)
  const maxOffset = Math.max(cursor.offset, target.offset)
  const to = cursor.measuredText.nextOffset(maxOffset)
  return { from, to }
}

function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean = false,
  yankOffset: number = from,
): void {
  let content = ctx.text.slice(from, to)
  // Ensure linewise content ends with newline for paste detection
  if (linewise && !content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, linewise)

  if (op === 'yank') {
    ctx.setOffset(yankOffset)
  } else if (op === 'delete') {
    // Deleting through the last line leaves the newline before the range
    // behind; take it too so no empty trailing line remains.
    const deleteFrom =
      linewise && to === ctx.text.length && from > 0 ? from - 1 : from
    const newText = ctx.text.slice(0, deleteFrom) + ctx.text.slice(to)
    ctx.setText(newText)
    if (linewise) {
      // Vim lands on the first non-blank of the line that took the deleted
      // lines' place, or of the new last line when they were at the end.
      const lineStart =
        deleteFrom === from
          ? Math.min(from, newText.length)
          : newText.lastIndexOf('\n', deleteFrom - 1) + 1
      ctx.setOffset(firstNonBlankOffset(newText, lineStart))
    } else {
      const maxOff = Math.max(
        0,
        newText.length - (lastGrapheme(newText).length || 1),
      )
      ctx.setOffset(Math.min(deleteFrom, maxOff))
    }
  } else if (op === 'change') {
    // Linewise change (cj, cG, ...) replaces the lines with one empty line,
    // like cc, rather than joining what is left around them.
    const keepNewline = linewise && to < ctx.text.length && to > from
    const newText =
      ctx.text.slice(0, from) + (keepNewline ? '\n' : '') + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.enterInsert(from)
  }
}

/**
 * dG / d{N}G. Linewise, so it always has at least the current line to act on:
 * dG on the last line deletes that line rather than doing nothing. A count
 * names the target line; 1G is line 1, not the last line.
 */
export function executeOperatorG(
  op: Operator,
  count: number,
  ctx: OperatorContext,
  countGiven: boolean = count !== 1,
): void {
  const target = countGiven
    ? ctx.cursor.goToLine(count)
    : ctx.cursor.startOfLastLine()
  const range = getOperatorRange(ctx.cursor, target, 'G')
  applyOperator(op, range.from, range.to, ctx, range.linewise, range.motionStart)
  recordChange(op, ctx, { type: 'operator', op, motion: 'G', count, countGiven })
}

/** dgg / d{N}gg — see executeOperatorG. */
export function executeOperatorGg(
  op: Operator,
  count: number,
  ctx: OperatorContext,
  countGiven: boolean = count !== 1,
): void {
  const target = countGiven
    ? ctx.cursor.goToLine(count)
    : ctx.cursor.startOfFirstLine()
  const range = getOperatorRange(ctx.cursor, target, 'gg')
  applyOperator(op, range.from, range.to, ctx, range.linewise, range.motionStart)
  recordChange(op, ctx, { type: 'operator', op, motion: 'gg', count, countGiven })
}

/**
 * Execute an operator on an explicit byte range (used by VISUAL mode).
 * Note: intentionally does not call ctx.recordChange — visual ops are not dot-repeatable.
 */
export function executeVisualOperator(
  op: Operator,
  from: number,
  to: number,
  linewise: boolean,
  ctx: OperatorContext,
): void {
  applyOperator(op, from, to, ctx, linewise)
}
