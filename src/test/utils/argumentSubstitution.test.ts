import { describe, expect, test } from 'bun:test'
import { substituteArguments } from '../../utils/argumentSubstitution.js'

describe('argument substitution', () => {
  test('replaces positional, indexed, and full arguments', () => {
    expect(substituteArguments('$0 and $1', 'hello world')).toBe(
      'hello and world',
    )
    expect(substituteArguments('[$ARGUMENTS[1]]', 'hello world')).toBe(
      '[world]',
    )
    expect(substituteArguments('echo $ARGUMENTS', 'hello world')).toBe(
      'echo hello world',
    )
  })

  test('replaces named arguments by position', () => {
    expect(
      substituteArguments('$greeting, $name!', 'hi there', true, [
        'greeting',
        'name',
      ]),
    ).toBe('hi, there!')
  })

  test('appends arguments when no placeholder is present', () => {
    expect(substituteArguments('body', 'hello')).toBe(
      'body\n\nARGUMENTS: hello',
    )
    expect(substituteArguments('body', 'hello', false)).toBe('body')
    expect(substituteArguments('body', '')).toBe('body')
  })

  test('an inserted value is not re-read as a placeholder', () => {
    // The value of $a is "$b", which must stay literal instead of being
    // expanded by the later $b pass.
    expect(substituteArguments('a=$a', '$b z', true, ['a', 'b'])).toBe(
      'a=$b',
    )
    expect(substituteArguments('a=$a', '$ARGUMENTS z', true, ['a'])).toBe(
      'a=$ARGUMENTS',
    )
  })

  test('dollar replacement patterns in values stay literal', () => {
    // "$&" in a replacement string normally expands to the matched text.
    expect(substituteArguments('v=$v', "'x$&y'", true, ['v'])).toBe(
      'v=x$&y',
    )
    expect(substituteArguments('v=$v', "'$$'", true, ['v'])).toBe('v=$$')
  })

  test('sentinel characters in values are neutralized', () => {
    expect(
      substituteArguments('v=$v', "'x\uFFFFy\uFFFEz'", true, ['v']),
    ).toBe('v=x\uFFFDy\uFFFDz')
  })
})
