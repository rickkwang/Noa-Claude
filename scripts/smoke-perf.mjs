#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PRODUCT_PROJECT_DIR } from '../src/utils/productPaths.ts';

const repoRoot = resolve(import.meta.dir, '..');
const agentBin = resolve(repoRoot, 'bin/noa.js');

const EXPECTED_TIMEOUTS = {
  auto: 1000,
  explicit: 2500,
};

const MAX_FALLBACK_WALL_MS = {
  auto: 1200,
  explicit: 2800,
};

function fail(message, details) {
  if (details) {
    console.error(message, details);
  } else {
    console.error(message);
  }
  process.exit(1);
}

function assert(condition, message, details) {
  if (!condition) {
    fail(message, details);
  }
}

function parseIsoMs(line) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  if (!match) return undefined;
  return Date.parse(match[1]);
}

function parsePerfLog(debugLogPath, serverName) {
  const content = readFileSync(debugLogPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  const startLine = lines.find(line =>
    line.includes(`MCP server "${serverName}": Starting connection`),
  );
  const timeoutLine = lines.find(line =>
    line.includes('regular servers not ready after'),
  );

  const timeoutMatch = timeoutLine?.match(/regular servers not ready after (\d+)ms/);
  const configuredTimeoutMs = timeoutMatch ? Number(timeoutMatch[1]) : undefined;

  const startMs = startLine ? parseIsoMs(startLine) : undefined;
  const timeoutMs = timeoutLine ? parseIsoMs(timeoutLine) : undefined;
  const fallbackWallMs =
    startMs !== undefined && timeoutMs !== undefined ? timeoutMs - startMs : undefined;

  return {
    startLine,
    timeoutLine,
    configuredTimeoutMs,
    fallbackWallMs,
  };
}

function writeHangMcpConfig(filePath, serverName) {
  const payload = {
    mcpServers: {
      [serverName]: {
        type: 'stdio',
        command: 'bash',
        args: ['-lc', 'sleep 60'],
      },
    },
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function runScenario({
  name,
  cwd,
  args,
  serverName,
  expectedTimeoutMs,
  maxFallbackWallMs,
}) {
  const debugLogPath = join(cwd, `${name}-debug.log`);
  const startWall = Date.now();
  const result = spawnSync(
    'timeout',
    ['10', agentBin, '--debug-file', debugLogPath, '--print', 'ping', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'sk-test-smoke-perf',
      },
    },
  );
  const wallMs = Date.now() - startWall;
  const parsed = parsePerfLog(debugLogPath, serverName);
  const output = `${result.stderr || ''}${result.stdout || ''}`;

  assert(
    result.status === 124 ||
      result.status === 0 ||
      (
        result.status === 1 &&
        output.includes('[MCP_TIMEOUT]') &&
        output.includes(`regular MCP not ready after ${expectedTimeoutMs}ms`)
      ),
    `Unexpected process status in ${name} scenario`,
    output,
  );
  assert(parsed.timeoutLine, `Missing MCP timeout fallback log in ${name} scenario`, parsed);
  assert(
    parsed.configuredTimeoutMs === expectedTimeoutMs,
    `Unexpected MCP timeout threshold in ${name} scenario`,
    parsed,
  );
  assert(
    typeof parsed.fallbackWallMs === 'number' &&
      parsed.fallbackWallMs <= maxFallbackWallMs,
    `Fallback took too long in ${name} scenario`,
    parsed,
  );

  return {
    scenario: name,
    wallMs,
    didTriggerFallback: Boolean(parsed.timeoutLine),
    configuredTimeoutMs: parsed.configuredTimeoutMs,
    fallbackWallMs: parsed.fallbackWallMs,
    maxFallbackWallMs,
  };
}

const workdir = mkdtempSync(join(tmpdir(), 'noa-smoke-perf-'));
try {
  const autoProjectDir = join(workdir, 'auto-project');
  const autoMcpFile = join(autoProjectDir, PRODUCT_PROJECT_DIR, 'mcp.json');
  const explicitMcpFile = join(workdir, 'explicit-mcp.json');

  mkdirSync(autoProjectDir, { recursive: true });
  mkdirSync(join(autoProjectDir, PRODUCT_PROJECT_DIR), { recursive: true });

  writeHangMcpConfig(autoMcpFile, 'hang-auto');
  writeHangMcpConfig(explicitMcpFile, 'hang-explicit');

  const autoMetrics = runScenario({
    name: 'auto',
    cwd: autoProjectDir,
    args: [],
    serverName: 'hang-auto',
    expectedTimeoutMs: EXPECTED_TIMEOUTS.auto,
    maxFallbackWallMs: MAX_FALLBACK_WALL_MS.auto,
  });

  const explicitMetrics = runScenario({
    name: 'explicit',
    cwd: repoRoot,
    args: ['--mcp-config', explicitMcpFile],
    serverName: 'hang-explicit',
    expectedTimeoutMs: EXPECTED_TIMEOUTS.explicit,
    maxFallbackWallMs: MAX_FALLBACK_WALL_MS.explicit,
  });

  assert(
    typeof autoMetrics.fallbackWallMs === 'number' &&
      typeof explicitMetrics.fallbackWallMs === 'number' &&
      autoMetrics.fallbackWallMs < explicitMetrics.fallbackWallMs,
    'Auto-discovery fallback should remain faster than explicit MCP config fallback',
    {
      autoFallbackWallMs: autoMetrics.fallbackWallMs,
      explicitFallbackWallMs: explicitMetrics.fallbackWallMs,
    },
  );

  const autoHeadroomMs =
    autoMetrics.maxFallbackWallMs - autoMetrics.fallbackWallMs;
  const explicitHeadroomMs =
    explicitMetrics.maxFallbackWallMs - explicitMetrics.fallbackWallMs;

  console.log(JSON.stringify(autoMetrics));
  console.log(JSON.stringify(explicitMetrics));
  console.log(
    JSON.stringify({
      scenario: 'comparison',
      assertion: 'auto_faster_than_explicit',
      autoHeadroomMs,
      explicitHeadroomMs,
    }),
  );
  console.log('Performance smoke checks passed.');
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
