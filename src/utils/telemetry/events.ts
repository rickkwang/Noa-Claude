/**
 * Event API kept for call-site compatibility. Noa ships no OpenTelemetry
 * exporter, so events are dropped.
 */

export function redactIfDisabled(_content: string): string {
  return '<REDACTED>'
}

export async function logOTelEvent(
  _eventName: string,
  _metadata: { [key: string]: string | undefined } = {},
): Promise<void> {}
