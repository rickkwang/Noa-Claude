/**
 * Tracing API kept for call-site compatibility. Noa ships no OpenTelemetry
 * exporter, so spans are inert placeholders and nothing is recorded.
 */

export type Span = Record<string, never>

export interface LLMRequestNewContext {
  systemPrompt?: string
  querySource?: string
  tools?: string
}

const NOOP_SPAN: Span = Object.freeze({})

export function isBetaTracingEnabled(): boolean {
  return false
}

export function startInteractionSpan(_userPrompt: string): Span {
  return NOOP_SPAN
}

export function endInteractionSpan(): void {}

export function startLLMRequestSpan(
  _model: string,
  _newContext?: LLMRequestNewContext,
  _messagesForAPI?: unknown[],
  _fastMode?: boolean,
): Span {
  return NOOP_SPAN
}

export function endLLMRequestSpan(
  _span?: Span,
  _metadata?: Record<string, unknown>,
): void {}

export function startToolSpan(
  _toolName: string,
  _toolAttributes?: Record<string, string | number | boolean>,
  _toolInput?: string,
): Span {
  return NOOP_SPAN
}

export function startToolBlockedOnUserSpan(): Span {
  return NOOP_SPAN
}

export function endToolBlockedOnUserSpan(
  _decision?: string,
  _source?: string,
): void {}

export function startToolExecutionSpan(): Span {
  return NOOP_SPAN
}

export function endToolExecutionSpan(_metadata?: {
  success?: boolean
  error?: string
}): void {}

export function endToolSpan(_toolResult?: string, _resultTokens?: number): void {}

export function addToolContentEvent(
  _eventName: string,
  _attributes: Record<string, string | number | boolean>,
): void {}

export function startHookSpan(
  _hookEvent: string,
  _hookName: string,
  _numHooks: number,
  _hookDefinitions: string,
): Span {
  return NOOP_SPAN
}

export function endHookSpan(
  _span: Span,
  _metadata?: Record<string, number | undefined>,
): void {}
