import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, 'package.json'), 'utf-8'),
);

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
  process.env.CLAUDE_CODE_PRODUCT_NAMESPACE ?? 'noa';

export const PRODUCT_NAME =
  process.env.CLAUDE_CODE_PRODUCT_NAME ?? 'Noa Claude';

export const PRODUCT_DIR_BASENAME = '.noa';

export const DEFAULT_PRODUCT_DIR =
  process.env.CLAUDE_CODE_PRODUCT_DIR ?? join(homedir(), PRODUCT_DIR_BASENAME);

// Precedence: an explicit CLAUDE_CODE_PRODUCT_DIR (this fork's "put the whole
// product here" knob, used to isolate child processes) beats CLAUDE_CONFIG_DIR,
// which beats the default. CLAUDE_CONFIG_DIR is honoured at all because
// getClaudeConfigHomeDir() (src/utils/envUtils.ts) honours it: the launcher
// used to overwrite the caller's value with the product dir, so
// `CLAUDE_CONFIG_DIR=/tmp/x noa ...` silently kept reading ~/.noa. It is
// checked second because applyLauncherDefaults() exports CLAUDE_CONFIG_DIR
// into the environment, so a child process inherits one it never asked for —
// only PRODUCT_DIR can be trusted as deliberate isolation there.
export const DEFAULT_CONFIG_DIR =
  process.env.CLAUDE_CODE_PRODUCT_DIR ??
  process.env.CLAUDE_CONFIG_DIR ??
  DEFAULT_PRODUCT_DIR;

export const DEFAULT_CACHE_DIR =
  process.env.CLAUDE_CODE_CACHE_DIR ?? join(DEFAULT_PRODUCT_DIR, 'cache');

export const PRODUCT_SETTINGS_PATH = join(DEFAULT_CONFIG_DIR, 'settings.json');
export const DEFAULT_MINIMAX_CN_BASE_URL =
  'https://api.minimaxi.com/anthropic';
export const DEFAULT_PRODUCT_MODEL =
  process.env.CLAUDE_AGENT_DEFAULT_MODEL ?? 'MiniMax-M2.7';

export const LAUNCHER_MACRO = {
  VERSION: pkg.version,
  DISPLAY_VERSION: pkg.version,
  BUILD_TIME: '2026-04-28T00:00:00.000Z',
  FEEDBACK_CHANNEL: `#${PRODUCT_NAMESPACE}`,
  ISSUES_EXPLAINER: 'https://github.com/rickkwang/Noa-Claude/issues',
  PACKAGE_URL: '@rickkwang/noa-claude',
  NATIVE_PACKAGE_URL: '@rickkwang/noa-claude',
  DISTRIBUTION: 'curl',
};

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function ensureSettingsFile() {
  if (!existsSync(PRODUCT_SETTINGS_PATH)) {
    writeFileSync(PRODUCT_SETTINGS_PATH, '{}\n');
  }
}

function safeReadSettingsFile() {
  try {
    const raw = readFileSync(PRODUCT_SETTINGS_PATH, 'utf8').trim();
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {};
    }
    throw new Error(
      formatDiagnosticError(
        DIAGNOSTIC_ERROR_CODES.CONFIG_ERROR,
        `Invalid product settings at ${PRODUCT_SETTINGS_PATH}: ${
          typeof error?.message === 'string' ? error.message : String(error)
        }`,
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
  ensureSettingsFile();

  process.env.CLAUDE_CODE_PRODUCT_NAMESPACE = PRODUCT_NAMESPACE;
  process.env.CLAUDE_CODE_PRODUCT_NAME = PRODUCT_NAME;
  process.env.CLAUDE_CODE_PRODUCT_DIR = DEFAULT_PRODUCT_DIR;
  process.env.CLAUDE_CONFIG_DIR = DEFAULT_CONFIG_DIR;
  process.env.CLAUDE_CODE_CACHE_DIR = DEFAULT_CACHE_DIR;
  process.env.CLAUDE_AGENT_ENABLE_OFFICIAL_MARKETPLACE ??= '1';
  process.env.CLAUDE_AGENT_ENABLE_OFFICIAL_MARKETPLACE_GCS ??= '1';

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

/**
 * The env-resolution half of the bundle bootstrap, exported on its own so it
 * can be executed and asserted on (src/test/launcherConfig.test.ts). Keeping it
 * inside getLauncherBootstrapCode() left it untestable — the surrounding block
 * calls main() — and a broken precedence rule here passed the entire suite.
 *
 * Self-contained: it resolves the home directory through os.homedir() at run
 * time. Reading HOME/USERPROFILE directly is not equivalent — os.homedir()
 * falls back to the passwd entry, so it still answers when HOME is unset,
 * where the env-only form produced a relative `.noa` and scattered config into
 * whatever directory the process happened to start in.
 */
export function getLauncherEnvBootstrapCode() {
  return `
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const explicitProductDir = process.env.CLAUDE_CODE_PRODUCT_DIR;
  const explicitConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const home = homedir();
  const defaultProductDir = home ? join(home, ${JSON.stringify(PRODUCT_DIR_BASENAME)}) : null;
  // Same precedence as DEFAULT_CONFIG_DIR in launcher-config.js, so running the
  // bundle directly and running it through bin/noa.js resolve alike.
  const configDir = explicitProductDir ?? explicitConfigDir ?? defaultProductDir;
  if (!configDir) {
    console.error(
      '[CONFIG_ERROR] Cannot resolve a home directory. Set CLAUDE_CONFIG_DIR or CLAUDE_CODE_PRODUCT_DIR.',
    );
    process.exit(1);
  }
  process.env.CLAUDE_CODE_PRODUCT_NAMESPACE ??= ${JSON.stringify(PRODUCT_NAMESPACE)};
  process.env.CLAUDE_CODE_PRODUCT_NAME ??= ${JSON.stringify(PRODUCT_NAME)};
  process.env.CLAUDE_CODE_PRODUCT_DIR ??= defaultProductDir ?? configDir;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  process.env.CLAUDE_CODE_CACHE_DIR ??= join(process.env.CLAUDE_CODE_PRODUCT_DIR, 'cache');
  process.env.CLAUDE_AGENT_ENABLE_OFFICIAL_MARKETPLACE ??= '1';
  process.env.CLAUDE_AGENT_ENABLE_OFFICIAL_MARKETPLACE_GCS ??= '1';
`;
}

export function getLauncherBootstrapCode() {
  // Paths are resolved when the bundle RUNS, not when it is built: baking
  // absolutes into dist/main.js pinned every copy of the artifact to the build
  // machine's home directory.
  return `
if (import.meta.main) {
${getLauncherEnvBootstrapCode()}
  globalThis.MACRO = ${JSON.stringify(LAUNCHER_MACRO, null, 2)};
  main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}
`;
}
