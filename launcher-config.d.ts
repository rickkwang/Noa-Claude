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

export function getResolvedLauncherConfig(): {
  apiBaseUrl: string
  apiKey: string | undefined
  authToken: string | undefined
  model: string
  settings: unknown
  settingsEnv: Record<string, unknown>
}

export function validateLauncherConfiguration(
  argv?: string[],
): void

export function applyLauncherDefaults(): void

export function getLauncherEnvBootstrapCode(): string

export function getLauncherBootstrapCode(): string
