#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { consumePostCompaction, getSessionId } from '../src/bootstrap/state.ts';
import { buildDisplayText, formatCompactError } from '../src/commands/compact/compact.ts';
import {
  findHistorySearchMatchPosition,
  normalizeHistorySearchText,
} from '../src/history.ts';
import {
  renderableSearchText,
  toolUseSearchText,
} from '../src/utils/transcriptSearch.ts';
import {
  getSandboxRuntimeCompatibility,
  SandboxManager,
} from '../src/utils/sandbox/sandbox-adapter.ts';
import { ripGrep } from '../src/utils/ripgrep.ts';
import {
  computeStandaloneAgentContext,
} from '../src/utils/sessionRestore.ts';
import {
  buildPostCompactMessages,
} from '../src/services/compact/compact.ts';
import { loadConversationForResume } from '../src/utils/conversationRecovery.ts';
import {
  clearSessionMetadata,
  getCurrentSessionAgentColor,
  getProjectDir,
  getCurrentSessionTitle,
  getCurrentSessionTag,
  getProjectsDir,
  getTranscriptPathForSession,
  isChainParticipant,
  isTranscriptMessage,
  restoreSessionMetadata,
} from '../src/utils/sessionStorage.ts';
import { getOriginalCwd } from '../src/bootstrap/state.ts';
import { applyLauncherDefaults, DEFAULT_PRODUCT_DIR } from '../launcher-config.js';
import {
  createCompactBoundaryMessage,
  createUserMessage,
  getMessagesAfterCompactBoundary,
} from '../src/utils/messages.ts';

applyLauncherDefaults();

const repoRoot = resolve(import.meta.dir, '..');
const agentBin = resolve(repoRoot, 'bin/claude-agent.js');

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

function runAgent(args, options = {}) {
  return spawnSync(agentBin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 15000,
    killSignal: 'SIGKILL',
    ...options,
  });
}

function checkSandboxCompatibility() {
  const compatibility = getSandboxRuntimeCompatibility();
  const annotated = SandboxManager.annotateStderrWithSandboxFailures(
    'cat missing.txt',
    'sample stderr',
  );
  const readConfig = SandboxManager.getFsReadConfig();
  const writeConfig = SandboxManager.getFsWriteConfig();
  const networkConfig = SandboxManager.getNetworkRestrictionConfig();

  assert(typeof compatibility.compatible === 'boolean', 'Missing sandbox compatibility status');
  assert(Array.isArray(compatibility.missingMethods), 'Missing sandbox missingMethods list');
  assert(annotated === 'sample stderr', 'Sandbox stderr fallback should preserve stderr');
  assert(Array.isArray(readConfig.denyOnly), 'Sandbox read config fallback shape invalid');
  assert(Array.isArray(writeConfig.allowOnly), 'Sandbox write config fallback shape invalid');
  assert(Array.isArray(networkConfig.allowedHosts), 'Sandbox network config fallback shape invalid');
}

