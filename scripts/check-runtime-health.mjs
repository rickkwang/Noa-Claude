#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as fs from 'fs/promises';
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
import { getSystemPrompt } from '../src/constants/prompts.ts';
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
  _filterCustomTitleMatchesForTesting,
  isChainParticipant,
  isTranscriptMessage,
  restoreSessionMetadata,
} from '../src/utils/sessionStorage.ts';
import { getOriginalCwd } from '../src/bootstrap/state.ts';
import { applyLauncherDefaults, DEFAULT_PRODUCT_DIR } from '../launcher-config.js';
import { enableConfigs } from '../src/utils/config.ts';
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
  _shouldShowResumeSummaryGateForTesting,
} from '../src/commands/resume/resume.tsx';
import { executeEffort } from '../src/commands/effort/effort.tsx';
import { isForkSubagentEnabled } from '../src/tools/AgentTool/forkSubagent.ts';
import { _checkFindExecDeleteForTesting } from '../src/tools/BashTool/pathValidation.ts';
import {
  RESUME_SUMMARY_GATE_LARGE_BYTES,
  RESUME_SUMMARY_GATE_STALE_MS,
  shouldUseResumeSummaryGate,
} from '../src/utils/resumeSummaryGate.ts';
import { isDangerousRemovalPath } from '../src/utils/permissions/pathValidation.ts';
import { homedir } from 'os';
import { _getThinkingTextForTesting } from '../src/components/Spinner/SpinnerAnimationRow.tsx';
import { _get3PFallbackSuggestionForTesting } from '../src/utils/model/validateModel.ts';
import { getPublicModelDisplayName, getDefaultOpusModel, getBestModel } from '../src/utils/model/model.ts';
import { getModelStrings } from '../src/utils/model/modelStrings.ts';
import {
  getDefaultEffortForModel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  modelSupportsXhighEffort,
  resolveAppliedEffort,
} from '../src/utils/effort.ts';
import { modelSupportsAdaptiveThinking } from '../src/utils/thinking.ts';
import { getAPIContextManagement } from '../src/services/compact/apiMicrocompact.ts';
import {
  _convertFileNameToDateForTesting,
  _addCleanupResultsForTesting,
  cleanupOldTaskFiles,
} from '../src/utils/cleanup.ts';

