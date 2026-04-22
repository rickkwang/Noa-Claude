#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  QueryEngine,
  _createTurnScopedCanUseToolForTesting,
} from '../src/QueryEngine.ts';
import {
  consumePostCompaction,
  getSessionId,
  isSessionPersistenceDisabled,
  setSessionPersistenceDisabled,
} from '../src/bootstrap/state.ts';
import { call as callStartupBannerCommand } from '../src/commands/startup-banner/startup-banner.ts';
import { getStartupBannerMode } from '../src/components/StartupScreen.ts';
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
  _resetTmuxControlModeProbeForTesting,
  isFullscreenEnvEnabled,
  isMouseClicksDisabled,
  isMouseTrackingEnabled,
} from '../src/utils/fullscreen.ts';
import { resetSettingsCache } from '../src/utils/settings/settingsCache.ts';
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
  createAssistantMessage,
  createUserMessage,
  getMessagesAfterCompactBoundary,
} from '../src/utils/messages.ts';
import { getDefaultAppState } from '../src/state/AppStateStore.ts';
import { createFileStateCacheWithSizeLimit } from '../src/utils/fileStateCache.ts';
import { STARTUP_BANNER_SETTINGS_FILENAME } from '../src/utils/startupBannerMode.ts';
import {
  clearMcpAuthCache,
  _getMcpToolTimeoutMsForTesting,
  _readMcpAuthCacheForTesting,
  _resetMcpAuthCacheForTesting,
  _setMcpAuthCacheEntryForTesting,
  _waitForMcpAuthCacheWritesForTesting,
} from '../src/services/mcp/client.ts';
import { _runCleanupFunctionForTesting } from '../src/utils/cleanupRegistry.ts';
import {
  _formatAvailablePluginsWarningForTesting,
  _loadAvailablePluginsForTesting,
} from '../src/cli/handlers/plugins.ts';
import {
  _emitPluginAutoupdateWarningForTesting,
  _formatPluginAutoupdateWarningForTesting,
  _resetPluginAutoupdateWarningStateForTesting,
} from '../src/utils/plugins/pluginAutoupdate.ts';
import {
  _classifyResumeListLoadErrorForTesting,
  _formatResumeListLoadFailureForTesting,
  _logResumeListLoadFailureForTesting,
} from '../src/commands/resume/resume.tsx';
import { _isForkSubagentEnabledForTesting } from '../src/tools/AgentTool/forkSubagent.ts';

applyLauncherDefaults();
globalThis.MACRO ??= {
  VERSION: '0.0.0-runtime-health',
  DISPLAY_VERSION: '0.0.0-runtime-health',
  BUILD_TIME: '',
  PACKAGE_URL: '',
};

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

const fullscreenEnvKeys = [
  'USER_TYPE',
  'TMUX',
  'TERM_PROGRAM',
  'NOA_CLAUDE_NO_FLICKER',
  'CLAUDE_CODE_NO_FLICKER',
  'NOA_CLAUDE_DISABLE_MOUSE',
  'CLAUDE_CODE_DISABLE_MOUSE',
  'NOA_CLAUDE_DISABLE_MOUSE_CLICKS',
  'CLAUDE_CODE_DISABLE_MOUSE_CLICKS',
  'CLAUDE_CONFIG_DIR',
];

