/**
 * Vim `.` — replay the last recorded change.
 */

import { lastGrapheme } from '../utils/intl.js'
import {
  executeIndent,
  executeJoin,
  executeLineOp,
  executeOpenLine,
  executeOperatorFind,
  executeOperatorG,
  executeOperatorGg,
  executeOperatorMotion,
  executeOperatorTextObj,
  executePaste,
  executeReplace,
  executeToggleCase,
  executeX,
  type OperatorContext,
} from './operators.js'
import type { RecordedChange } from './types.js'

/**
 * Replays `change` at ctx.cursor and returns the resulting text and cursor.
 *
 * Runs against local copies rather than ctx's setters, so the change and the
 * text typed after it (a change's insertText) land as one edit, and a change
 * that opened insert mode ends in NORMAL with the cursor where Esc would have
 * left it. ctx.setText / setOffset / enterInsert are not called.
 */
export function replayRecordedChange(
  change: RecordedChange,
  ctx: OperatorContext,
): { text: string; offset: number } {
  let text = ctx.text
  let offset = ctx.cursor.offset
  let insertAt: number | null = null
  const local: OperatorContext = {
    ...ctx,
    setText: newText => {
      text = newText
    },
    setOffset: newOffset => {
      offset = newOffset
    },
    enterInsert: at => {
      insertAt = at
    },
    recordChange: () => {},
  }

  switch (change.type) {
    case 'insert':
      insertAt = offset
      break
    case 'x':
      executeX(change.count, local)
      break
    case 'replace':
      executeReplace(change.char, change.count, local)
      break
    case 'toggleCase':
      executeToggleCase(change.count, local)
      break
    case 'indent':
      executeIndent(change.dir, change.count, local)
      break
    case 'join':
      executeJoin(change.count, local)
      break
    case 'openLine':
      executeOpenLine(change.direction, local)
      break
    case 'paste':
      executePaste(change.after, change.count, local)
      break
    case 'lineOp':
      executeLineOp(change.op, change.count, local)
      break
    case 'operator':
      if (change.motion === 'G') {
        executeOperatorG(change.op, change.count, local, change.countGiven)
      } else if (change.motion === 'gg') {
        executeOperatorGg(change.op, change.count, local, change.countGiven)
      } else {
        executeOperatorMotion(change.op, change.motion, change.count, local)
      }
      break
    case 'operatorFind':
      executeOperatorFind(
        change.op,
        change.find,
        change.char,
        change.count,
        local,
      )
      break
    case 'operatorTextObj':
      executeOperatorTextObj(
        change.op,
        change.scope,
        change.objType,
        change.count,
        local,
      )
      break
  }

  if (insertAt !== null) {
    const typed =
      change.type === 'insert'
        ? change.text
        : 'insertText' in change
          ? (change.insertText ?? '')
          : ''
    text = text.slice(0, insertAt) + typed + text.slice(insertAt)
    const end = insertAt + typed.length
    // Esc steps back onto the last inserted character, except at a line start.
    offset =
      end > 0 && text[end - 1] !== '\n'
        ? end - (lastGrapheme(text.slice(0, end)).length || 1)
        : end
  }

  return { text, offset }
}
