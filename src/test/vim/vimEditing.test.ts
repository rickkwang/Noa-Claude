import { describe, expect, test } from 'bun:test'
import { Cursor } from '../../utils/Cursor.js'
import { resolveMotion } from '../../vim/motions.js'
import type { OperatorContext } from '../../vim/operators.js'
import { replayRecordedChange } from '../../vim/replay.js'
import { type TransitionContext, transition } from '../../vim/transitions.js'
import type {
  CommandState,
  InsertEntry,
  RecordedChange,
} from '../../vim/types.js'

const ESC = '\x1b'

/**
 * A minimal NORMAL/INSERT editor over the real state machine, operators and
 * `.` replay — the parts useVimInput wires together, minus React.
 */
class Editor {
  mode: 'NORMAL' | 'INSERT' = 'NORMAL'
  command: CommandState = { type: 'idle' }
  register = ''
  lastChange: RecordedChange | null = null
  inserted = ''
  changeToExtend: RecordedChange | undefined
  insertEntry: InsertEntry | undefined

  constructor(
    public text: string,
    public offset = 0,
  ) {}

  private ctx(): TransitionContext {
    const cursor = Cursor.fromText(this.text, 80, this.offset)
    const base: OperatorContext = {
      cursor,
      text: this.text,
      setText: t => {
        this.text = t
      },
      setOffset: o => {
        this.offset = o
      },
      enterInsert: (o, entry) => {
        this.offset = o
        this.mode = 'INSERT'
        this.inserted = ''
        this.changeToExtend = undefined
        this.insertEntry = entry
      },
      getRegister: () => this.register,
      setRegister: content => {
        this.register = content
      },
      getLastFind: () => null,
      setLastFind: () => {},
      recordChange: change => {
        this.lastChange = change
        if (this.mode === 'INSERT') this.changeToExtend = change
      },
    }
    return {
      ...base,
      onDotRepeat: () => {
        if (!this.lastChange) return
        const r = replayRecordedChange(this.lastChange, {
          ...base,
          recordChange: () => {},
        })
        this.text = r.text
        this.offset = r.offset
      },
    }
  }

  private commitInsert(): void {
    this.lastChange = this.changeToExtend
      ? ({
          ...this.changeToExtend,
          insertText: this.inserted,
        } as RecordedChange)
      : this.inserted
        ? { type: 'insert', text: this.inserted, entry: this.insertEntry }
        : this.lastChange
  }

  keys(seq: string): this {
    for (const ch of seq) {
      if (this.mode === 'INSERT') {
        if (ch === ESC) {
          this.commitInsert()
          this.mode = 'NORMAL'
          this.command = { type: 'idle' }
          if (this.offset > 0 && this.text[this.offset - 1] !== '\n') {
            this.offset -= 1
          }
          continue
        }
        this.text =
          this.text.slice(0, this.offset) + ch + this.text.slice(this.offset)
        this.offset += ch.length
        this.inserted += ch
        continue
      }
      const result = transition(this.command, ch, this.ctx())
      result.execute?.()
      if (this.mode === 'NORMAL') {
        this.command = result.next ?? { type: 'idle' }
      }
    }
    return this
  }
}

const LINES = 'one\ntwo\nthree\nfour'

