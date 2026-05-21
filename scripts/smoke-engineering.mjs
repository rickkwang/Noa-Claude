#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const repoRoot = resolve(import.meta.dir, '..');
const agentBin = resolve(repoRoot, 'bin/noa.js');
const smokeConfigDir = mkdtempSync(join(tmpdir(), 'noa-smoke-engineering-'));

process.env.CLAUDE_CODE_PRODUCT_DIR = smokeConfigDir;
process.env.CLAUDE_CONFIG_DIR = smokeConfigDir;

const {
  DEFAULT_CACHE_DIR,
  DEFAULT_CONFIG_DIR,
  DEFAULT_MINIMAX_CN_BASE_URL,
  PRODUCT_SETTINGS_PATH,
  applyLauncherDefaults,
  getResolvedLauncherConfig,
} = await import('../launcher-config.js');

function fail(message, details) {
  if (details) {
    console.error(message, details);
  } else {
    console.error(message);
  }
  process.exit(1);
}

function normalizeTerminalOutput(output) {
  return output
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ' ')
    .replace(/\x1b[@-_]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      CLAUDE_CODE_PRODUCT_DIR: smokeConfigDir,
      CLAUDE_CONFIG_DIR: smokeConfigDir,
      ANTHROPIC_API_KEY: 'smoke-test-key',
    },
    ...options,
  });
  if (result.status !== 0) {
    fail(
      `Command failed: ${command} ${args.join(' ')}`,
      result.stderr || result.stdout,
    );
  }
  return result;
}

function assertInteractiveStartupStaysAlive() {
  const result = spawnSync(
    'timeout',
    ['3', '/usr/bin/script', '-q', '/dev/null', '/bin/zsh', '-lc', agentBin],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        CLAUDE_CODE_PRODUCT_DIR: smokeConfigDir,
        CLAUDE_CONFIG_DIR: smokeConfigDir,
        ANTHROPIC_API_KEY: 'smoke-test-key',
      },
    },
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const normalizedOutput = normalizeTerminalOutput(output);
  const reachedInteractiveErrorSurface =
    normalizedOutput.includes('Unable to connect to required services') &&
    normalizedOutput.includes('Press Ctrl-D again to exit');
  if (result.status !== 124 && !reachedInteractiveErrorSurface) {
    fail(
      'noa did not stay alive for the interactive startup window',
      output,
    );
  }
}

function assertConfig() {
  if (!existsSync(DEFAULT_CONFIG_DIR)) {
    fail(`Missing config directory: ${DEFAULT_CONFIG_DIR}`);
  }
  if (!existsSync(DEFAULT_CACHE_DIR)) {
    fail(`Missing cache directory: ${DEFAULT_CACHE_DIR}`);
  }
  if (!existsSync(PRODUCT_SETTINGS_PATH)) {
    fail(`Missing settings file: ${PRODUCT_SETTINGS_PATH}`);
  }

  const parsedSettings = JSON.parse(readFileSync(PRODUCT_SETTINGS_PATH, 'utf8'));
  const { apiBaseUrl, apiKey, authToken, model } = getResolvedLauncherConfig();

  const configuredBaseUrl = parsedSettings?.env?.ANTHROPIC_BASE_URL;
  // Only enforce MiniMax CN defaults when that specific provider is configured.
  // Allow first-party Anthropic API (no base URL) and other third-party providers.
  if (configuredBaseUrl !== undefined && configuredBaseUrl !== DEFAULT_MINIMAX_CN_BASE_URL) {
    // Non-MiniMax third-party URL detected — skip MiniMax-specific assertions.
    console.log(`Detected non-MiniMax provider: ${configuredBaseUrl} — skipping MiniMax CN defaults check.`);
  } else if (configuredBaseUrl === undefined) {
    console.log('Using first-party Anthropic API — skipping MiniMax CN defaults check.');
  } else {
    // MiniMax CN is configured — validate the full config is consistent.
    // launcher-config.js accepts either ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN;
    // mirror that here instead of demanding _API_KEY specifically.
    if (!apiKey && !authToken) {
      fail(`Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN in ${PRODUCT_SETTINGS_PATH}`);
    }
    if (apiBaseUrl !== DEFAULT_MINIMAX_CN_BASE_URL) {
      fail(`Resolved base URL mismatch: ${apiBaseUrl}`);
    }
    if (model !== 'MiniMax-M2.7') {
      fail(`Resolved model mismatch: ${model}`);
    }
  }
}

console.log('Verifying isolated config and MiniMax defaults...');
applyLauncherDefaults();
writeFileSync(
  PRODUCT_SETTINGS_PATH,
  JSON.stringify({ env: { ANTHROPIC_API_KEY: 'smoke-test-key' } }, null, 2) +
    '\n',
);
assertConfig();

console.log('Running build...');
runCommand('bun', ['run', 'build']);

console.log('Running typecheck...');
runCommand('bun', ['run', 'typecheck']);

console.log('Checking docs consistency...');
runCommand('bun', ['run', 'check:docs']);

console.log('Checking version entrypoints...');
runCommand(agentBin, ['--version']);
runCommand(agentBin, ['--cwd', '/tmp', '--version']);

console.log('Checking interactive startup stability...');
assertInteractiveStartupStaysAlive();

console.log('Checking runtime health...');
runCommand('bun', ['./scripts/check-runtime-health.mjs']);

console.log('Checking feature smoke...');
runCommand('bun', ['./scripts/smoke-features.mjs']);

console.log('Checking startup performance fallback...');
runCommand('bun', ['./scripts/smoke-perf.mjs']);

console.log('Engineering smoke checks passed.');
