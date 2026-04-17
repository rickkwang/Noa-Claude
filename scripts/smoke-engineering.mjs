#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_CONFIG_DIR,
  DEFAULT_MINIMAX_CN_BASE_URL,
  PRODUCT_SETTINGS_PATH,
  getResolvedLauncherConfig,
} from '../launcher-config.js';

const repoRoot = resolve(import.meta.dir, '..');
const agentBin = resolve(repoRoot, 'bin/noa.js');

function fail(message, details) {
  if (details) {
    console.error(message, details);
  } else {
    console.error(message);
  }
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
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
    },
  );
  if (result.status !== 124) {
    fail(
      'noa did not stay alive for the interactive startup window',
      result.stderr || result.stdout,
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
  const { apiBaseUrl, apiKey, model } = getResolvedLauncherConfig();

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
    if (!apiKey) {
      fail(`Missing ANTHROPIC_API_KEY in ${PRODUCT_SETTINGS_PATH}`);
    }
    if (apiBaseUrl !== DEFAULT_MINIMAX_CN_BASE_URL) {
      fail(`Resolved base URL mismatch: ${apiBaseUrl}`);
    }
    if (model !== 'MiniMax-M2.7') {
      fail(`Resolved model mismatch: ${model}`);
    }
  }
}

function runOptionalLiveSmoke() {
  if (process.env.CLAUDE_AGENT_SMOKE_LIVE !== '1') {
    console.log('Skipping live MiniMax request smoke. Set CLAUDE_AGENT_SMOKE_LIVE=1 to enable.');
    return;
  }

  const smokeTimeoutMs = Number(process.env.CLAUDE_AGENT_SMOKE_LIVE_TIMEOUT_MS || 20000);
  console.log(`Running live MiniMax request smoke (timeout ${smokeTimeoutMs}ms)...`);
  const result = runCommand(agentBin, [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format',
    'text',
    'Reply with exactly ok',
  ], {
    timeout: smokeTimeoutMs,
    killSignal: 'SIGKILL',
  });

  let lastLine;
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length > 0) {
      lastLine = line.toLowerCase();
    }
  }
  if (lastLine !== 'ok') {
    fail('Live MiniMax smoke did not return the expected output', result.stdout);
  }
}

console.log('Verifying isolated config and MiniMax defaults...');
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

runOptionalLiveSmoke();

console.log('Engineering smoke checks passed.');
