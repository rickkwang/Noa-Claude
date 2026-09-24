// @ts-nocheck
/**
 * Vim Mode State Machine Types
 *
 * This file defines the complete state machine for vim input handling.
 * The types ARE the documentation - reading them tells you how the system works.
 *
 * State Diagram:
 * ```
 *                              VimState
 *   ┌──────────────────────────────┬──────────────────────────────────────┐
 *   │  INSERT                      │  NORMAL                              │
 *   │  (tracks insertedText)       │  (CommandState machine)              │
 *   │                              │                                      │
 *   │                              │  idle ──┬─[d/c/y]──► operator        │
 *   │                              │         ├─[1-9]────► count           │
 *   │                              │         ├─[fFtT]───► find            │
 *   │                              │         ├─[g]──────► g               │
 *   │                              │         ├─[r]──────► replace         │
 *   │                              │         └─[><]─────► indent          │
 *   │                              │                                      │
 *   │                              │  operator ─┬─[motion]──► execute     │
 *   │                              │            ├─[0-9]────► operatorCount│
 *   │                              │            ├─[ia]─────► operatorTextObj
 *   │                              │            └─[fFtT]───► operatorFind │
 *   └──────────────────────────────┴──────────────────────────────────────┘
 * ```
 */

// ============================================================================
// Core Types
// ============================================================================

export type Operator = 'delete' | 'change' | 'yank'

export type FindType = 'f' | 'F' | 't' | 'T'

export type TextObjScope = 'inner' | 'around'

// ============================================================================
// State Machine Types
// ============================================================================

/**
 * Visual selection anchor. Linewise tracks the anchor row; charwise tracks the
 * anchor byte offset. The current cursor offset is always the live endpoint.
 */
export type VisualState =
  | { linewise: false; anchor: number }
  | { linewise: true; anchorLine: number }

/**
 * Complete vim state. Mode determines what data is tracked.
 *
 * INSERT mode: Track text being typed (for dot-repeat)
 * NORMAL mode: Track command being parsed (state machine)
 * VISUAL / VISUAL_LINE: Track visual selection anchor
 */
export type VimState =
  | {
      mode: 'INSERT'
      insertedText: string
      // The change that opened this insert (cw, cc, C, o, ...). On Esc the
      // typed text is folded into it, so `.` repeats the change and the text
      // together, as vim does.
      changeToExtend?: RecordedChange
    }
  | { mode: 'NORMAL'; command: CommandState }
  | { mode: 'VISUAL'; visual: VisualState & { linewise: false } }
  | { mode: 'VISUAL_LINE'; visual: VisualState & { linewise: true } }

/**
 * Command state machine for NORMAL mode.
 *
 * Each state knows exactly what input it's waiting for.
 * TypeScript ensures exhaustive handling in switches.
 */
export type CommandState =
  | { type: 'idle' }
  | { type: 'count'; digits: string }
  // countGiven: a count was typed. Needed where a count of 1 differs from no
  // count at all (1G is line 1, G is the last line).
  | { type: 'operator'; op: Operator; count: number; countGiven: boolean }
  | { type: 'operatorCount'; op: Operator; count: number; digits: string }
  | { type: 'operatorFind'; op: Operator; count: number; find: FindType }
  | {
      type: 'operatorTextObj'
      op: Operator
      count: number
      scope: TextObjScope
    }
  | { type: 'find'; find: FindType; count: number }
  | { type: 'g'; count: number }
  | { type: 'operatorG'; op: Operator; count: number; countGiven: boolean }
  | { type: 'replace'; count: number }
  | { type: 'indent'; dir: '>' | '<'; count: number }

/**
 * Persistent state that survives across commands.
 * This is the "memory" of vim - what gets recalled for repeats and pastes.
 */
export type PersistentState = {
  lastChange: RecordedChange | null
  lastFind: { type: FindType; char: string } | null
  register: string
  registerIsLinewise: boolean
}

/**
 * Recorded change for dot-repeat.
 * Captures everything needed to replay a command.
 */
/** Text typed in the insert mode a change opened (see changeToExtend). */
type InsertTail = { insertText?: string }

export type RecordedChange =
  | { type: 'insert'; text: string }
  | ({
      type: 'operator'
      op: Operator
      motion: string
      count: number
      countGiven?: boolean
    } & InsertTail)
  | ({ type: 'lineOp'; op: Operator; count: number } & InsertTail)
  | ({
      type: 'operatorTextObj'
      op: Operator
      objType: string
      scope: TextObjScope
      count: number
    } & InsertTail)
  | ({
      type: 'operatorFind'
      op: Operator
      find: FindType
      char: string
      count: number
    } & InsertTail)
  | { type: 'replace'; char: string; count: number }
  | { type: 'x'; count: number }
  | { type: 'toggleCase'; count: number }
  | { type: 'indent'; dir: '>' | '<'; count: number }
  | ({ type: 'openLine'; direction: 'above' | 'below' } & InsertTail)
  | { type: 'join'; count: number }
  | { type: 'paste'; after: boolean; count: number }

// ============================================================================
// Key Groups - Named constants, no magic strings
// ============================================================================

export const OPERATORS = {
  d: 'delete',
  c: 'change',
  y: 'yank',
} as const satisfies Record<string, Operator>

export function isOperatorKey(key: string): key is keyof typeof OPERATORS {
  return key in OPERATORS
}

export const SIMPLE_MOTIONS = new Set([
  'h',
  'l',
  'j',
  'k', // Basic movement
  ' ', // Space moves right (same as l)
  'w',
  'b',
  'e',
  'W',
  'B',
  'E', // Word motions
  '0',
  '^',
  '$', // Line positions
])

export const FIND_KEYS = new Set(['f', 'F', 't', 'T'])

export const TEXT_OBJ_SCOPES = {
  i: 'inner',
  a: 'around',
} as const satisfies Record<string, TextObjScope>

export function isTextObjScopeKey(
  key: string,
): key is keyof typeof TEXT_OBJ_SCOPES {
  return key in TEXT_OBJ_SCOPES
}

export const TEXT_OBJ_TYPES = new Set([
  'w',
  'W', // Word/WORD
  '"',
  "'",
  '`', // Quotes
  '(',
  ')',
  'b', // Parens
  '[',
  ']', // Brackets
  '{',
  '}',
  'B', // Braces
  '<',
  '>', // Angle brackets
])

export const MAX_VIM_COUNT = 10000

// ============================================================================
// State Factories
// ============================================================================

export function createInitialVimState(): VimState {
  return { mode: 'INSERT', insertedText: '' }
}

export function createInitialPersistentState(): PersistentState {
  return {
    lastChange: null,
    lastFind: null,
    register: '',
    registerIsLinewise: false,
  }
}
