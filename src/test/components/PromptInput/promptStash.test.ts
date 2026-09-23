import { describe, expect, test } from 'bun:test'
import {
  getStashAction,
  type StashedPrompt,
} from '../../../components/PromptInput/promptStash.js'

function prompt(overrides: Partial<StashedPrompt> = {}): StashedPrompt {
  return {
    text: '',
    cursorOffset: 0,
    pastedContents: {},
    mode: 'prompt',
    ...overrides,
  }
}

describe('getStashAction', () => {
  test('pushing a shell-mode prompt keeps its mode in the stash', () => {
    const current = prompt({ text: 'ls -la', cursorOffset: 6, mode: 'bash' })
    expect(getStashAction(current, undefined)).toEqual({
      type: 'push',
      stash: current,
    })
  })

  test('popping restores the stashed shell mode', () => {
    const stashed = prompt({ text: 'ls -la', cursorOffset: 3, mode: 'bash' })
    expect(getStashAction(prompt(), stashed)).toEqual({
      type: 'pop',
      stash: stashed,
    })
  })

  test('popping a prompt-mode stash from an empty shell-mode input', () => {
    const stashed = prompt({ text: 'hello' })
    const action = getStashAction(prompt({ mode: 'bash' }), stashed)
    expect(action).toEqual({ type: 'pop', stash: stashed })
  })

  test('whitespace-only input with no stash is a no-op', () => {
    expect(getStashAction(prompt({ text: '  ' }), undefined)).toEqual({
      type: 'none',
    })
  })

  test('non-empty input replaces an existing stash', () => {
    const current = prompt({ text: 'new' })
    expect(getStashAction(current, prompt({ text: 'old' }))).toEqual({
      type: 'push',
      stash: current,
    })
  })
})