async function checkRipgrep() {
  const workdir = mkdtempSync(join(tmpdir(), 'claude-agent-rg-'));
  try {
    writeFileSync(join(workdir, 'alpha.txt'), 'alpha\nbeta\n', 'utf8');
    writeFileSync(join(workdir, 'nested.txt'), 'gamma\nalpha delta\n', 'utf8');

    const matched = await ripGrep(
      ['-n', '--no-heading', 'alpha'],
      workdir,
      AbortSignal.timeout(5000),
    );
    assert(
      matched.some(line => line.includes('alpha.txt:1:alpha')),
      'ripgrep local search did not return expected match',
      matched,
    );

    const noMatch = await ripGrep(
      ['-n', '--no-heading', 'does-not-exist'],
      workdir,
      AbortSignal.timeout(5000),
    );
    assert(Array.isArray(noMatch) && noMatch.length === 0, 'ripgrep no-match should resolve to an empty list', noMatch);

    let invalidUsageFailed = false;
    try {
      await ripGrep(
        ['--definitely-invalid-rg-flag'],
        workdir,
        AbortSignal.timeout(5000),
      );
    } catch {
      invalidUsageFailed = true;
    }
    assert(invalidUsageFailed, 'ripgrep invalid usage should surface a failure');
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

function checkSessionUtilities() {
  assert(
    isTranscriptMessage({ type: 'user' }),
    'user message should be treated as transcript message',
  );
  assert(
    !isTranscriptMessage({ type: 'progress' }),
    'progress message must not be treated as transcript message',
  );
  assert(
    isChainParticipant({ type: 'assistant' }),
    'assistant message should participate in chain',
  );
  assert(
    !isChainParticipant({ type: 'progress' }),
    'progress message must not participate in chain',
  );
  const standaloneContext = computeStandaloneAgentContext('Reviewer', 'blue');
  assert(
    standaloneContext?.name === 'Reviewer' && standaloneContext?.color === 'blue',
    'standalone agent context restore returned unexpected result',
    standaloneContext,
  );

  const expectedProjectsDir = join(DEFAULT_PRODUCT_DIR, 'projects');
  assert(
    getProjectsDir() === expectedProjectsDir,
    'session projects dir should stay inside isolated product dir',
    { actual: getProjectsDir(), expected: expectedProjectsDir },
  );

  const currentSessionId = getSessionId();
  const transcriptPath = getTranscriptPathForSession(currentSessionId);
  const expectedTranscriptPath = join(
    getProjectDir(getOriginalCwd()),
    `${currentSessionId}.jsonl`,
  );
  assert(
    transcriptPath === expectedTranscriptPath,
    'session transcript path should resolve inside isolated project bucket',
    { actual: transcriptPath, expected: expectedTranscriptPath },
  );

  clearSessionMetadata();
  restoreSessionMetadata({
    customTitle: 'Runtime health title',
    tag: 'runtime-tag',
    agentColor: 'blue',
    mode: 'normal',
  });
  assert(
    getCurrentSessionTitle(currentSessionId) === 'Runtime health title',
    'session title restore should populate in-memory metadata cache',
  );
  assert(
    getCurrentSessionTag(currentSessionId) === 'runtime-tag',
    'session tag restore should populate in-memory metadata cache',
  );
  assert(
    getCurrentSessionAgentColor() === 'blue',
    'session agent color restore should populate in-memory metadata cache',
  );
  clearSessionMetadata();
  assert(
    getCurrentSessionTitle(currentSessionId) === undefined &&
      getCurrentSessionTag(currentSessionId) === undefined &&
      getCurrentSessionAgentColor() === undefined,
    'session metadata clear should reset in-memory cache',
  );
}

function checkHistorySearchUtilities() {
  assert(
    normalizeHistorySearchText('Fix BUG') === 'fix bug',
    'history search normalization should lowercase input',
  );
  assert(
    findHistorySearchMatchPosition('Fix BUG in parser', 'bug') >= 0,
    'history search should match case-insensitively',
  );
  assert(
    findHistorySearchMatchPosition('/review Fix BUG in parser', 'BUG') >= 0,
    'history search should preserve matches for already-uppercase queries',
  );
  assert(
    findHistorySearchMatchPosition('Fix parser issue', 'missing') === -1,
    'history search should report no match when query is absent',
  );
}

function checkTranscriptSearchUtilities() {
  const searchable = renderableSearchText({
    type: 'user',
    message: {
      content: 'Keep this <system-reminder>hidden</system-reminder> visible',
    },
  });
  assert(
    searchable.includes('keep this') && !searchable.includes('hidden'),
    'transcript search should strip system-reminder content',
    searchable,
  );

  const toolUse = toolUseSearchText({
    command: 'rg "needle"',
    args: ['--glob', '*.ts'],
  });
  assert(
    toolUse.includes('rg "needle"') && toolUse.includes('--glob *.ts'),
    'tool use search text should include command and argument arrays',
    toolUse,
  );
}

async function checkCompactUtilities() {
  const compactText = buildDisplayText(
    { options: { verbose: false } },
    'default',
  );
  assert(
    compactText.includes('Conversation compacted.'),
    'default compact display text should use product-style headline',
    compactText,
  );
  assert(
    compactText.includes('Continue in this session.'),
    'default compact display text should describe continuation',
    compactText,
  );
  assert(
    compactText.includes('to review compacted history.'),
    'default compact display text should point at transcript history',
    compactText,
  );

  const customCompactText = buildDisplayText(
    { options: { verbose: true } },
    'custom',
    'Hook note',
  );
  assert(
    customCompactText.includes('Conversation compacted with custom instructions.'),
    'custom compact display text should distinguish custom compaction',
    customCompactText,
  );
  assert(
    customCompactText.includes('Hook note'),
    'custom compact display text should preserve hook/user display message',
    customCompactText,
  );

  assert(
    formatCompactError('not_enough_messages') === 'Nothing to compact yet.',
    'compact not-enough-messages error should be productized',
  );
  assert(
    formatCompactError('aborted') === 'Compaction canceled.',
    'compact abort error should stay stable',
  );

  const before = createUserMessage({ content: 'Before compact' });
  const boundary = createCompactBoundaryMessage('manual', 123, before.uuid);
  const summary = createUserMessage({
    content: 'Summary',
    isCompactSummary: true,
  });
  const after = createUserMessage({ content: 'After compact' });
  before.timestamp = '2026-01-01T00:00:00.000Z';
  boundary.timestamp = '2026-01-01T00:00:01.000Z';
  summary.timestamp = '2026-01-01T00:00:02.000Z';
  after.timestamp = '2026-01-01T00:00:03.000Z';
  summary.parentUuid = boundary.uuid;
  after.parentUuid = summary.uuid;
  const postCompactMessages = buildPostCompactMessages({
    boundaryMarker: boundary,
    summaryMessages: [summary],
    messagesToKeep: [after],
    attachments: [],
    hookResults: [],
    preCompactTokenCount: 123,
    postCompactTokenCount: 45,
    truePostCompactTokenCount: 45,
  });
  assert(
    postCompactMessages[0]?.subtype === 'compact_boundary' &&
      postCompactMessages[1]?.type === 'user' &&
      postCompactMessages[2]?.type === 'user',
    'post-compact messages should preserve boundary -> summary -> kept ordering',
    postCompactMessages,
  );

  const activeMessages = getMessagesAfterCompactBoundary([
    before,
    boundary,
    summary,
    after,
  ]);
  assert(
    activeMessages.length === 3 && activeMessages[0]?.uuid === boundary.uuid,
    'messages after compact boundary should project active context from latest boundary',
    activeMessages,
  );

  const runtimeDir = mkdtempSync(join(tmpdir(), 'claude-agent-compact-resume-'));
  const transcriptPath = join(runtimeDir, 'resume.jsonl');
  try {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    for (const msg of [before, boundary, summary, after]) {
      msg.sessionId = sessionId;
    }
    writeFileSync(
      transcriptPath,
      [before, boundary, summary, after].map(msg => JSON.stringify(msg)).join('\n') + '\n',
      'utf8',
    );
    const resumed = await loadConversationForResume(undefined, transcriptPath);
    assert(resumed, 'loadConversationForResume should load compacted transcript by path');
    assert(
      resumed.messages.some(msg => msg.type === 'system' && msg.subtype === 'compact_boundary'),
      'resumed compacted transcript should preserve compact boundary messages',
      resumed.messages,
    );
    assert(
      resumed.messages.some(msg => msg.type === 'user'),
      'resumed compacted transcript should keep post-compact user context',
      resumed.messages,
    );
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }

  assert(
    consumePostCompaction() === false,
    'post-compaction flag should not be spuriously set during helper checks',
  );
}

function writeSettings(dir, settings) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
}

function checkLauncherFailurePaths() {
  const invalidBaseDir = mkdtempSync(join(tmpdir(), 'claude-agent-invalid-base-'));
  const missingTokenDir = mkdtempSync(join(tmpdir(), 'claude-agent-missing-token-'));
  const oauthFallbackDir = mkdtempSync(join(tmpdir(), 'claude-agent-oauth-fallback-'));

  try {
    writeSettings(invalidBaseDir, {
      env: {
        ANTHROPIC_BASE_URL: 'not-a-url',
        ANTHROPIC_API_KEY: 'sk-test-valid-shape',
      },
    });
    const invalidBase = runAgent(['--version'], {
      env: {
        ...process.env,
        CLAUDE_CODE_PRODUCT_DIR: invalidBaseDir,
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: '',
      },
    });
    assert(
      invalidBase.status !== 0 &&
        `${invalidBase.stderr}${invalidBase.stdout}`.includes('[CONFIG_ERROR]') &&
        `${invalidBase.stderr}${invalidBase.stdout}`.includes('Invalid ANTHROPIC_BASE_URL'),
      'Invalid base URL should fail before startup',
      invalidBase.stderr || invalidBase.stdout,
    );

    writeSettings(missingTokenDir, {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
      },
      model: 'MiniMax-M2.7',
    });
    const missingToken = runAgent(['--print', '--tools', '', 'Reply with exactly ok'], {
      env: {
        ...process.env,
        CLAUDE_CODE_PRODUCT_DIR: missingTokenDir,
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: '',
      },
    });
    assert(
      missingToken.status !== 0 &&
        `${missingToken.stderr}${missingToken.stdout}`.includes('[AUTH_ERROR]') &&
        `${missingToken.stderr}${missingToken.stdout}`.includes('Missing API credentials'),
      'Missing token should fail with a clear launcher error',
      missingToken.stderr || missingToken.stdout,
    );

    writeSettings(oauthFallbackDir, {
      env: {
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
      },
      model: 'MiniMax-M2.7',
    });
    const oauthFallback = runAgent(['--print', '--tools', '', 'Reply with exactly ok'], {
      env: {
        ...process.env,
        CLAUDE_CODE_PRODUCT_DIR: oauthFallbackDir,
        ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: '',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-should-not-be-used',
        CLAUDE_CODE_ENTRYPOINT: '',
        CLAUDE_CODE_REMOTE: '',
      },
    });
    assert(
      oauthFallback.status !== 0 &&
        `${oauthFallback.stderr}${oauthFallback.stdout}`.includes('[AUTH_ERROR]') &&
        `${oauthFallback.stderr}${oauthFallback.stdout}`.includes('Missing API credentials'),
      'Third-party MiniMax path must not fall back to Claude OAuth credentials',
      oauthFallback.stderr || oauthFallback.stdout,
    );
  } finally {
    rmSync(invalidBaseDir, { recursive: true, force: true });
    rmSync(missingTokenDir, { recursive: true, force: true });
    rmSync(oauthFallbackDir, { recursive: true, force: true });
  }
}

