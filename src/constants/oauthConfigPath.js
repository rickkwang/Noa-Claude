function isTruthyEnvValue(value) {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase().trim());
}

export function getOauthConfigFileSuffix(env, allowInternalOauth) {
  if (env.CLAUDE_CODE_CUSTOM_OAUTH_URL) return '-custom-oauth';
  if (allowInternalOauth) {
    if (isTruthyEnvValue(env.USE_LOCAL_OAUTH)) return '-local-oauth';
    if (isTruthyEnvValue(env.USE_STAGING_OAUTH)) return '-staging-oauth';
  }
  return '';
}

export function getOauthGlobalConfigFilename(env, allowInternalOauth) {
  return `.config${getOauthConfigFileSuffix(env, allowInternalOauth)}.json`;
}
