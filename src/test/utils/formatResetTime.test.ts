import { describe, expect, test } from 'bun:test'
import { formatResetText, formatResetTime } from '../../utils/format.js'

// alwaysShowDate exists so weekly rate limits never render a bare clock time:
// "Resets 9pm" is ambiguous when the reset is three days out, but the >24h
// branch alone doesn't cover a weekly limit that happens to land tomorrow
// morning. These pin that the flag only ever ADDS a date.
describe('formatResetTime alwaysShowDate', () => {
  const nowSeconds = (): number => Math.floor(Date.now() / 1000)
  const hasDate = (s: string | undefined): boolean =>
    /[A-Z][a-z]{2} \d+/.test(s ?? '')

  test('within 24h: omits the date by default', () => {
    const out = formatResetTime(nowSeconds() + 3 * 3600, false, true, false)
    expect(hasDate(out)).toBe(false)
  })

  test('within 24h: includes the date when alwaysShowDate is set', () => {
    const out = formatResetTime(nowSeconds() + 3 * 3600, false, true, true)
    expect(hasDate(out)).toBe(true)
  })

  test('beyond 24h: includes the date regardless of the flag', () => {
    const off = formatResetTime(nowSeconds() + 3 * 86400, false, true, false)
    const on = formatResetTime(nowSeconds() + 3 * 86400, false, true, true)
    expect(hasDate(off)).toBe(true)
    expect(on).toBe(off)
  })

  test('defaults to the pre-existing behavior when the arg is omitted', () => {
    const soon = nowSeconds() + 3 * 3600
    expect(formatResetTime(soon, false, true)).toBe(
      formatResetTime(soon, false, true, false),
    )
  })

  test('undefined timestamp stays undefined', () => {
    expect(formatResetTime(undefined, false, true, true)).toBeUndefined()
  })

  test('formatResetText forwards the flag', () => {
    const iso = new Date(Date.now() + 3 * 3600 * 1000).toISOString()
    expect(hasDate(formatResetText(iso, false, true, false))).toBe(false)
    expect(hasDate(formatResetText(iso, false, true, true))).toBe(true)
  })
})
