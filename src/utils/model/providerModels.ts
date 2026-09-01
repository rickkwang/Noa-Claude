/**
 * The model catalogue of the active provider profile, carried through the
 * environment like the rest of the profile's routing (see buildProviderEnv).
 *
 * A third-party endpoint serves its own models, so pinning the profile's single
 * `model` to ANTHROPIC_MODEL and the Claude tier aliases is what makes the
 * session work at all — but it also means the picker has one id to offer under
 * four Claude-shaped labels. This list is what /model offers instead.
 */
export const PROVIDER_MODELS_ENV_KEY = 'NOA_CLAUDE_PROVIDER_MODELS'

/**
 * Real context window per model, as `id=tokens` pairs.
 *
 * Nothing else can know these: a third-party id matches no entry in the
 * capability table and carries no `[1m]`, so it resolves to the 200k default no
 * matter how much the endpoint actually serves. The `[1m]` suffix is the only
 * existing lever and it is all-or-nothing at 1M, which is wrong for an endpoint
 * serving several models with different windows.
 */
export const PROVIDER_CONTEXT_WINDOWS_ENV_KEY =
  'NOA_CLAUDE_PROVIDER_CONTEXT_WINDOWS'

/**
 * The exact effort levels the endpoint accepts, as `id=low:high:max` entries.
 *
 * The ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES vars can't express this:
 * they key on the four pinned tier ids, which buildProviderEnv has set to the
 * profile's single default model, so nothing else the endpoint serves can ever
 * match one. Their `effort`/`xhigh_effort`/`max_effort` flags also only say
 * low+medium+high plus optional extras on top, so an endpoint offering
 * low/high/max — no medium — is unrepresentable by them. Kimi K3 is exactly
 * that shape.
 *
 * Per model, not per endpoint: one endpoint serves models that differ here.
 * Kimi's coding endpoint serves K3, which takes reasoning_effort, alongside
 * kimi-for-coding, whose thinking is always on and takes no level at all.
 */
export const PROVIDER_EFFORT_LEVELS_ENV_KEY =
  'NOA_CLAUDE_PROVIDER_EFFORT_LEVELS'

/**
 * Output-token limits per model, as `id=default:upperLimit` pairs.
 *
 * Same blind spot as the context window: getModelMaxOutputTokens matches on
 * canonical Claude names, so a third-party id falls through to the 32k/64k
 * fallback however much the endpoint allows.
 */
export const PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY =
  'NOA_CLAUDE_PROVIDER_MAX_OUTPUT_TOKENS'

/**
 * Every env key carrying the active profile's catalogue. Listed once so the
 * apply/reset paths in providerProfile.ts can't drift from the writers here.
 */
export const PROVIDER_CATALOGUE_ENV_KEYS = [
  PROVIDER_MODELS_ENV_KEY,
  PROVIDER_CONTEXT_WINDOWS_ENV_KEY,
  PROVIDER_EFFORT_LEVELS_ENV_KEY,
  PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY,
] as const

export type MaxOutputTokens = { default: number; upperLimit: number }

/**
 * `[1m]` selects a model's 1M-context variant, not a different model, and the
 * declarations here are per model — so it has to come off before any lookup, as
 * modelSupportOverrides.ts does for the same reason. Case is normalized with it
 * because a model id reaches these lookups both raw and lowercased.
 */
function normalizeModelId(model: string): string {
  return model.replace(/\[1m\]/gi, '').trim().toLowerCase()
}

