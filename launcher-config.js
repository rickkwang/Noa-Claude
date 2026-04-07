import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, readFileSync } from 'fs';

export const DIAGNOSTIC_ERROR_CODES = {
  CONFIG_ERROR: 'CONFIG_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  MCP_TIMEOUT: 'MCP_TIMEOUT',
  MCP_CONNECT_ERROR: 'MCP_CONNECT_ERROR',
  SANDBOX_UNAVAILABLE: 'SANDBOX_UNAVAILABLE',
  RUNTIME_COMPAT_ERROR: 'RUNTIME_COMPAT_ERROR',
};

export function formatDiagnosticError(code, message) {
  return `[${code}] ${message}`;
}

export const PRODUCT_NAMESPACE =
  process.env.CLAUDE_CODE_PRODUCT_NAMESPACE ?? 'claude-agent';

export const PRODUCT_NAME =
  process.env.CLAUDE_CODE_PRODUCT_NAME ?? 'Claude Agent';

export const DEFAULT_PRODUCT_DIR =
  process.env.CLAUDE_CODE_PRODUCT_DIR ?? join(homedir(), '.claude-agent');

export const DEFAULT_CONFIG_DIR = DEFAULT_PRODUCT_DIR;

export const DEFAULT_CACHE_DIR =
  join(DEFAULT_PRODUCT_DIR, 'cache');

export const LEGACY_CONFIG_DIR = join(homedir(), '.claude');
export const PRODUCT_SETTINGS_PATH = join(DEFAULT_CONFIG_DIR, 'settings.json');
export const DEFAULT_MINIMAX_CN_BASE_URL =
  'https://api.minimaxi.com/anthropic';
export const DEFAULT_PRODUCT_MODEL =
  process.env.CLAUDE_AGENT_DEFAULT_MODEL ?? 'MiniMax-M2.7';

export const LAUNCHER_MACRO = {
  VERSION: '2.1.89',
  BUILD_TIME: '2026-03-15',
  FEEDBACK_CHANNEL: `#${PRODUCT_NAMESPACE}`,
  ISSUES_EXPLAINER: 'https://github.com/anthropics/claude-code/issues',
  PACKAGE_URL: 'claude-agent',
  NATIVE_PACKAGE_URL: 'claude-agent',
};

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function safeReadSettingsFile() {
  try {
    const raw = readFileSync(PRODUCT_SETTINGS_PATH, 'utf8').trim();
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw new Error(
      formatDiagnosticError(
        DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
        `Invalid product settings at ${PRODUCT_SETTINGS_PATH}: ${error?.message ?? error}`,
      ),
    );
  }
}

function getSettingString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getResolvedLauncherConfig() {
  const settings = safeReadSettingsFile();
  const settingsEnv =
    settings && typeof settings === 'object' && settings.env && typeof settings.env === 'object'
      ? settings.env
      : {};

  const apiBaseUrl =
    getSettingString(settingsEnv.ANTHROPIC_BASE_URL) ??
    process.env.ANTHROPIC_BASE_URL ??
    DEFAULT_MINIMAX_CN_BASE_URL;
  const apiKey =
    getSettingString(settingsEnv.ANTHROPIC_API_KEY) ??
    process.env.ANTHROPIC_API_KEY;
  const authToken =
    getSettingString(settingsEnv.ANTHROPIC_AUTH_TOKEN) ??
    process.env.ANTHROPIC_AUTH_TOKEN;
  const model =
    getSettingString(settings.model) ??
    process.env.ANTHROPIC_MODEL ??
    DEFAULT_PRODUCT_MODEL;

  return {
    apiBaseUrl,
    apiKey,
    authToken,
    model,
    settings,
    settingsEnv,
  };
}

export function validateLauncherConfiguration(argv = process.argv) {
  const { apiBaseUrl, apiKey, authToken } = getResolvedLauncherConfig();
  const commandLine = argv.slice(2);
  const isNonInteractive =
    commandLine.includes('-p') || commandLine.includes('--print');
  const isInfoOnly =
    commandLine.includes('-h') ||
    commandLine.includes('--help') ||
    commandLine.includes('-v') ||
    commandLine.includes('--version');

  try {
    new URL(apiBaseUrl);
  } catch (error) {
    throw new Error(
      formatDiagnosticError(
        DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
        `Invalid ANTHROPIC_BASE_URL in ${PRODUCT_SETTINGS_PATH}: ${error?.message ?? error}`,
      ),
    );
  }

  if (apiKey?.includes('<SECRET_TOKEN_PLACEHOLDER>')) {
    throw new Error(
      formatDiagnosticError(
        DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
        `ANTHROPIC_API_KEY in ${PRODUCT_SETTINGS_PATH} still contains a placeholder value`,
      ),
    );
  }

  if (authToken?.includes('<SECRET_TOKEN_PLACEHOLDER>')) {
    throw new Error(
      formatDiagnosticError(
        DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
        `ANTHROPIC_AUTH_TOKEN in ${PRODUCT_SETTINGS_PATH} still contains a placeholder value`,
      ),
    );
  }

  if (!isInfoOnly && isNonInteractive && !apiKey && !authToken) {
    throw new Error(
      formatDiagnosticError(
        DIAGNOSTIC_ERROR_CODES.AUTH_ERROR,
        `Missing API credentials. Set env.ANTHROPIC_API_KEY or env.ANTHROPIC_AUTH_TOKEN in ${PRODUCT_SETTINGS_PATH}`,
      ),
    );
  }
}

export function applyLauncherDefaults() {
  ensureDirectory(DEFAULT_CONFIG_DIR);
  ensureDirectory(DEFAULT_CACHE_DIR);

  process.env.CLAUDE_CODE_PRODUCT_NAMESPACE = PRODUCT_NAMESPACE;
  process.env.CLAUDE_CODE_PRODUCT_NAME = PRODUCT_NAME;
  process.env.CLAUDE_CODE_PRODUCT_DIR = DEFAULT_PRODUCT_DIR;
  process.env.CLAUDE_CONFIG_DIR = DEFAULT_CONFIG_DIR;
  process.env.CLAUDE_CODE_CACHE_DIR = DEFAULT_CACHE_DIR;

  const { apiBaseUrl, apiKey, authToken, model } = getResolvedLauncherConfig();
  process.env.ANTHROPIC_BASE_URL = apiBaseUrl;
  process.env.ANTHROPIC_MODEL = model;
  if (apiKey) {
    process.env.ANTHROPIC_API_KEY = apiKey;
  }
  if (authToken) {
    process.env.ANTHROPIC_AUTH_TOKEN = authToken;
  }
}

export function getLauncherBootstrapCode() {
  return `
if (import.meta.main) {
  process.env.CLAUDE_CODE_PRODUCT_NAMESPACE = ${JSON.stringify(PRODUCT_NAMESPACE)};
  process.env.CLAUDE_CODE_PRODUCT_NAME = ${JSON.stringify(PRODUCT_NAME)};
  process.env.CLAUDE_CODE_PRODUCT_DIR = ${JSON.stringify(DEFAULT_PRODUCT_DIR)};
  process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(DEFAULT_CONFIG_DIR)};
  process.env.CLAUDE_CODE_CACHE_DIR = ${JSON.stringify(DEFAULT_CACHE_DIR)};
  globalThis.MACRO = ${JSON.stringify(LAUNCHER_MACRO, null, 2)};
  main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}
`;
}
