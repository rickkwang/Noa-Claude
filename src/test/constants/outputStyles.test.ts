import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  OUTPUT_STYLE_CONFIG,
} from '../../constants/outputStyles.js'

describe('Proactive output style', () => {
  const proactive = OUTPUT_STYLE_CONFIG.Proactive

  test('is registered as a built-in style', () => {
    expect(proactive).toBeTruthy()
    expect(proactive?.source).toBe('built-in')
    expect(proactive?.name).toBe('Proactive')
    expect(proactive?.keepCodingInstructions).toBe(true)
  })

  // The two safety rails are what keep "execute immediately" from reading as a
  // license to delete data or leak secrets. Autonomy wording may be rephrased;
  // these two must survive.
  test('prompt keeps the destructive-action and exfiltration rails', () => {
    expect(proactive!.prompt).toContain(
      '5. **Do not take overly destructive actions**',
    )
    expect(proactive!.prompt).toContain('6. **Avoid data exfiltration**')
  })
})

describe('Concise output style', () => {
  const concise = OUTPUT_STYLE_CONFIG.Concise

  test('is registered as a built-in style', () => {
    expect(concise).toBeTruthy()
    expect(concise?.source).toBe('built-in')
    expect(concise?.name).toBe('Concise')
    expect(concise?.keepCodingInstructions).toBe(true)
  })

  test('prompt carries the style header and the six numbered rules', () => {
    expect(concise!.prompt).toContain('# Concise Style Active')
    for (const rule of [
      '1. **Lead with the result**',
      '2. **Cut narration, keep substance**',
      '3. **Short by default**',
      '4. **State things plainly**',
      '5. **Give full detail on request**',
      '6. **Never trade correctness for brevity**',
    ]) {
      expect(concise!.prompt).toContain(rule)
    }
  })
})

describe('the built-in style roster', () => {
  // Tripwire, not decoration: every built-in style name also has to appear in
  // FOREGROUND_529_RETRY_SOURCES (src/services/api/withRetry.ts) as
  // `repl_main_thread:outputStyle:<name>`, or sessions on that style silently
  // lose 529 retries. That module cannot be imported here (it calls feature(),
  // a build-time rewrite), so this pins the roster instead: if you add a style
  // and this fails, update the retry allowlist in the same change.
  test('is exactly default plus the four upstream styles', () => {
    expect(Object.keys(OUTPUT_STYLE_CONFIG)).toEqual([
      DEFAULT_OUTPUT_STYLE_NAME,
      'Proactive',
      'Concise',
      'Explanatory',
      'Learning',
    ])
  })
})
