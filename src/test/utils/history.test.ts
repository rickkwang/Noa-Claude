import { describe, expect, test } from 'bun:test'
import { removeImageRefsFromDisplay } from '../../history.js'

describe('history image reference cleanup', () => {
  test('removes legacy image refs while preserving pasted text refs', () => {
    const removedImageIds = new Set([2, 4])

    expect(
      removeImageRefsFromDisplay(
        'check [Image #2] and [Pasted text #3 +2 lines] plus [Image #4].',
        removedImageIds,
      ),
    ).toBe('check and [Pasted text #3 +2 lines] plus')
  })

  test('leaves non-removed image refs unchanged', () => {
    expect(
      removeImageRefsFromDisplay('keep [Image #1], drop [Image #2]', new Set([2])),
    ).toBe('keep [Image #1], drop')
  })
})
