export function getOauthConfigFileSuffix(
  env: Record<string, string | undefined>,
  allowInternalOauth: boolean,
): '' | '-custom-oauth' | '-local-oauth' | '-staging-oauth'

export function getOauthGlobalConfigFilename(
  env: Record<string, string | undefined>,
  allowInternalOauth: boolean,
): string