describe('linewise operators', () => {
  test('dj deletes the current and next line from mid-line', () => {
    const e = new Editor(LINES, 5).keys('dj')
    expect(e.text).toBe('one\nfour')
  })

  test('dk deletes the current and previous line from mid-line', () => {
    const e = new Editor(LINES, 9).keys('dk')
    expect(e.text).toBe('one\nfour')
  })

  test('dj on the last line does nothing', () => {
    expect(new Editor(LINES, 16).keys('dj').text).toBe(LINES)
  })

  test('dG deletes to the end, and on the last line deletes that line', () => {
    expect(new Editor(LINES, 5).keys('dG').text).toBe('one')
    expect(new Editor(LINES, 14).keys('dG').text).toBe('one\ntwo\nthree')
  })

  test('dgg deletes to the start, and on the first line deletes that line', () => {
    expect(new Editor(LINES, 9).keys('dgg').text).toBe('four')
    expect(new Editor(LINES, 0).keys('dgg').text).toBe('two\nthree\nfour')
  })

  test('yj yanks whole lines and leaves the cursor where it was', () => {
    const e = new Editor(LINES, 5).keys('yj')
    expect(e.register).toBe('two\nthree\n')
    expect(e.text).toBe(LINES)
    expect(e.offset).toBe(5)
  })

  test('dj works from the first line when it is empty', () => {
    expect(new Editor('\ntwo\nthree', 0).keys('dj').text).toBe('three')
  })

  test('cj replaces the lines with one empty line in insert mode', () => {
    const e = new Editor(LINES, 5).keys('cj')
    expect(e.text).toBe('one\n\nfour')
    expect(e.mode).toBe('INSERT')
    expect(e.offset).toBe(4)
  })
})

describe('counts on G', () => {
  test('1G goes to line 1, G to the last line', () => {
    expect(new Editor(LINES, 16).keys('1G').offset).toBe(0)
    expect(new Editor(LINES, 0).keys('G').offset).toBe(14)
    expect(new Editor(LINES, 0).keys('2G').offset).toBe(4)
  })

  test('d1G deletes up to line 1, not to the end', () => {
    expect(new Editor(LINES, 9).keys('d1G').text).toBe('four')
  })
})

describe('operators with 0', () => {
  test('d0 deletes to the start of the line', () => {
    const e = new Editor('hello world', 6).keys('d0')
    expect(e.text).toBe('world')
    expect(e.offset).toBe(0)
  })

  test('c0 changes to the start of the line', () => {
    const e = new Editor('hello world', 6).keys('c0')
    expect(e.text).toBe('world')
    expect(e.mode).toBe('INSERT')
  })

  test('y0 yanks to the start of the line', () => {
    const e = new Editor('hello world', 6).keys('y0')
    expect(e.register).toBe('hello ')
    expect(e.text).toBe('hello world')
  })

  test('c0 in column 0 still enters insert mode', () => {
    const e = new Editor('hello', 0).keys('c0')
    expect(e.mode).toBe('INSERT')
    expect(e.text).toBe('hello')
  })

  test('d10j still reads 0 as part of a count', () => {
    const text = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n')
    expect(new Editor(text, 0).keys('d10j').text).toBe('l11')
  })
})

describe('cw', () => {
  test('changes to the end of the word under the cursor', () => {
    expect(new Editor('foo bar', 0).keys('cw').text).toBe(' bar')
  })

  test('on the last character of a word changes just that character', () => {
    const e = new Editor('foo bar', 2).keys('cw')
    expect(e.text).toBe('fo bar')
    expect(e.offset).toBe(2)
  })

  test('on a one-letter word changes just that letter', () => {
    expect(new Editor('a bc', 0).keys('cw').text).toBe(' bc')
  })

  test('on blanks changes the blanks up to the next word', () => {
    expect(new Editor('foo   bar', 3).keys('cw').text).toBe('foobar')
  })

  test('on an empty line changes nothing', () => {
    const e = new Editor('foo\n\nbar', 4).keys('cw')
    expect(e.text).toBe('foo\n\nbar')
    expect(e.mode).toBe('INSERT')
  })

  test('c2w changes through the end of the second word', () => {
    expect(new Editor('a bb ccc', 0).keys('c2w').text).toBe(' ccc')
  })
})

describe('dw at the end of a line', () => {
  test('stops at the line break instead of joining lines', () => {
    expect(new Editor('foo\nbar', 0).keys('dw').text).toBe('\nbar')
  })

  test('on an empty line deletes that line', () => {
    expect(new Editor('foo\n\nbar', 4).keys('dw').text).toBe('foo\nbar')
  })
})