function normalizeList(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    // `,` is the record separator, so an entry carrying one is unrepresentable.
    const trimmed = value.trim()
    if (!trimmed || trimmed.includes(',') || seen.has(trimmed)) continue
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

export function serializeProviderList(
  values: readonly string[] | undefined,
): string | undefined {
  if (!values?.length) return undefined
  const normalized = normalizeList(values)
  return normalized.length > 0 ? normalized.join(',') : undefined
}

function readList(key: string): string[] {
  const raw = process.env[key]?.trim()
  if (!raw) return []
  return normalizeList(raw.split(','))
}

/**
 * The raw value declared for `model` in a `key=value` record env var, or
 * undefined when the model isn't listed. Shared so the id normalization above
 * can't drift between the two records that use it.
 */
function readRecordValue(envKey: string, model: string): string | undefined {
  const raw = process.env[envKey]?.trim()
  if (!raw) return undefined

  const wanted = normalizeModelId(model)
  for (const pair of raw.split(',')) {
    const separator = pair.indexOf('=')
    if (separator === -1) continue
    // Keys are percent-encoded at write time so ids carrying the `,`/`=`/`:`
    // separators (Ollama-style `qwen2.5:7b`) survive. Decoding an unencoded
    // hand-written key is a no-op, so both forms read back; a lone `%` in a
    // hand-written key makes decodeURIComponent throw — fall back to raw.
    const rawKey = pair.slice(0, separator)
    let key = rawKey
    try {
      key = decodeURIComponent(rawKey)
    } catch {
      // hand-written key with a literal `%` — compare undecoded
    }
    if (normalizeModelId(key) !== wanted) continue
    return pair.slice(separator + 1).trim()
  }
  return undefined
}

function isPositiveInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

export function getActiveProviderModelNames(): string[] {
  return readList(PROVIDER_MODELS_ENV_KEY)
}

/**
 * Shared skeleton for the three `key=value` record serializers. `encodeValue`
 * returns the encoded value, or undefined to drop the entry. An empty string
 * is kept on purpose: `id=` declares the model present with nothing set, which
 * is not the same as being unlisted (that defers to the caller's own
 * resolution). Only effort levels use that today.
 */
function serializeProviderRecord<T>(
  record: Readonly<Record<string, T>> | undefined,
  encodeValue: (value: T) => string | undefined,
): string | undefined {
  if (!record) return undefined
  const pairs: string[] = []
  for (const [model, value] of Object.entries(record)) {
    const id = model.trim()
    if (!id) continue
    const encoded = encodeValue(value)
    if (encoded === undefined) continue
    // Percent-encode the key: `=`/`,`/`:` are pair/record/value separators,
    // and ids like `qwen2.5:7b` would otherwise be unrepresentable.
    pairs.push(`${encodeURIComponent(id)}=${encoded}`)
  }
  return pairs.length > 0 ? pairs.join(',') : undefined
}

export function serializeProviderEffortLevels(
  levels: Readonly<Record<string, readonly string[]>> | undefined,
): string | undefined {
  return serializeProviderRecord(levels, values =>
    Array.isArray(values)
      ? normalizeList(values.filter(value => !value.includes(':'))).join(':')
      : undefined,
  )
}

/**
 * The effort levels the active provider profile declares for `model`, or
 * undefined if it declares none — in which case the caller's own resolution
 * applies.
 */
export function getActiveProviderEffortLevels(
  model: string,
): string[] | undefined {
  const raw = readRecordValue(PROVIDER_EFFORT_LEVELS_ENV_KEY, model)
  if (raw === undefined) return undefined
  return normalizeList(raw.split(':'))
}

export function serializeProviderContextWindows(
  windows: Readonly<Record<string, number>> | undefined,
): string | undefined {
  // A non-positive or fractional window would be read back as garbage by the
  // consumer.
  return serializeProviderRecord(windows, tokens =>
    isPositiveInt(tokens) ? String(tokens) : undefined,
  )
}

/**
 * The window the active provider profile declares for `model`, or undefined if
 * it declares none — in which case the caller's own resolution applies.
 */
export function getActiveProviderContextWindow(
  model: string,
): number | undefined {
  const raw = readRecordValue(PROVIDER_CONTEXT_WINDOWS_ENV_KEY, model)
  if (raw === undefined) return undefined

  const tokens = Number.parseInt(raw, 10)
  return isPositiveInt(tokens) ? tokens : undefined
}

export function serializeProviderMaxOutputTokens(
  limits: Readonly<Record<string, MaxOutputTokens>> | undefined,
): string | undefined {
  return serializeProviderRecord(limits, limit => {
    if (!isPositiveInt(limit?.default) || !isPositiveInt(limit?.upperLimit)) {
      return undefined
    }
    // A default above the ceiling would be sent as max_tokens and rejected.
    if (limit.default > limit.upperLimit) return undefined
    return `${limit.default}:${limit.upperLimit}`
  })
}

/**
 * The output-token limits the active provider profile declares for `model`, or
 * undefined if it declares none.
 */
export function getActiveProviderMaxOutputTokens(
  model: string,
): MaxOutputTokens | undefined {
  const raw = readRecordValue(PROVIDER_MAX_OUTPUT_TOKENS_ENV_KEY, model)
  if (raw === undefined) return undefined

  const [rawDefault, rawUpper] = raw.split(':')
  const defaultTokens = Number.parseInt(rawDefault?.trim() ?? '', 10)
  const upperLimit = Number.parseInt(rawUpper?.trim() ?? '', 10)
  if (!isPositiveInt(defaultTokens) || !isPositiveInt(upperLimit)) {
    return undefined
  }
  return { default: Math.min(defaultTokens, upperLimit), upperLimit }
}
