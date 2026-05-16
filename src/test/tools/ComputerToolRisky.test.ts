import { describe, expect, test } from 'bun:test'
import { appleScriptLooksRisky } from '../../tools/ComputerTool/ComputerTool.js'

describe('appleScriptLooksRisky — open location URL handling', () => {
  test('static http(s) URL passes through', () => {
    expect(appleScriptLooksRisky('open location "https://example.com"')).toBe(false)
    expect(appleScriptLooksRisky('open location "http://example.com"')).toBe(false)
    expect(
      appleScriptLooksRisky(
        'tell application "Safari" to open location "https://example.com"',
      ),
    ).toBe(false)
  })

  test('non-http schemes stay risky', () => {
    expect(appleScriptLooksRisky('open location "file:///etc/passwd"')).toBe(true)
    expect(
      appleScriptLooksRisky('open location "x-apple-systempreferences:com.apple.preferences.AppleAccount"'),
    ).toBe(true)
    expect(appleScriptLooksRisky('open location "slack://channel?id=ABC"')).toBe(true)
    expect(appleScriptLooksRisky('open location "javascript:alert(1)"')).toBe(true)
    expect(appleScriptLooksRisky('open location "mailto:a@b.com"')).toBe(true)
  })

  test('non-literal URL stays risky (variable or concatenation)', () => {
    expect(appleScriptLooksRisky('open location myURL')).toBe(true)
    expect(appleScriptLooksRisky('open location ("https://" & host)')).toBe(true)
  })

  test('mixed batch: any single non-http URL trips the gate', () => {
    expect(
      appleScriptLooksRisky(
        'open location "https://a.com"\nopen location "file:///tmp/x"',
      ),
    ).toBe(true)
  })

  test('case-insensitive scheme match', () => {
    expect(appleScriptLooksRisky('open location "HTTPS://example.com"')).toBe(false)
    expect(appleScriptLooksRisky('OPEN LOCATION "https://example.com"')).toBe(false)
  })

  test('comments do not false-positive the gate', () => {
    expect(
      appleScriptLooksRisky(
        '-- TODO: also support file:// later\nopen location "https://example.com"',
      ),
    ).toBe(false)
    expect(
      appleScriptLooksRisky(
        '(* slack:// deep links not supported *)\nopen location "https://example.com"',
      ),
    ).toBe(false)
  })
})