function checkResumeFailurePaths() {
  const invalidResume = runAgent([
    '--print',
    '--tools',
    '',
    '--resume',
    'invalid-session-id',
    'ping',
  ]);
  assert(
    invalidResume.status !== 0 &&
      `${invalidResume.stderr}${invalidResume.stdout}`.includes('[CONFIG_ERROR]') &&
      `${invalidResume.stderr}${invalidResume.stdout}`.includes(
        '--resume requires a valid session ID when used with --print',
      ),
    'Invalid --resume identifier should fail with CONFIG_ERROR',
    invalidResume.stderr || invalidResume.stdout,
  );

  const malformedDir = mkdtempSync(join(tmpdir(), 'claude-agent-resume-malformed-'));
  const malformedTranscript = join(malformedDir, 'broken.jsonl');
  try {
    writeFileSync(
      malformedTranscript,
      '{"type":"user","message":{"content":"ok"}}\n{not-json}\n',
      'utf8',
    );

    const malformedResume = runAgent([
      '--print',
      '--tools',
      '',
      '--resume',
      malformedTranscript,
      'ping',
    ]);
    const malformedOutput = `${malformedResume.stderr}${malformedResume.stdout}`;
    assert(
      malformedResume.status !== 0 &&
        (
          malformedOutput.includes(
            '[RUNTIME_COMPAT_ERROR] Resume source is malformed or incompatible.',
          ) ||
          malformedOutput.includes('[CONFIG_ERROR] No conversation found with session ID:')
        ),
      'Malformed/invalid resume transcript should fail with a stable diagnostic error',
      malformedResume.stderr || malformedResume.stdout,
    );
  } finally {
    rmSync(malformedDir, { recursive: true, force: true });
  }
}

