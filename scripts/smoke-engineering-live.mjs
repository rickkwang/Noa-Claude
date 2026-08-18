#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { resolve } from 'path';

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

function assertLiveProviderConfig() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    fail(
      'Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for live smoke. Configure provider credentials before running smoke:engine:live.',
    );
  }
}

function runLiveProviderSmoke() {
  const smokeTimeoutMs = Number(process.env.CLAUDE_AGENT_SMOKE_LIVE_TIMEOUT_MS || 20000);
  console.log(`Running live provider smoke (timeout ${smokeTimeoutMs}ms)...`);
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
    fail('Live provider smoke did not return the expected output', result.stdout);
  }
}

assertLiveProviderConfig();

console.log('Running engineering smoke baseline before live checks...');
runCommand('bun', ['./scripts/smoke-engineering.mjs']);

runLiveProviderSmoke();

console.log('Engineering live smoke checks passed.');
