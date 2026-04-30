import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { shouldSkipInheritedHomeTrust } from '../../utils/config.js'

describe('home directory trust inheritance', () => {
  test('does not inherit persisted home trust into child directories', () => {
    const home = homedir()

    expect(shouldSkipInheritedHomeTrust(home, join(home, 'Desktop'))).toBe(true)
  })

  test('allows persisted home trust for the home directory itself', () => {
    const home = homedir()

    expect(shouldSkipInheritedHomeTrust(home, home)).toBe(false)
  })
})