applyLauncherDefaults();
globalThis.MACRO ??= {
  VERSION: '0.0.0-runtime-health',
  DISPLAY_VERSION: '0.0.0-runtime-health',
  BUILD_TIME: '',
  PACKAGE_URL: '',
};

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
  const workdir = mkdtempSync(join(tmpdir(), 'noa-rg-'));
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

  const runtimeDir = mkdtempSync(join(tmpdir(), 'noa-compact-resume-'));
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
  const invalidBaseDir = mkdtempSync(join(tmpdir(), 'noa-invalid-base-'));
  const missingTokenDir = mkdtempSync(join(tmpdir(), 'noa-missing-token-'));
  const oauthFallbackDir = mkdtempSync(join(tmpdir(), 'noa-oauth-fallback-'));

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

  const malformedDir = mkdtempSync(join(tmpdir(), 'noa-resume-malformed-'));
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
  const runtimeDir = mkdtempSync(join(tmpdir(), 'noa-mcp-timeout-'));
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
    const timeoutOutput = `${timeoutRun.stderr || ''}${timeoutRun.stdout || ''}`;
    assert(
      timeoutRun.status === 124 ||
        timeoutRun.status === 0 ||
        (
          timeoutRun.status === 1 &&
          timeoutOutput.includes('[MCP_TIMEOUT]') &&
          timeoutOutput.includes('regular MCP not ready after 400ms')
        ),
      'MCP timeout fallback smoke run returned unexpected status',
      timeoutOutput,
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
  const previousForkSubagentEnv = process.env.CLAUDE_CODE_FORK_SUBAGENT;
  const previousUserType = process.env.USER_TYPE;
  try {
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT;
    delete process.env.USER_TYPE;
    assert(
      !isForkSubagentEnabled(),
      'fork subagent should be disabled in this build',
    );

    process.env.CLAUDE_CODE_FORK_SUBAGENT = '1';
    assert(
      !isForkSubagentEnabled(),
      'CLAUDE_CODE_FORK_SUBAGENT should not unlock fork subagents in this build',
    );

    process.env.USER_TYPE = 'ant';
    assert(
      !isForkSubagentEnabled(),
      'internal user type should not unlock fork subagents in this build',
    );
  } finally {
    if (previousForkSubagentEnv === undefined) {
      delete process.env.CLAUDE_CODE_FORK_SUBAGENT;
    } else {
      process.env.CLAUDE_CODE_FORK_SUBAGENT = previousForkSubagentEnv;
    }
    if (previousUserType === undefined) {
      delete process.env.USER_TYPE;
    } else {
      process.env.USER_TYPE = previousUserType;
    }
  }
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

  const previousApiKey = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.NODE_ENV = 'test';
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test-runtime-check';
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
    if (previousApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previousApiKey;
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

  const runtimeDir = mkdtempSync(join(tmpdir(), 'noa-startup-banner-'));
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

function checkResumeSummaryGatePredicate() {
  const now = Date.now();
  const staleModified = new Date(now - RESUME_SUMMARY_GATE_STALE_MS - 1_000);
  const freshModified = new Date(now - 1_000);
  const staleLargeWithSummary = {
    modified: staleModified,
    fileSize: RESUME_SUMMARY_GATE_LARGE_BYTES,
    summary: 'stale session summary',
  };

  assert(
    shouldUseResumeSummaryGate(staleLargeWithSummary, now),
    'stale+large sessions with summary should trigger resume summary gate',
  );

  assert(
    _shouldShowResumeSummaryGateForTesting(staleLargeWithSummary),
    'resume command paths should use the shared summary gate predicate',
  );

  assert(
    !shouldUseResumeSummaryGate({
      modified: freshModified,
      fileSize: RESUME_SUMMARY_GATE_LARGE_BYTES,
      summary: 'recent session summary',
    }, now),
    'fresh sessions should not trigger resume summary gate',
  );

  assert(
    !shouldUseResumeSummaryGate({
      modified: staleModified,
      fileSize: RESUME_SUMMARY_GATE_LARGE_BYTES - 1,
      summary: 'small session summary',
    }, now),
    'small sessions should not trigger resume summary gate',
  );

  assert(
    !shouldUseResumeSummaryGate({
      modified: staleModified,
      fileSize: RESUME_SUMMARY_GATE_LARGE_BYTES,
      summary: '',
    }, now),
    'sessions without summary should not trigger resume summary gate',
  );
}

function checkCustomTitleMatchHelpers() {
  const makeLog = (sessionId, customTitle, modified) => ({
    date: new Date(modified).toISOString(),
    messages: [],
    value: 0,
    created: new Date(modified),
    modified: new Date(modified),
    firstPrompt: '',
    messageCount: 0,
    isSidechain: false,
    sessionId,
    customTitle,
  });
  const logs = [
    makeLog('11111111-1111-1111-1111-111111111111', 'Target', 1_000),
    makeLog('11111111-1111-1111-1111-111111111111', 'Target', 2_000),
    makeLog('22222222-2222-2222-2222-222222222222', 'Target', 1_500),
    makeLog('33333333-3333-3333-3333-333333333333', 'Target', 3_000),
  ];

  const allMatches = _filterCustomTitleMatchesForTesting(logs, 'target', {
    exact: true,
  });
  assert(
    allMatches.map(log => log.sessionId).join(',') ===
      [
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ].join(','),
    'custom title matching should dedupe by session and sort by recency by default',
  );

  const earlyMatches = _filterCustomTitleMatchesForTesting(logs, 'target', {
    exact: true,
    stopAfterDistinctMatches: 2,
  });
  assert(
    earlyMatches.length === 2 &&
      earlyMatches.some(
        log => log.sessionId === '11111111-1111-1111-1111-111111111111',
      ) &&
      earlyMatches.some(
        log => log.sessionId === '22222222-2222-2222-2222-222222222222',
      ),
    'custom title early-stop matching should stop after two distinct sessions',
  );
}

// ============================================================================
// Priority 1: model fallback suggestion (3P path)
// ============================================================================
function checkModelFallbackSuggestions() {
  // Set provider to 3P so get3PFallbackSuggestion returns actual fallback chains.
  // This env var must be set before any model module is imported (they cache state).
  const prev = process.env.CLAUDE_CODE_USE_OPENAI;
  try {
    process.env.CLAUDE_CODE_USE_OPENAI = '1';
    // Re-import with 3P provider set — imports are cached, so we call the
    // function directly (it reads getAPIProvider() at call time, not import time).
    assert(
      _get3PFallbackSuggestionForTesting('opus-5') === 'claude-opus-4-8',
      'opus-5 should fallback to opus-4-8',
    );
    assert(
      _get3PFallbackSuggestionForTesting('opus-4-8') === 'claude-opus-4-7',
      'opus-4-8 should fallback to opus-4-7',
    );
    assert(
      _get3PFallbackSuggestionForTesting('opus-4-7') === 'claude-opus-4-6',
      'opus-4-7 should fallback to opus-4-6',
    );
    assert(
      _get3PFallbackSuggestionForTesting('OPUS-4-7') === 'claude-opus-4-6',
      'opus-4-7 (uppercase) should fallback to opus-4-6',
    );
    assert(
      _get3PFallbackSuggestionForTesting('opus_4_7') === 'claude-opus-4-6',
      'opus_4_7 (underscore) should fallback to opus-4-6',
    );
    assert(
      _get3PFallbackSuggestionForTesting('opus-4-6') === 'claude-opus-4-5-20251101',
      'opus-4-6 should fallback to opus-4-5-20251101',
    );
    assert(
      _get3PFallbackSuggestionForTesting('opus-4-5') === 'claude-opus-4-1-20250805',
      'opus-4-5 should fallback to opus-4-1-20250805',
    );
    assert(
      _get3PFallbackSuggestionForTesting('sonnet-4-6') === 'claude-sonnet-4-5-20250929',
      'sonnet-4-6 should fallback to sonnet-4-5-20250929',
    );
    assert(
      _get3PFallbackSuggestionForTesting('sonnet-4-5') === 'claude-sonnet-4-20250514',
      'sonnet-4-5 should fallback to sonnet-4-20250514',
    );
    assert(
      _get3PFallbackSuggestionForTesting('claude-3-5-sonnet') === undefined,
      'old model with no mapping should return undefined',
    );
    assert(
      _get3PFallbackSuggestionForTesting(undefined) === undefined,
      'undefined model should return undefined',
    );
    assert(
      _get3PFallbackSuggestionForTesting('') === undefined,
      'empty model should return undefined',
    );
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_USE_OPENAI;
    else process.env.CLAUDE_CODE_USE_OPENAI = prev;
  }
}

// ============================================================================
// Opus: user-facing path coverage (currently Opus 4.7 / 4.8 first-party default)
// ============================================================================
function checkOpusUserPaths() {
  const prevUseBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
  const prevUseVertex = process.env.CLAUDE_CODE_USE_VERTEX;
  const prevUseFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY;
  const prevUseOpenAI = process.env.CLAUDE_CODE_USE_OPENAI;
  const prevBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const prevUserType = process.env.USER_TYPE;
  const prevDefaultOpusModel = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  const prevDefaultOpusCapabilities =
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES;
  delete process.env.CLAUDE_CODE_USE_BEDROCK;
  delete process.env.CLAUDE_CODE_USE_VERTEX;
  delete process.env.CLAUDE_CODE_USE_FOUNDRY;
  delete process.env.CLAUDE_CODE_USE_OPENAI;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.USER_TYPE;
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES;
  try {
  // getPublicModelDisplayName for opus-4-7
  const opus47DisplayName = getPublicModelDisplayName(getModelStrings().opus47);
  assert(opus47DisplayName === 'Opus 4.7', `getPublicModelDisplayName(opus47) should return 'Opus 4.7', got: ${opus47DisplayName}`);
  const opus47_1mDisplayName = getPublicModelDisplayName(getModelStrings().opus47 + '[1m]');
  assert(opus47_1mDisplayName === 'Opus 4.7 (1M context)', `opus47[1m] display name should be 'Opus 4.7 (1M context)', got: ${opus47_1mDisplayName}`);

  // getPublicModelDisplayName for opus-5
  const opus5DisplayName = getPublicModelDisplayName(getModelStrings().opus5);
  assert(opus5DisplayName === 'Opus 5', `getPublicModelDisplayName(opus5) should return 'Opus 5', got: ${opus5DisplayName}`);
  const opus5_1mDisplayName = getPublicModelDisplayName(getModelStrings().opus5 + '[1m]');
  assert(opus5_1mDisplayName === 'Opus 5 (1M context)', `opus5[1m] display name should be 'Opus 5 (1M context)', got: ${opus5_1mDisplayName}`);

  // getDefaultOpusModel — first-party path returns the current Opus default
  const defaultOpus = getDefaultOpusModel();
  assert(defaultOpus === getModelStrings().opus5, `getDefaultOpusModel() should return opus5 for first-party, got: ${defaultOpus}`);

  // getBestModel is an alias for getDefaultOpusModel
  const bestModel = getBestModel();
  assert(bestModel === getModelStrings().opus5, `getBestModel() should equal opus5 for first-party, got: ${bestModel}`);

  // Opus 5 carries the full effort ladder (low..max, including xhigh).
  assert(modelSupportsEffort('claude-opus-5') === true, 'claude-opus-5 should support effort');
  assert(modelSupportsMaxEffort('claude-opus-5') === true, 'claude-opus-5 should support max effort');
  assert(modelSupportsXhighEffort('claude-opus-5') === true, 'claude-opus-5 should support xhigh effort');
  // Like Opus 4.8, Opus 5 does not force a default — the API resolves unset to high.
  assert(
    getDefaultEffortForModel('claude-opus-5') === undefined,
    'claude-opus-5 should not force a default effort',
  );
  assert(
    modelSupportsAdaptiveThinking('claude-opus-5') === true,
    'claude-opus-5 should support adaptive thinking',
  );

  // modelSupportsEffort for opus-4-7
  assert(modelSupportsEffort('opus-4-7') === true, 'opus-4-7 should support effort');
  assert(modelSupportsEffort('claude-opus-4-7') === true, 'claude-opus-4-7 should support effort');

  // modelSupportsMaxEffort for opus-4-7
  assert(modelSupportsMaxEffort('opus-4-7') === true, 'opus-4-7 should support max effort');
  assert(modelSupportsMaxEffort('claude-opus-4-7') === true, 'claude-opus-4-7 should support max effort');

  // modelSupportsXhighEffort for opus-4-7 (xhigh is 4.7-exclusive per docs)
  assert(modelSupportsXhighEffort('opus-4-7') === true, 'opus-4-7 should support xhigh effort');
  assert(modelSupportsXhighEffort('claude-opus-4-7') === true, 'claude-opus-4-7 should support xhigh effort');
  assert(modelSupportsXhighEffort('claude-opus-4-6') === false, 'opus-4-6 should not support xhigh effort');
  assert(modelSupportsXhighEffort('claude-sonnet-4-6') === false, 'sonnet-4-6 should not support xhigh effort');

  // External default effort for Opus 4.7 is xhigh (per c9bd1d7 "feat(effort):
  // add xhigh level for Opus 4.7"). Source: src/utils/effort.ts:400-402.
  assert(
    getDefaultEffortForModel('claude-opus-4-7') === 'xhigh',
    'claude-opus-4-7 should default to xhigh effort for first-party external users',
  );
  assert(
    resolveAppliedEffort('claude-opus-4-7', undefined) === 'xhigh',
    'claude-opus-4-7 should resolve to xhigh effort by default for first-party external users',
  );
  assert(
    getDefaultEffortForModel('claude-opus-4-6') === undefined,
    'claude-opus-4-6 should not force a default effort',
  );
  assert(
    resolveAppliedEffort('claude-opus-4-6', undefined) === undefined,
    'claude-opus-4-6 should not inject effort by default',
  );

  // Opus 4.7 should use adaptive thinking.
  assert(
    modelSupportsAdaptiveThinking('claude-opus-4-7') === true,
    'claude-opus-4-7 should support adaptive thinking',
  );
  } finally {
    if (prevUseBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = prevUseBedrock;
    if (prevUseVertex === undefined) delete process.env.CLAUDE_CODE_USE_VERTEX;
    else process.env.CLAUDE_CODE_USE_VERTEX = prevUseVertex;
    if (prevUseFoundry === undefined) delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    else process.env.CLAUDE_CODE_USE_FOUNDRY = prevUseFoundry;
    if (prevUseOpenAI === undefined) delete process.env.CLAUDE_CODE_USE_OPENAI;
    else process.env.CLAUDE_CODE_USE_OPENAI = prevUseOpenAI;
    if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prevBaseUrl;
    if (prevUserType === undefined) delete process.env.USER_TYPE;
    else process.env.USER_TYPE = prevUserType;
    if (prevDefaultOpusModel === undefined)
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    else process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = prevDefaultOpusModel;
    if (prevDefaultOpusCapabilities === undefined)
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES;
    else
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
        prevDefaultOpusCapabilities;
  }
}

function checkOpus47ThirdPartyEffortDefaults() {
  const prevUseBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
  const prevBaseUrl = process.env.ANTHROPIC_BASE_URL;
  const prevPinnedOpus = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  const prevPinnedCapabilities =
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES;
  const prevUserType = process.env.USER_TYPE;
  try {
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.USER_TYPE;
    process.env.ANTHROPIC_BASE_URL =
      'https://proxy.example.test/anthropic';
    // Effort is gated by provider (see effort.ts:69-74 / commit 92c29ad).
    // Without an explicit capability override the proxy is treated as
    // "unknown" — neither support nor default effort.
    assert(
      modelSupportsEffort('claude-opus-4-7') === false,
      'ANTHROPIC_BASE_URL proxy should NOT support effort without an explicit effort capability override',
    );
    assert(
      getDefaultEffortForModel('claude-opus-4-7') === undefined,
      'ANTHROPIC_BASE_URL proxy should not default opus-4-7 effort without an explicit effort capability override',
    );
    assert(
      resolveAppliedEffort('claude-opus-4-7', undefined) === undefined,
      'ANTHROPIC_BASE_URL proxy should not inject opus-4-7 effort without an explicit effort capability override',
    );
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'claude-opus-4-7';
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'effort,max_effort,adaptive_thinking';
    assert(
      modelSupportsEffort('claude-opus-4-7') === true,
      'ANTHROPIC_BASE_URL proxy with effort capability should support effort',
    );
    // No xhigh capability advertised, so the xhigh-only first-party default
    // path in effort.ts:400-402 is skipped — proxy falls through to
    // undefined (API-side default). Don't inject xhigh on a proxy that
    // didn't advertise it.
    assert(
      getDefaultEffortForModel('claude-opus-4-7') === undefined,
      'ANTHROPIC_BASE_URL proxy without xhigh capability should not inject a default effort',
    );
    assert(
      resolveAppliedEffort('claude-opus-4-7', undefined) === undefined,
      'ANTHROPIC_BASE_URL proxy without xhigh capability should not inject a default effort at resolve time',
    );
    const supportedProxyEffort = executeEffort('max', 'claude-opus-4-7');
    assert(
      supportedProxyEffort.effortUpdate?.value === 'max',
      '/effort max should be accepted when an ANTHROPIC_BASE_URL proxy advertises max_effort',
    );
    if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prevBaseUrl;

    process.env.CLAUDE_CODE_USE_BEDROCK = '1';

    const unsupported3PModel =
      'anthropic.claude-opus-4-7-runtime-health-no-max';
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES;
    assert(
      getDefaultEffortForModel(unsupported3PModel) === 'xhigh',
      'Bedrock opus-4-7 should default to xhigh via the provider allowlist',
    );
    assert(
      resolveAppliedEffort(unsupported3PModel, undefined) === 'xhigh',
      'Bedrock opus-4-7 should resolve to xhigh via the provider allowlist',
    );

    const effortOnly3PModel =
      'anthropic.claude-opus-4-7-runtime-health-effort-only';
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = effortOnly3PModel;
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'effort';
    assert(
      modelSupportsEffort(effortOnly3PModel) === true,
      '3P effort capability should still allow base effort support',
    );
    assert(
      modelSupportsMaxEffort(effortOnly3PModel) === false,
      '3P effort capability should not imply max effort support',
    );
    assert(
      resolveAppliedEffort(effortOnly3PModel, 'max') === 'high',
      '3P effort-only models should clamp a stale max setting to high',
    );
    const effortOnlyMaxCommand = executeEffort('max', effortOnly3PModel);
    assert(
      effortOnlyMaxCommand.effortUpdate?.value === 'max' &&
        effortOnlyMaxCommand.message.includes('current model will use high'),
      '/effort max should save the cross-model preference and surface the clamp on a 3P effort-only model',
    );

    const supported3PModel =
      'anthropic.claude-opus-4-7-runtime-health-with-max';
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = supported3PModel;
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
      'max_effort';
    assert(
      modelSupportsEffort(supported3PModel) === true,
      '3P max_effort capability should still allow base effort support',
    );
    // 3P opus-4-7 with max_effort but no xhigh capability keeps the legacy
    // "unset/high" path (effort.ts:397-402 — only xhigh-capable providers get
    // an explicit default). API still resolves missing effort to high.
    assert(
      getDefaultEffortForModel(supported3PModel) === undefined,
      '3P opus-4-7 should not inject an explicit default unless xhigh is advertised',
    );
  } finally {
    if (prevUseBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
    else process.env.CLAUDE_CODE_USE_BEDROCK = prevUseBedrock;
    if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prevBaseUrl;
    if (prevPinnedOpus === undefined) delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    else process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = prevPinnedOpus;
    if (prevPinnedCapabilities === undefined) {
      delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES;
    } else {
      process.env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES =
        prevPinnedCapabilities;
    }
    if (prevUserType === undefined) delete process.env.USER_TYPE;
    else process.env.USER_TYPE = prevUserType;
  }
}

async function checkQualityRegressionGuards() {
  const prevUserType = process.env.USER_TYPE;
  let assembledExternalPrompt = '';
  try {
    enableConfigs();
    delete process.env.USER_TYPE;
    assembledExternalPrompt = (
      await getSystemPrompt([], 'claude-sonnet-4-6')
    ).join('\n');
  } finally {
    if (prevUserType === undefined) delete process.env.USER_TYPE;
    else process.env.USER_TYPE = prevUserType;
  }

  assert(
    !assembledExternalPrompt.includes('Be extra concise.'),
    'external prompt should not contain the strongest brevity directive',
  );
  assert(
    !assembledExternalPrompt.includes(
      "If you can say it in one sentence, don't use three.",
    ),
    'external prompt should not contain the one-sentence compression directive',
  );
  assert(
    assembledExternalPrompt.includes(
      'Clear first, concise second. Never let brevity reduce accuracy or omit information the reader needs to understand, verify, or act.',
    ),
    'external prompt should preserve concise-but-complete communication guidance',
  );

  const contextManagement = getAPIContextManagement({
    hasThinking: true,
    isRedactThinkingActive: false,
    clearAllThinking: false,
  });
  assert(
    contextManagement?.edits?.[0]?.keep === 'all',
    'default context management should preserve all thinking turns',
  );

  const claudeApiSource = readFileSync(
    resolve('src/services/api/claude.ts'),
    'utf8',
  );
  assert(
    !claudeApiSource.includes('getThinkingClearLatched'),
    'claude API path should not reference latched thinking clear state',
  );
  assert(
    !claudeApiSource.includes('setThinkingClearLatched'),
    'claude API path should not persist thinking clear state',
  );
  assert(
    claudeApiSource.includes('clearAllThinking: false'),
    'claude API path should force non-destructive thinking preservation by default',
  );

  const bootstrapStateSource = readFileSync(
    resolve('src/bootstrap/state.ts'),
    'utf8',
  );
  assert(
    !bootstrapStateSource.includes('thinkingClearLatched'),
    'bootstrap state should no longer store thinking clear latch state',
  );

  const preconnectSource = readFileSync(
    resolve('src/utils/apiPreconnect.ts'),
    'utf8',
  );
  assert(
    preconnectSource.includes('CLAUDE_CODE_USE_OPENAI'),
    'Anthropic API preconnect should skip OpenAI-compatible provider mode',
  );
}

function checkProviderRoutingAndUrlGuards() {
  const providerProfileSource = readFileSync(
    resolve('src/utils/providerProfile.ts'),
    'utf8',
  );
  assert(
    providerProfileSource.includes("'CLAUDE_CODE_USE_BEDROCK'") &&
      providerProfileSource.includes("'CLAUDE_CODE_USE_VERTEX'") &&
      providerProfileSource.includes("'CLAUDE_CODE_USE_FOUNDRY'"),
    'provider profile activation should clear stale cloud provider flags',
  );
  assert(
    providerProfileSource.includes("'ANTHROPIC_BEDROCK_BASE_URL'") &&
      providerProfileSource.includes("'ANTHROPIC_VERTEX_BASE_URL'") &&
      providerProfileSource.includes("'ANTHROPIC_FOUNDRY_BASE_URL'"),
    'provider profile activation should clear stale cloud provider base URLs',
  );
}

// ============================================================================
// Priority 2: dangerous removal path
// ============================================================================
function checkDangerousRemovalPath() {
  // Always dangerous
  assert(isDangerousRemovalPath('*') === true, '* wildcard is dangerous');
  assert(isDangerousRemovalPath('/') === true, 'root / is dangerous');
  assert(isDangerousRemovalPath('/path/to/dir/*') === true, 'glob /* is dangerous');
  assert(isDangerousRemovalPath('C:\\foo\\*') === true, 'Windows glob /* is dangerous');

  // macOS /private/ system dirs are dangerous because dirname(/private/etc) = /private
  assert(isDangerousRemovalPath('/private/etc') === true, 'macOS /private/etc is dangerous');
  assert(isDangerousRemovalPath('/private/var') === true, 'macOS /private/var is dangerous');
  assert(isDangerousRemovalPath('/private/tmp') === true, 'macOS /private/tmp is dangerous');
  assert(isDangerousRemovalPath('/private/usr') === true, 'macOS /private/usr is dangerous');
  // /private itself: dirname('/private') = '/' so it's caught by the root-child check
  assert(isDangerousRemovalPath('/private') === true, '/private is dangerous (direct child of root)');

  // Direct children of root
  assert(isDangerousRemovalPath('/usr') === true, '/usr is direct child of root');
  assert(isDangerousRemovalPath('/tmp') === true, '/tmp is direct child of root');
  assert(isDangerousRemovalPath('/etc') === true, '/etc is direct child of root');
  // Two levels deep is safe
  assert(isDangerousRemovalPath('/usr/local') === false, '/usr/local is safe (2 levels)');
  assert(isDangerousRemovalPath('/tmp/claude') === false, '/tmp/claude is safe');
  assert(isDangerousRemovalPath('/var/log') === false, '/var/log is safe (2 levels)');

  // Home dir
  const home = homedir();
  assert(isDangerousRemovalPath(home) === true, 'home dir is dangerous');
  assert(isDangerousRemovalPath(join(home, 'code')) === false, 'home/subdir is safe');
  assert(isDangerousRemovalPath(join(home, 'code', 'project')) === false, 'home/subdir/subdir is safe');

  // Windows drive roots
  assert(isDangerousRemovalPath('C:\\') === true, 'Windows C:\\ is dangerous');
  assert(isDangerousRemovalPath('D:\\') === true, 'Windows D:\\ is dangerous');
  // Direct children of drive root
  assert(isDangerousRemovalPath('C:\\Windows') === true, 'Windows C:\\Windows is dangerous');
  assert(isDangerousRemovalPath('C:\\Users') === true, 'Windows C:\\Users is dangerous');
  // Two levels deep is safe
  assert(isDangerousRemovalPath('C:\\Windows\\System32') === false, 'Windows C:\\Windows\\System32 is safe');
  assert(isDangerousRemovalPath('C:\\Users\\Admin') === false, 'Windows C:\\Users\\Admin is safe');

  // Safe project paths
  assert(isDangerousRemovalPath('/home/user/project/src') === false, 'nested project path is safe');
  assert(isDangerousRemovalPath('/var/www/html') === false, '/var/www/html is safe');
  // Trailing slash variant
  assert(isDangerousRemovalPath('/usr/') === true, '/usr/ (trailing slash) is dangerous');
}

// ============================================================================
// Priority 3: cleanup utilities
// ============================================================================
async function checkCleanupUtilities() {
  const prevNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'test';

    // Unit: convertFileNameToDate
    const d1 = _convertFileNameToDateForTesting('2024-01-15T10-30-00-000Z.json');
    assert(d1 instanceof Date && !isNaN(d1.getTime()), 'ISO timestamp parsed to valid Date');
    assert(d1.getUTCFullYear() === 2024, 'year correct');
    assert(d1.getUTCMonth() === 0, 'month is January (0-indexed)');
    assert(d1.getUTCDate() === 15, 'day correct');
    assert(d1.getUTCHours() === 10, 'hours correct');
    assert(d1.getUTCMinutes() === 30, 'minutes correct');
    assert(d1.getUTCSeconds() === 0, 'seconds correct');
    assert(d1.getUTCMilliseconds() === 0, 'milliseconds correct');

    const d2 = _convertFileNameToDateForTesting('2023-12-31T23-59-59-999Z.json');
    assert(d2.getUTCFullYear() === 2023, 'year 2023 correct');
    assert(d2.getUTCMonth() === 11, 'month is December');
    assert(d2.getUTCDate() === 31, 'day is 31');

    // Unit: addCleanupResults
    const r1 = _addCleanupResultsForTesting({ messages: 3, errors: 1 }, { messages: 2, errors: 0 });
    assert(r1.messages === 5 && r1.errors === 1, 'addCleanupResults sums correctly');
    const r2 = _addCleanupResultsForTesting({ messages: 0, errors: 0 }, { messages: 10, errors: 5 });
    assert(r2.messages === 10 && r2.errors === 5, 'addCleanupResults handles zero inputs');

    // Integration: cleanupOldTaskFiles — old files deleted, recent files kept
    const workdir = mkdtempSync(join(tmpdir(), 'claude-cleanup-test-'));
    const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = workdir;

    const tasksDir = join(workdir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });

    const oldFile = join(tasksDir, 'old-task.md');
    const newFile = join(tasksDir, 'new-task.md');
    writeFileSync(oldFile, 'old task', 'utf8');
    writeFileSync(newFile, 'new task', 'utf8');

    // Set old file's mtime to 60 days ago
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldFile, new Date(sixtyDaysAgo), new Date(sixtyDaysAgo));

    const oldBefore = existsSync(oldFile);
    const newBefore = existsSync(newFile);
    await cleanupOldTaskFiles();
    const oldAfter = existsSync(oldFile);
    const newAfter = existsSync(newFile);

    process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
    rmSync(workdir, { recursive: true, force: true });

    assert(oldBefore === true && oldAfter === false,
      'old task file should be removed', { oldBefore, oldAfter });
    assert(newBefore === true && newAfter === true,
      'recent task file should be preserved', { newBefore, newAfter });
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
}

// ============================================================================
// Priority 4: find exec/delete security check
// ============================================================================
function checkFindExecDeleteSecurity() {
  // Non-find commands pass through
  const lsResult = _checkFindExecDeleteForTesting('ls -la /');
  assert(lsResult.behavior === 'passthrough', 'ls should passthrough');

  const grepResult = _checkFindExecDeleteForTesting('grep -r "pattern" .');
  assert(grepResult.behavior === 'passthrough', 'grep should passthrough');

  // find without dangerous flags passes through
  const safeFind1 = _checkFindExecDeleteForTesting('find . -name "*.txt"');
  assert(safeFind1.behavior === 'passthrough', 'plain find should passthrough');
  const safeFind2 = _checkFindExecDeleteForTesting('find /home -type f');
  assert(safeFind2.behavior === 'passthrough', 'find with -type f should passthrough');
  const safeFind3 = _checkFindExecDeleteForTesting('find . -mtime +7');
  assert(safeFind3.behavior === 'passthrough', 'find with -mtime should passthrough');

  // -exec triggers ask
  const execFind = _checkFindExecDeleteForTesting('find . -exec rm -rf {} \\;');
  assert(execFind.behavior === 'ask', 'find -exec should ask');
  assert(execFind.message.includes('dangerous action flags'), 'message mentions dangerous flags');

  // -execdir triggers ask
  const execdirFind = _checkFindExecDeleteForTesting('find . -execdir echo {}');
  assert(execdirFind.behavior === 'ask', 'find -execdir should ask');

  // -delete triggers ask
  const deleteFind = _checkFindExecDeleteForTesting('find /tmp -name "*.log" -delete');
  assert(deleteFind.behavior === 'ask', 'find -delete should ask');

  // -ok triggers ask (interactive confirm)
  const okFind = _checkFindExecDeleteForTesting('find . -ok echo {} \\;');
  assert(okFind.behavior === 'ask', 'find -ok should ask');

  // -fls, -fprint, -fprintf triggers ask
  const flsFind = _checkFindExecDeleteForTesting('find . -fls output.txt');
  assert(flsFind.behavior === 'ask', 'find -fls should ask');
  const fprintFind = _checkFindExecDeleteForTesting('find . -fprint output.txt');
  assert(fprintFind.behavior === 'ask', 'find -fprint should ask');
  const fprintfFind = _checkFindExecDeleteForTesting('find . -fprintf output.txt %p');
  assert(fprintfFind.behavior === 'ask', 'find -fprintf should ask');

  // Deep find with -exec mid-command
  const deepFind = _checkFindExecDeleteForTesting('find /var/log -type f -name "*.log" -exec rm {} \\;');
  assert(deepFind.behavior === 'ask', 'deep find with -exec should ask');

  // -fprint0 triggers ask
  const fprint0Find = _checkFindExecDeleteForTesting('find . -fprint0 output.txt');
  assert(fprint0Find.behavior === 'ask', 'find -fprint0 should ask');
}

// ============================================================================
// Priority 5: thinking spinner text thresholds
// ============================================================================
function checkThinkingSpinnerThresholds() {
  const effSuffix = ' (medium effort)';

  // Status: 'thinking' with various elapsed times
  assert(_getThinkingTextForTesting('thinking', 5_000, '') === 'thinking',
    '0-10s: shows "thinking"');
  assert(_getThinkingTextForTesting('thinking', 5_000, effSuffix) === `thinking${effSuffix}`,
    'with effort suffix: appended');
  assert(_getThinkingTextForTesting('thinking', 0, '') === 'thinking',
    '0ms: still shows "thinking"');

  assert(_getThinkingTextForTesting('thinking', 10_000, '') === 'still thinking',
    'at 10s exactly: shows "still thinking"');
  assert(_getThinkingTextForTesting('thinking', 29_999, '') === 'still thinking',
    'just under 30s threshold');

  assert(_getThinkingTextForTesting('thinking', 30_000, '') === 'thinking more',
    'at 30s exactly: shows "thinking more"');
  assert(_getThinkingTextForTesting('thinking', 59_999, '') === 'thinking more',
    'just under 60s threshold');

  assert(_getThinkingTextForTesting('thinking', 60_000, '') === 'almost done thinking',
    'at 60s exactly: shows "almost done thinking"');
  assert(_getThinkingTextForTesting('thinking', 300_000, '') === 'almost done thinking',
    '5min: still "almost done thinking"');

  // Status: number (seconds thought)
  assert(_getThinkingTextForTesting(5_000, 0, '') === 'thought for 5s',
    '5000ms → "thought for 5s"');
  assert(_getThinkingTextForTesting(100, 0, '') === 'thought for 1s',
    'sub-second rounds up to 1s (Math.max(1, ...))');
  assert(_getThinkingTextForTesting(60_000, 0, '') === 'thought for 60s',
    '60s thought');
  assert(_getThinkingTextForTesting(1000, 0, '') === 'thought for 1s',
    '1s exactly');

  // Status: null
  assert(_getThinkingTextForTesting(null, 0, '') === null,
    'null status returns null');
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

console.log('Checking resume summary gate predicate...');
checkResumeSummaryGatePredicate();

console.log('Checking custom title match helpers...');
checkCustomTitleMatchHelpers();

console.log('Checking model fallback suggestions...');
checkModelFallbackSuggestions();

console.log('Checking Opus user paths...');
checkOpusUserPaths();

console.log('Checking Opus 4.7 third-party effort defaults...');
checkOpus47ThirdPartyEffortDefaults();

console.log('Checking quality regression guards...');
await checkQualityRegressionGuards();

console.log('Checking provider routing and URL guards...');
checkProviderRoutingAndUrlGuards();

console.log('Checking dangerous removal path...');
checkDangerousRemovalPath();

console.log('Checking cleanup utilities...');
await checkCleanupUtilities();

console.log('Checking find exec/delete security...');
checkFindExecDeleteSecurity();

console.log('Checking thinking spinner thresholds...');
checkThinkingSpinnerThresholds();

console.log('Runtime health checks passed.');
process.exit(0);