describe('word motions in Indic scripts', () => {
  const cursorAt = (text: string, offset = 0) =>
    Cursor.fromText(text, 80, offset)

  test('Hindi words are one word each', () => {
    const text = 'नमस्ते दुनिया'
    expect(resolveMotion('w', cursorAt(text), 1).offset).toBe(
      text.indexOf('दुनिया'),
    )
    // e lands on the word's last grapheme ("स्ते" is one cluster).
    const graphemes = [
      ...new Intl.Segmenter().segment(text.slice(0, text.indexOf(' '))),
    ]
    expect(resolveMotion('e', cursorAt(text), 1).offset).toBe(
      graphemes.at(-1)!.index,
    )
  })

  test('Bengali words are one word each', () => {
    const text = 'আমার সোনার বাংলা'
    expect(resolveMotion('w', cursorAt(text), 2).offset).toBe(
      text.indexOf('বাংলা'),
    )
    expect(
      resolveMotion('b', cursorAt(text, text.length - 1), 1).offset,
    ).toBe(text.indexOf('বাংলা'))
  })

  test('dw deletes a whole Hindi word', () => {
    expect(new Editor('नमस्ते दुनिया', 0).keys('dw').text).toBe('दुनिया')
  })
})

describe('. repeat', () => {
  test('repeats cw together with the text typed after it', () => {
    const e = new Editor('foo bar baz', 0).keys(`cwX${ESC}w.`)
    expect(e.text).toBe('X X baz')
  })

  test('repeats dd', () => {
    expect(new Editor(LINES, 0).keys('dd.').text).toBe('three\nfour')
  })

  test('repeats o together with the text typed after it', () => {
    expect(new Editor('a', 0).keys(`ob${ESC}.`).text).toBe('a\nb\nb')
  })

  test('repeats p', () => {
    expect(new Editor('ab', 0).keys('ylp.').text).toBe('aaab')
  })

  test('repeats dG', () => {
    expect(new Editor(LINES, 9).keys('dGk.').text).toBe('')
  })

  test('a yank does not replace the change . repeats', () => {
    expect(new Editor('abcdef', 0).keys('xyw.').text).toBe('cdef')
  })
})

describe('review follow-ups', () => {
  test('d$ / D / C / y$ stop at the line break instead of joining lines', () => {
    expect(new Editor('ab\ncd', 0).keys('d$').text).toBe('\ncd')
    expect(new Editor('ab\ncd', 1).keys('D').text).toBe('a\ncd')
    const c = new Editor('ab\ncd', 0).keys('C')
    expect(c.text).toBe('\ncd')
    expect(c.mode).toBe('INSERT')
    expect(new Editor('ab\ncd', 0).keys('y$').register).toBe('ab')
    expect(new Editor('ab', 0).keys('d$').text).toBe('')
  })

  test('dd lands on the first non-blank of the next line', () => {
    const e = new Editor('aaa\nxxx\n  cc', 4).keys('dd')
    expect(e.text).toBe('aaa\n  cc')
    expect(e.offset).toBe(6)
  })

  test('dd on the last line lands on the first non-blank of the new last line', () => {
    const e = new Editor('  aa\nbb', 5).keys('dd')
    expect(e.text).toBe('  aa')
    expect(e.offset).toBe(2)
  })

  test('d2d / c2c / y2y act on that many lines, like 2dd', () => {
    expect(new Editor(LINES, 0).keys('d2d').text).toBe('three\nfour')
    expect(new Editor(LINES, 0).keys('y2y').register).toBe('one\ntwo\n')
    const c = new Editor(LINES, 0).keys('c2c')
    expect(c.text).toBe('\nthree\nfour')
    expect(c.mode).toBe('INSERT')
  })

  test('. after A appends at the end of the line, after a after the cursor', () => {
    expect(new Editor('hello\nworld', 0).keys(`A!${ESC}j0.`).text).toBe(
      'hello!\nworld!',
    )
    expect(new Editor('ab\ncd', 0).keys(`ax${ESC}j0.`).text).toBe('axb\ncxd')
    expect(new Editor('  ab\n  cd', 3).keys(`I-${ESC}j$.`).text).toBe(
      '  -ab\n  -cd',
    )
  })
})
