export function readTrimmedOverride(
  key: keyof NodeJS.ProcessEnv,
): string | undefined {
  return process.env[key]?.trim();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some(needle => haystack.includes(needle));
}

export function resolveMaxTokensParam(
  baseURL: string,
): 'max_tokens' | 'max_completion_tokens' {
  const override = readTrimmedOverride('OPENAI_MAX_TOKENS_PARAM');
  if (override === 'max_tokens' || override === 'max_completion_tokens') {
    return override;
  }

  const normalizedBaseUrl = baseURL.toLowerCase();
  // Azure OpenAI chat completions endpoint expects max_completion_tokens.
  if (
    normalizedBaseUrl.includes('.openai.azure.com') &&
    normalizedBaseUrl.includes('/openai/deployments/')
  ) {
    return 'max_completion_tokens';
  }

  return 'max_tokens';
}

export function classifyOpenAICompatibleError(
  status: number,
  body: string,
): string {
  const lowered = body.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    includesAny(lowered, ['unauthorized', 'invalid api key', 'authentication'])
  ) {
    return `OpenAI-compatible auth error (${status}). Check API key/token and provider-specific auth headers.`;
  }
  if (
    status === 404 ||
    status === 405 ||
    includesAny(lowered, ['not found', 'no route', 'unknown path'])
  ) {
    return `OpenAI-compatible endpoint mismatch (${status}). Verify OPENAI_BASE_URL path compatibility (for example /v1/chat/completions vs provider-specific route).`;
  }
  if (status === 429 || lowered.includes('rate limit')) {
    return `OpenAI-compatible rate limit (${status}).`;
  }
  return `OpenAI-compatible request failed (${status}).`;
}
