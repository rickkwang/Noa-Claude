export const PRODUCT_NAMESPACE: string
export const PRODUCT_NAME: string
export const PRODUCT_DIR_BASENAME: string
export const DEFAULT_PRODUCT_DIR: string
export const DEFAULT_CONFIG_DIR: string
export const DEFAULT_CACHE_DIR: string
export const PRODUCT_SETTINGS_PATH: string
export const DEFAULT_MINIMAX_CN_BASE_URL: string
export const DEFAULT_PRODUCT_MODEL: string
export const LAUNCHER_MACRO: {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string
}

export function getResolvedLauncherConfig(options?: {
  skipGlobalConfig?: boolean
}): {
  apiBaseUrl: string | undefined
  apiKey: string | undefined
  authToken: string | undefined
  model: string | undefined
  settings: unknown
  settingsEnv: Record<string, unknown>
  launcherProvider: 'anthropic' | 'product-default'
}

export function validateLauncherConfiguration(
  argv?: string[],
  resolved?: ReturnType<typeof getResolvedLauncherConfig>,
): void

export function applyLauncherDefaults(options?: {
  skipGlobalConfig?: boolean
}): ReturnType<typeof getResolvedLauncherConfig>

export function getLauncherEnvBootstrapCode(): string

export function getLauncherBootstrapCode(): string
