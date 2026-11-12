import { getInitialSettings } from './settings/settings.js'

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

const intl = (d: Date, options: Intl.DateTimeFormatOptions): string =>
  d.toLocaleString('en-US', options)

// strftime subset: the common POSIX conversions plus the `-` no-padding flag
// (`%-d`). Unknown conversions are left as written.
function strftime(pattern: string, d: Date): string {
  const h = d.getHours()
  const h12 = h % 12 || 12
  const ampm = h < 12 ? 'AM' : 'PM'
  const day = d.getDate()
  const month = d.getMonth() + 1
  const dayOfYear =
    Math.round(
      (Date.UTC(d.getFullYear(), month - 1, day) -
        Date.UTC(d.getFullYear(), 0, 1)) /
        86_400_000,
    ) + 1
  const offset = -d.getTimezoneOffset()
  const zone = `${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`
  // [padded, unpadded]
  const fields: Record<string, [string, string]> = {
    H: [pad(h), String(h)],
    I: [pad(h12), String(h12)],
    k: [String(h).padStart(2, ' '), String(h)],
    l: [String(h12).padStart(2, ' '), String(h12)],
    M: [pad(d.getMinutes()), String(d.getMinutes())],
    S: [pad(d.getSeconds()), String(d.getSeconds())],
    Y: [String(d.getFullYear()), String(d.getFullYear())],
    y: [pad(d.getFullYear() % 100), String(d.getFullYear() % 100)],
    m: [pad(month), String(month)],
    d: [pad(day), String(day)],
    e: [String(day).padStart(2, ' '), String(day)],
    j: [pad(dayOfYear, 3), String(dayOfYear)],
  }
  const text: Record<string, string> = {
    p: ampm,
    P: ampm.toLowerCase(),
    a: intl(d, { weekday: 'short' }),
    A: intl(d, { weekday: 'long' }),
    b: intl(d, { month: 'short' }),
    h: intl(d, { month: 'short' }),
    B: intl(d, { month: 'long' }),
    Z:
      new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(d)
        .find(part => part.type === 'timeZoneName')?.value ?? '',
    z: zone,
    u: String(d.getDay() || 7),
    w: String(d.getDay()),
    s: String(Math.floor(d.getTime() / 1000)),
    F: `${d.getFullYear()}-${pad(month)}-${pad(day)}`,
    D: `${pad(month)}/${pad(day)}/${pad(d.getFullYear() % 100)}`,
    T: `${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    R: `${pad(h)}:${pad(d.getMinutes())}`,
    r: `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`,
    '%': '%',
  }
  return pattern.replace(/%(-?)(.)/g, (match, flag: string, c: string) => {
    const field = fields[c]
    if (field) return flag ? field[1] : field[0]
    return text[c] ?? match
  })
}

/**
 * Time of day under the `timeFormat` setting, or undefined for "auto"/unset/an
 * unrecognized value so callers keep their own default rendering.
 */
export function formatConfiguredClock(
  date: Date,
  format: string | undefined = getInitialSettings().timeFormat,
): string | undefined {
  if (!format) return undefined
  if (format.includes('%')) return strftime(format, date)
  if (format === '12-hour') return strftime('%I:%M %p', date)
  if (format === '24-hour') return strftime('%H:%M', date)
  if (format === '24-hour-utc') {
    const utc = new Date(date.getTime() + date.getTimezoneOffset() * 60_000)
    return `${strftime('%H:%M', utc)}Z`
  }
  return undefined
}

/**
 * Message timestamp text. Transcript mode shows the clock only; with
 * showMessageTimestamps on (`withDate`) it is the full local date and time with
 * seconds and zone. A strftime pattern is used as-is in both cases.
 */
export function formatMessageTime(
  date: Date,
  format: string | undefined,
  withDate: boolean,
): string {
  if (!withDate) {
    return (
      formatConfiguredClock(date, format) ??
      date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    )
  }
  if (format?.includes('%')) return strftime(format, date)
  if (format === '24-hour-utc') {
    const utc = new Date(date.getTime() + date.getTimezoneOffset() * 60_000)
    return `${strftime('%Y-%m-%d %H:%M:%S', utc)}Z`
  }
  const zone =
    new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(date)
      .find(p => p.type === 'timeZoneName')?.value ?? ''
  const clock = format === '24-hour' ? '%H:%M:%S' : '%I:%M:%S %p'
  return `${strftime(`%Y-%m-%d ${clock}`, date)} ${zone}`.trim()
}
