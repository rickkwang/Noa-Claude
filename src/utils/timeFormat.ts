import { getInitialSettings } from './settings/settings.js'

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function strftime(pattern: string, d: Date): string {
  const h12 = d.getHours() % 12 || 12
  const fields: Record<string, string> = {
    H: pad(d.getHours()),
    I: pad(h12),
    M: pad(d.getMinutes()),
    S: pad(d.getSeconds()),
    p: d.getHours() < 12 ? 'AM' : 'PM',
    Y: String(d.getFullYear()),
    y: pad(d.getFullYear() % 100),
    m: pad(d.getMonth() + 1),
    d: pad(d.getDate()),
    e: String(d.getDate()).padStart(2, ' '),
    b: d.toLocaleString('en-US', { month: 'short' }),
    a: d.toLocaleString('en-US', { weekday: 'short' }),
    '%': '%',
  }
  return pattern.replace(/%(.)/g, (m, c) => fields[c] ?? m)
}

/**
 * Time of day under the `timeFormat` setting, or undefined for "auto"/unset/an
 * unrecognized value so callers keep their own default rendering.
 */
export function formatConfiguredClock(date: Date): string | undefined {
  const format = getInitialSettings().timeFormat
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