function checkNonInteractiveMcpTimeoutFallback() {
  const runtimeDir = mkdtempSync(join(tmpdir(), 'claude-agent-mcp-timeout-'));
  const mcpConfigPath = join(runtimeDir, 'mcp-timeout.json');
  const debugLogPath = join(runtimeDir, 'debug.log');

  try {
    writeFileSync(
      mcpConfigPath,
      JSON.stringify(
        {
          mcpServers: {
            hang_stdio: {
              type: 'stdio',
              command: 'bash',
              args: ['-lc', 'sleep 60'],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const timeoutRun = spawnSync(
      '/opt/homebrew/bin/timeout',
      [
        '8',
        agentBin,
        '--debug-file',
        debugLogPath,
        '--print',
        'ping',
        '--mcp-config',
        mcpConfigPath,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          ANTHROPIC_API_KEY:
            process.env.ANTHROPIC_API_KEY ?? 'sk-test-runtime-timeout-check',
          CLAUDE_CODE_REGULAR_MCP_CONNECT_TIMEOUT_MS: '400',
        },
      },
    );

    // timeout(1) exits with 124 when it kills the child; that's expected here.
    assert(
      timeoutRun.status === 124 || timeoutRun.status === 0,
      'MCP timeout fallback smoke run returned unexpected status',
      timeoutRun.stderr || timeoutRun.stdout,
    );

    const debugLog = readFileSync(debugLogPath, 'utf8');
    assert(
      debugLog.includes(
        'regular servers not ready after 400ms — proceeding; background connection continues',
      ),
      'Missing regular MCP timeout fallback log in non-interactive mode',
      debugLog,
    );

    const debugLines = debugLog.split('\n').filter(Boolean);
    const startLine = debugLines.find(line =>
      line.includes('MCP server "hang_stdio": Starting connection'),
    );
    const fallbackLine = debugLines.find(line =>
      line.includes('regular servers not ready after 400ms'),
    );
    assert(
      Boolean(startLine) && Boolean(fallbackLine),
      'Unable to parse MCP timeout fallback timing lines',
      { startLine, fallbackLine },
    );
    const startMs = startLine ? parseIsoMs(startLine) : undefined;
    const fallbackMs = fallbackLine ? parseIsoMs(fallbackLine) : undefined;
    assert(
      startMs !== undefined && fallbackMs !== undefined,
      'Unable to parse MCP timeout fallback timestamps',
      { startLine, fallbackLine },
    );
    const fallbackWallMs = fallbackMs - startMs;
    assert(
      fallbackWallMs <= 700,
      'MCP timeout fallback exceeded runtime health SLO',
      { fallbackWallMs },
    );
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

console.log('Checking sandbox runtime compatibility...');
checkSandboxCompatibility();

console.log('Checking session utility chain invariants...');
checkSessionUtilities();

console.log('Checking history search helpers...');
checkHistorySearchUtilities();

console.log('Checking transcript search helpers...');
checkTranscriptSearchUtilities();

console.log('Checking compact helpers...');
await checkCompactUtilities();

console.log('Checking ripgrep local search paths...');
await checkRipgrep();

console.log('Checking launcher failure paths...');
checkLauncherFailurePaths();

console.log('Checking resume failure paths...');
checkResumeFailurePaths();

console.log('Checking non-interactive MCP timeout fallback...');
checkNonInteractiveMcpTimeoutFallback();

console.log('Runtime health checks passed.');
process.exit(0);