function withFullscreenEnv(overrides, callback) {
  const snapshot = new Map(
    fullscreenEnvKeys.map(key => [key, process.env[key]]),
  );

  try {
    for (const key of fullscreenEnvKeys) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        const value = overrides[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      } else {
        delete process.env[key];
      }
    }
    // Point to a non-existent config dir so no user settings are loaded.
    // This ensures isFullscreenEnvEnabled() falls through to the auto-detect
    // path (tmux / USER_TYPE) rather than reading tuiMode from disk.
    if (!process.env.CLAUDE_CONFIG_DIR) {
      process.env.CLAUDE_CONFIG_DIR = '/nonexistent-claude-config-dir';
    }
    _resetTmuxControlModeProbeForTesting();
    resetSettingsCache();
    return callback();
  } finally {
    for (const key of fullscreenEnvKeys) {
      const value = snapshot.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    _resetTmuxControlModeProbeForTesting();
  }
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

function checkFullscreenEnvToggleUtilities() {
  withFullscreenEnv(
    { USER_TYPE: 'user' },
    () => {
      assert(
        isFullscreenEnvEnabled() === false,
        'fullscreen should default off for external users',
      );
      assert(
        isMouseTrackingEnabled() === true,
        'mouse tracking should default on when not explicitly disabled',
      );
      assert(
        isMouseClicksDisabled() === false,
        'mouse click handling should default enabled when not explicitly disabled',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'ant' },
    () => {
      assert(
        isFullscreenEnvEnabled() === true,
        'fullscreen should default on for ants',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'user', NOA_CLAUDE_NO_FLICKER: '1' },
    () => {
      assert(
        isFullscreenEnvEnabled() === true,
        'NOA_CLAUDE_NO_FLICKER=1 should enable fullscreen',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'ant', NOA_CLAUDE_NO_FLICKER: '0' },
    () => {
      assert(
        isFullscreenEnvEnabled() === false,
        'NOA_CLAUDE_NO_FLICKER=0 should disable fullscreen',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'user', CLAUDE_CODE_NO_FLICKER: '1' },
    () => {
      assert(
        isFullscreenEnvEnabled() === true,
        'legacy CLAUDE_CODE_NO_FLICKER=1 should still enable fullscreen',
      );
    },
  );

  withFullscreenEnv(
    {
      USER_TYPE: 'user',
      NOA_CLAUDE_NO_FLICKER: '0',
      CLAUDE_CODE_NO_FLICKER: '1',
    },
    () => {
      assert(
        isFullscreenEnvEnabled() === false,
        'NOA_CLAUDE_NO_FLICKER should take precedence over legacy fallback',
      );
    },
  );

  withFullscreenEnv(
    {
      USER_TYPE: 'user',
      NOA_CLAUDE_NO_FLICKER: '',
      CLAUDE_CODE_NO_FLICKER: '1',
    },
    () => {
      assert(
        isFullscreenEnvEnabled() === true,
        'empty NOA_CLAUDE_NO_FLICKER should fall back to legacy fullscreen toggle',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'user', NOA_CLAUDE_DISABLE_MOUSE: '1' },
    () => {
      assert(
        isMouseTrackingEnabled() === false,
        'NOA_CLAUDE_DISABLE_MOUSE=1 should disable mouse tracking',
      );
      assert(
        isMouseClicksDisabled() === false,
        'mouse click handling should remain enabled when only mouse tracking is disabled',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'user', CLAUDE_CODE_DISABLE_MOUSE: '1' },
    () => {
      assert(
        isMouseTrackingEnabled() === false,
        'legacy CLAUDE_CODE_DISABLE_MOUSE=1 should still disable mouse tracking',
      );
    },
  );

  withFullscreenEnv(
    {
      USER_TYPE: 'user',
      NOA_CLAUDE_DISABLE_MOUSE: '',
      CLAUDE_CODE_DISABLE_MOUSE: '1',
    },
    () => {
      assert(
        isMouseTrackingEnabled() === false,
        'empty NOA_CLAUDE_DISABLE_MOUSE should fall back to legacy mouse tracking toggle',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'user', NOA_CLAUDE_DISABLE_MOUSE_CLICKS: '1' },
    () => {
      assert(
        isMouseClicksDisabled() === true,
        'NOA_CLAUDE_DISABLE_MOUSE_CLICKS=1 should disable mouse clicks',
      );
      assert(
        isMouseTrackingEnabled() === true,
        'mouse tracking should stay enabled when only click handling is disabled',
      );
    },
  );

  withFullscreenEnv(
    { USER_TYPE: 'user', CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1' },
    () => {
      assert(
        isMouseClicksDisabled() === true,
        'legacy CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1 should still disable mouse clicks',
      );
    },
  );

  withFullscreenEnv(
    {
      USER_TYPE: 'user',
      NOA_CLAUDE_DISABLE_MOUSE_CLICKS: '',
      CLAUDE_CODE_DISABLE_MOUSE_CLICKS: '1',
    },
    () => {
      assert(
        isMouseClicksDisabled() === true,
        'empty NOA_CLAUDE_DISABLE_MOUSE_CLICKS should fall back to legacy click toggle',
      );
    },
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
      'timeout',
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

async function checkMcpAuthCacheConcurrency() {
  await _resetMcpAuthCacheForTesting();
  try {
    const serverIds = [
      'runtime-auth-cache-a',
      'runtime-auth-cache-b',
      'runtime-auth-cache-c',
      'runtime-auth-cache-d',
    ];

    for (const serverId of serverIds) {
      _setMcpAuthCacheEntryForTesting(serverId);
    }
    await _waitForMcpAuthCacheWritesForTesting();

    const cache = await _readMcpAuthCacheForTesting();
    for (const serverId of serverIds) {
      assert(
        cache[serverId]?.timestamp,
        'MCP auth cache concurrent write dropped an entry',
        { serverId, cache },
      );
    }

    // Prime the memoized read, then enqueue another write. The queued write
    // must not reuse this stale snapshot and overwrite the existing entries.
    await _readMcpAuthCacheForTesting();
    const lateServerId = 'runtime-auth-cache-late';
    _setMcpAuthCacheEntryForTesting(lateServerId);
    await _waitForMcpAuthCacheWritesForTesting();

    const updatedCache = await _readMcpAuthCacheForTesting();
    for (const serverId of [...serverIds, lateServerId]) {
      assert(
        updatedCache[serverId]?.timestamp,
        'MCP auth cache stale memoized read lost an entry',
        { serverId, updatedCache },
      );
    }

    // clearMcpAuthCache() must win against in-flight writes: once clear is
    // called, an older queued write must not resurrect stale needs-auth entries.
    let staleEntryResurrections = 0;
    for (let i = 0; i < 220; i++) {
      const raceServerId = `runtime-auth-cache-race-${i}`;
      _setMcpAuthCacheEntryForTesting(raceServerId);
      await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4)));
      clearMcpAuthCache();
      await _waitForMcpAuthCacheWritesForTesting();
      const raceCache = await _readMcpAuthCacheForTesting();
      if (raceCache[raceServerId]?.timestamp) {
        staleEntryResurrections++;
      }
    }
    assert(
      staleEntryResurrections === 0,
      'clearMcpAuthCache should prevent stale in-flight writes from reappearing',
      { staleEntryResurrections, iterations: 220 },
    );
  } finally {
    await _resetMcpAuthCacheForTesting();
  }
}

function checkMcpToolTimeoutDefault() {
  const previous = process.env.MCP_TOOL_TIMEOUT;
  try {
    delete process.env.MCP_TOOL_TIMEOUT;
    assert(
      _getMcpToolTimeoutMsForTesting() === 600000,
      'MCP tool timeout should default to 10 minutes',
      _getMcpToolTimeoutMsForTesting(),
    );

    process.env.MCP_TOOL_TIMEOUT = '12345';
    assert(
      _getMcpToolTimeoutMsForTesting() === 12345,
      'MCP_TOOL_TIMEOUT should override the default MCP tool timeout',
      _getMcpToolTimeoutMsForTesting(),
    );

    process.env.MCP_TOOL_TIMEOUT = 'not-a-number';
    assert(
      _getMcpToolTimeoutMsForTesting() === 600000,
      'Invalid MCP_TOOL_TIMEOUT should fall back to the default',
      _getMcpToolTimeoutMsForTesting(),
    );

    process.env.MCP_TOOL_TIMEOUT = '-1';
    assert(
      _getMcpToolTimeoutMsForTesting() === 600000,
      'Negative MCP_TOOL_TIMEOUT should fall back to the default',
      _getMcpToolTimeoutMsForTesting(),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.MCP_TOOL_TIMEOUT;
    } else {
      process.env.MCP_TOOL_TIMEOUT = previous;
    }
  }
}

async function checkPluginAvailableDiagnostics() {
  const { available, warning } = await _loadAvailablePluginsForTesting({
    loadConfig: async () => ({}),
    loadInstallCounts: async () => new Map(),
    loadMarketplaces: async () => {
      throw new Error('simulated marketplace failure');
    },
    isPluginInstalledFn: () => false,
  });

  assert(
    Array.isArray(available) && available.length === 0,
    'plugin list --available degraded path should return no available plugins',
    available,
  );
  assert(
    typeof warning === 'string' &&
      warning.includes('PLUGIN_AVAILABLE_DEGRADED'),
    'plugin list --available degraded path should return a visible warning',
    warning,
  );
  assert(
    warning.includes('marketplaces_load_failed'),
    'plugin list --available degraded warning should include reason details',
    warning,
  );

  const jsonPayload = JSON.stringify({ installed: [], available });
  assert(
    JSON.parse(jsonPayload).available.length === 0,
    'plugin list --available JSON output should remain parseable',
    jsonPayload,
  );
  assert(
    _formatAvailablePluginsWarningForTesting(['marketplaces_load_failed']).includes(
      'PLUGIN_AVAILABLE_DEGRADED',
    ),
    'plugin warning formatter should include a stable error code',
  );
}

function checkPluginAutoupdateDiagnostics() {
  const previousDebug = process.env.DEBUG;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    stderrChunks.push(String(chunk));
    if (typeof args[1] === 'function') {
      args[1]();
    }
    return true;
  };
  try {
    delete process.env.DEBUG;
    _resetPluginAutoupdateWarningStateForTesting();
    _emitPluginAutoupdateWarningForTesting(['alpha', 'beta'], 1000);
    _emitPluginAutoupdateWarningForTesting(['beta', 'alpha'], 2000);
    const dedupedOutput = stderrChunks.join('');
    assert(
      dedupedOutput.match(/PLUGIN_AUTOUPDATE_REFRESH_FAILED/g)?.length === 1,
      'plugin autoupdate warning should be deduplicated within TTL',
      dedupedOutput,
    );

    _emitPluginAutoupdateWarningForTesting(['alpha', 'beta'], 1000 + 6 * 60 * 1000);
    const output = stderrChunks.join('');
    assert(
      output.includes('PLUGIN_AUTOUPDATE_REFRESH_FAILED') &&
        output.includes('alpha, beta'),
      'plugin autoupdate warning should be visible and include failed marketplace names',
      output,
    );
    assert(
      output.match(/PLUGIN_AUTOUPDATE_REFRESH_FAILED/g)?.length === 2,
      'plugin autoupdate warning should be emitted again after TTL',
      output,
    );
    assert(
      _formatPluginAutoupdateWarningForTesting(['alpha']).includes(
        'PLUGIN_AUTOUPDATE_REFRESH_FAILED',
      ),
      'plugin autoupdate warning formatter should include a stable error code',
    );
  } finally {
    process.stderr.write = originalStderrWrite;
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  }
}

function checkResumeDiagnostics() {
  const previousDebug = process.env.DEBUG;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    stderrChunks.push(String(chunk));
    if (typeof args[1] === 'function') {
      args[1]();
    }
    return true;
  };
  try {
    const message = _formatResumeListLoadFailureForTesting(
      new Error('invalid transcript json parse error'),
    );
    assert(
      message.includes('SESSION_LIST_LOAD_PARSE_ERROR'),
      'resume list failure should include parse-specific stable error code',
      message,
    );
    assert(
      _classifyResumeListLoadErrorForTesting({ code: 'EACCES' }) ===
        'SESSION_LIST_LOAD_PERMISSION_ERROR',
      'resume list failure classifier should detect permission errors',
    );
    assert(
      _classifyResumeListLoadErrorForTesting({ code: 'ENOENT' }) ===
        'SESSION_LIST_LOAD_IO_ERROR',
      'resume list failure classifier should detect I/O errors',
    );

    delete process.env.DEBUG;
    _logResumeListLoadFailureForTesting(new Error('hidden by default'));
    assert(
      stderrChunks.length === 0,
      'resume list debug diagnostics should be silent without debug',
      stderrChunks,
    );

    process.env.DEBUG = '1';
    _logResumeListLoadFailureForTesting(new Error('visible in debug'));
    const output = stderrChunks.join('');
    assert(
      output.includes('[resume] failed to load conversation list') &&
        output.includes('visible in debug'),
      'resume list debug diagnostics should include error details when debug is enabled',
      output,
    );
  } finally {
    process.stderr.write = originalStderrWrite;
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  }
}

function checkForkSubagentRuntimeGate() {
  assert(
    _isForkSubagentEnabledForTesting({
      featureEnabled: true,
      userType: 'ant',
      isCoordinator: false,
      isNonInteractive: false,
    }),
    'fork subagent should be enabled for internal users when feature is on',
  );

  assert(
    !_isForkSubagentEnabledForTesting({
      featureEnabled: true,
      userType: undefined,
      forkSubagentEnv: undefined,
      isCoordinator: false,
      isNonInteractive: false,
    }),
    'fork subagent should be disabled for external builds without opt-in env',
  );

  assert(
    _isForkSubagentEnabledForTesting({
      featureEnabled: true,
      userType: undefined,
      forkSubagentEnv: '1',
      isCoordinator: false,
      isNonInteractive: false,
    }),
    'fork subagent should be enabled for external builds with explicit env opt-in',
  );

  assert(
    !_isForkSubagentEnabledForTesting({
      featureEnabled: true,
      userType: 'ant',
      isCoordinator: false,
      isNonInteractive: true,
    }),
    'fork subagent should remain disabled in non-interactive mode',
  );
}

async function checkQueryEnginePermissionDenialsAreTurnScoped() {
  const wrapperDecisions = [{ behavior: 'deny' }, { behavior: 'allow' }];
  const baseCanUseTool = async () =>
    wrapperDecisions.shift() ?? { behavior: 'allow' };

  const turn1Denials = [];
  const turn1CanUseTool = _createTurnScopedCanUseToolForTesting(
    baseCanUseTool,
    turn1Denials,
  );
  await turn1CanUseTool(
    { name: 'bash' },
    { command: 'ls' },
    {},
    {},
    'turn-1-tool-use',
  );
  assert(
    turn1Denials.length === 1 &&
      turn1Denials[0]?.tool_use_id === 'turn-1-tool-use',
    'QueryEngine should report permission denials for the active turn',
    turn1Denials,
  );

  const turn2Denials = [];
  const turn2CanUseTool = _createTurnScopedCanUseToolForTesting(
    baseCanUseTool,
    turn2Denials,
  );
  await turn2CanUseTool(
    { name: 'bash' },
    { command: 'pwd' },
    {},
    {},
    'turn-2-tool-use',
  );
  assert(
    turn2Denials.length === 0,
    'QueryEngine should not leak permission denials from previous turns',
    { turn1Denials, turn2Denials },
  );

  const previousSessionPersistenceDisabled = isSessionPersistenceDisabled();
  const previousNodeEnv = process.env.NODE_ENV;
  let appState = getDefaultAppState();
  const submitDecisions = [{ behavior: 'deny' }, { behavior: 'allow' }];
  const submitCanUseTool = async () =>
    submitDecisions.shift() ?? { behavior: 'allow' };
  const queryRunner = async function* ({ canUseTool, toolUseContext }) {
    await canUseTool(
      { name: 'bash' },
      { command: 'runtime-health' },
      toolUseContext,
      {},
      `submit-turn-${submitDecisions.length}`,
    );
    yield createAssistantMessage({ content: 'ok' });
  };
  const engine = new QueryEngine({
    cwd: repoRoot,
    tools: [],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: submitCanUseTool,
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState);
    },
    readFileCache: createFileStateCacheWithSizeLimit(10),
    customSystemPrompt: '',
    thinkingConfig: { type: 'disabled' },
    queryRunner,
  });

  try {
    process.env.NODE_ENV = 'test';
    setSessionPersistenceDisabled(true);
    const turn1Messages = [];
    for await (const message of engine.submitMessage('turn 1')) {
      turn1Messages.push(message);
    }
    const turn1Result = turn1Messages.find(message => message.type === 'result');
    assert(
      turn1Result?.permission_denials?.length === 1,
      'QueryEngine.submitMessage should return active-turn permission denials',
      turn1Result,
    );

    const turn2Messages = [];
    for await (const message of engine.submitMessage('turn 2')) {
      turn2Messages.push(message);
    }
    const turn2Result = turn2Messages.find(message => message.type === 'result');
    assert(
      Array.isArray(turn2Result?.permission_denials) &&
        turn2Result.permission_denials.length === 0,
      'QueryEngine.submitMessage should clear permission denials between turns',
      { turn1Result, turn2Result },
    );
  } finally {
    setSessionPersistenceDisabled(previousSessionPersistenceDisabled);
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
}

async function checkStartupBannerDiagnostics() {
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const previousDebug = process.env.DEBUG;
  const previousDebugSdk = process.env.DEBUG_SDK;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stderr.write = (chunk, ...args) => {
    stderrChunks.push(String(chunk));
    if (typeof args[1] === 'function') {
      args[1]();
    }
    return true;
  };

  const runtimeDir = mkdtempSync(join(tmpdir(), 'claude-agent-startup-banner-'));
  const settingsPath = join(runtimeDir, STARTUP_BANNER_SETTINGS_FILENAME);

  try {
    process.env.CLAUDE_CONFIG_DIR = runtimeDir;
    delete process.env.DEBUG;
    delete process.env.DEBUG_SDK;
    writeFileSync(settingsPath, '{bad-json', 'utf8');

    const mode = getStartupBannerMode();
    assert(mode === null, 'startup banner mode should degrade to null on invalid config');
    assert(
      stderrChunks.length === 0,
      'startup banner diagnostics should be silent when debug is disabled',
      stderrChunks.join(''),
    );

    process.env.DEBUG = '1';
    void getStartupBannerMode();
    assert(
      stderrChunks.join('').includes('[startup-banner] failed to read startup banner settings'),
      'startup banner diagnostics should log in debug mode',
      stderrChunks.join(''),
    );

    stderrChunks.length = 0;
    writeFileSync(settingsPath, '{bad-json', 'utf8');
    await callStartupBannerCommand('claude');
    assert(
      stderrChunks.join('').includes('[startup-banner-command] failed to parse startup banner settings'),
      'startup banner command should log parse diagnostics in debug mode',
      stderrChunks.join(''),
    );

    const nonDirectoryConfigDir = join(runtimeDir, 'not-a-directory');
    writeFileSync(nonDirectoryConfigDir, 'x', 'utf8');
    process.env.CLAUDE_CONFIG_DIR = nonDirectoryConfigDir;
    const writeFailure = await callStartupBannerCommand('claude');
    assert(
      writeFailure.value.startsWith('Error:'),
      'startup banner command should surface write failures to the user',
      writeFailure,
    );
  } finally {
    process.stderr.write = originalStderrWrite;
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
    if (previousDebugSdk === undefined) {
      delete process.env.DEBUG_SDK;
    } else {
      process.env.DEBUG_SDK = previousDebugSdk;
    }
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

function checkStartupPrefetchDiagnosticsDebugSignals() {
  const mainSource = readFileSync(join(repoRoot, 'src/main.tsx'), 'utf8');
  assert(
    mainSource.includes('isDebugDiagnosticsEnabled({') &&
      mainSource.includes('includeLauncherDebug: true'),
    'Startup prefetch diagnostics should use shared debug diagnostics helper',
  );
  const helperSource = readFileSync(
    join(repoRoot, 'src/utils/debugDiagnostics.ts'),
    'utf8',
  );
  assert(
    helperSource.includes('process.env.DEBUG') &&
      helperSource.includes('process.env.DEBUG_SDK'),
    'Shared debug diagnostics helper should honor DEBUG and DEBUG_SDK',
  );
}

async function checkCleanupTimeoutDiagnostics() {
  const previousDebug = process.env.DEBUG;
  const stderrChunks = [];
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.env.DEBUG = '1';
  process.stderr.write = (chunk, ...args) => {
    stderrChunks.push(String(chunk));
    if (typeof args[1] === 'function') {
      args[1]();
    }
    return true;
  };

  try {
    const startMs = Date.now();
    await _runCleanupFunctionForTesting(async function runtimeHealthCleanupTimeout() {
      await new Promise(resolve => setTimeout(resolve, 2100));
    });
    const elapsedMs = Date.now() - startMs;

    assert(
      elapsedMs < 2600,
      'Cleanup timeout diagnostic check exceeded expected timeout budget',
      { elapsedMs },
    );

    const stderrOutput = stderrChunks.join('');
    assert(
      stderrOutput.includes('[cleanupRegistry] cleanup "runtimeHealthCleanupTimeout" failed: cleanup timed out'),
      'Missing cleanup timeout diagnostic log',
      stderrOutput,
    );
  } finally {
    process.stderr.write = originalStderrWrite;
    if (previousDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = previousDebug;
    }
  }
}

console.log('Checking sandbox runtime compatibility...');
checkSandboxCompatibility();

console.log('Checking session utility chain invariants...');
checkSessionUtilities();

console.log('Checking history search helpers...');
checkHistorySearchUtilities();

console.log('Checking fullscreen env toggle helpers...');
checkFullscreenEnvToggleUtilities();

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

console.log('Checking MCP auth cache concurrency...');
await checkMcpAuthCacheConcurrency();

console.log('Checking MCP tool timeout defaults...');
checkMcpToolTimeoutDefault();

console.log('Checking plugin available degradation diagnostics...');
await checkPluginAvailableDiagnostics();

console.log('Checking plugin autoupdate degradation diagnostics...');
checkPluginAutoupdateDiagnostics();

console.log('Checking resume diagnostics...');
checkResumeDiagnostics();

console.log('Checking fork subagent runtime gate...');
checkForkSubagentRuntimeGate();

console.log('Checking QueryEngine permission denial scoping...');
await checkQueryEnginePermissionDenialsAreTurnScoped();

console.log('Checking startup prefetch diagnostics debug signals...');
checkStartupPrefetchDiagnosticsDebugSignals();

console.log('Checking startup banner diagnostics...');
await checkStartupBannerDiagnostics();

console.log('Checking cleanup timeout diagnostics...');
await checkCleanupTimeoutDiagnostics();

console.log('Runtime health checks passed.');
process.exit(0);
