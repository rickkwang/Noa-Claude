#!/usr/bin/env bun

import { randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';

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

function createRecorder() {
  let lastCall = null;
  return {
    onDone(message, options = {}) {
      lastCall = { message, options };
    },
    getLastCall() {
      return lastCall;
    },
    clear() {
      lastCall = null;
    },
  };
}

const repoRoot = resolve(import.meta.dir, '..');
const tempRoot = mkdtempSync(join(tmpdir(), 'claude-agent-smoke-features-'));
process.env.NODE_ENV = 'test';
process.env.CLAUDE_CONFIG_DIR = join(tempRoot, 'config');

const state = await import('../src/bootstrap/state.ts');
const sessionStorage = await import('../src/utils/sessionStorage.ts');
const workflowCommand = await import('../src/commands/workflows/workflows.ts');
const workflowShared = await import('../src/commands/workflows/shared.ts');
const forkCommand = await import('../src/commands/fork/fork.ts');
const summaryCommand = await import('../src/commands/summary/summary.ts');
const shareCommand = await import('../src/commands/share/share.ts');
const mcpConfig = await import('../src/services/mcp/config.ts');
const productPaths = await import('../src/utils/productPaths.ts');

function prepareProject(projectDir) {
  mkdirSync(projectDir, { recursive: true });
  state.resetStateForTests();
  state.setOriginalCwd(projectDir);
  state.setProjectRoot(projectDir);
  state.setCwdState(projectDir);
  return state.getSessionId();
}

async function runForkSmoke() {
  const projectDir = join(tempRoot, 'fork-project');
  const sessionId = prepareProject(projectDir);
  const transcriptDir = sessionStorage.getProjectDir(projectDir);
  const transcriptPath = sessionStorage.getTranscriptPathForSession(sessionId);
  mkdirSync(transcriptDir, { recursive: true });

  const userUuid = randomUUID();
  const assistantUuid = randomUUID();
  const now = new Date().toISOString();
  const lines = [
    {
      type: 'user',
      uuid: userUuid,
      parentUuid: null,
      sessionId,
      isSidechain: false,
      timestamp: now,
      message: {
        content: [{ type: 'text', text: 'Create a smoke test plan' }],
      },
    },
    {
      type: 'assistant',
      uuid: assistantUuid,
      parentUuid: userUuid,
      sessionId,
      isSidechain: false,
      timestamp: now,
      message: {
        content: [{ type: 'text', text: 'Drafted the plan.' }],
      },
    },
  ];
  writeFileSync(
    transcriptPath,
    `${lines.map(line => JSON.stringify(line)).join('\n')}\n`,
    'utf8',
  );

  const result = await forkCommand.call('feature-smoke');
  assert(result.type === 'text', 'Fork command did not return text output', result);
  assert(
    result.value.includes('Fork created'),
    'Fork command did not report success',
    result.value,
  );
  const match = result.value.match(/Fork session:\s+([0-9a-f-]+)/i);
  assert(match, 'Fork command did not return a fork session id', result.value);
  const forkTranscript = sessionStorage.getTranscriptPathForSession(match[1]);
  assert(
    existsSync(forkTranscript),
    'Fork transcript file was not created',
    forkTranscript,
  );
}

async function runWorkflowSmoke() {
  const projectDir = join(tempRoot, 'workflow-project');
  prepareProject(projectDir);
  const recorder = createRecorder();

  await workflowCommand.call(
    recorder.onDone,
    {},
    'create deploy :: run tests ;; ship {{target}}',
  );
  assert(
    recorder.getLastCall()?.message?.includes("Created workflow 'deploy'"),
    'Workflow create did not succeed',
    recorder.getLastCall(),
  );

  recorder.clear();
  await workflowCommand.call(recorder.onDone, {}, 'list');
  assert(
    recorder.getLastCall()?.message?.includes('- deploy: 2 step(s)'),
    'Workflow list did not show created workflow',
    recorder.getLastCall(),
  );

  const legacyDir = productPaths.getLegacyProjectSubdir(projectDir, 'workflows');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, 'deploy.json'),
    `${JSON.stringify(
      {
        name: 'deploy',
        steps: ['legacy step should lose'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const loaded = await workflowShared.loadAllWorkflows(projectDir);
  const deploy = loaded.find(item => item.name === 'deploy');
  assert(deploy, 'Workflow loader did not return deploy workflow', loaded);
  assert(
    deploy.steps[0] === 'run tests',
    'Product workflow did not win over legacy duplicate',
    deploy,
  );

  recorder.clear();
  await workflowCommand.call(recorder.onDone, {}, 'run deploy target=prod');
  const runResult = recorder.getLastCall();
  assert(
    runResult?.message?.includes("Running workflow 'deploy'"),
    'Workflow run did not report execution',
    runResult,
  );
  assert(
    runResult?.options?.nextInput?.includes('1. run tests') &&
      runResult?.options?.nextInput?.includes('2. ship prod'),
    'Workflow run did not build the expected execution prompt',
    runResult,
  );
  assert(
    runResult?.options?.submitNextInput === true,
    'Workflow run did not request prompt submission',
    runResult,
  );

  recorder.clear();
  await workflowCommand.call(recorder.onDone, {}, 'delete deploy');
  assert(
    recorder.getLastCall()?.message?.includes("Deleted workflow 'deploy'."),
    'Workflow delete did not succeed',
    recorder.getLastCall(),
  );
}

async function runSummarySmoke() {
  const empty = await summaryCommand.call('', { messages: [] });
  assert(
    empty.value.includes('Session state: empty'),
    'Empty summary output was not stable',
    empty.value,
  );

  const detailed = await summaryCommand.call('detailed', {
    messages: [
      { type: 'user', content: 'Implement local workflows' },
      { type: 'assistant', content: 'Added workflow loading and execution.' },
      {
        type: 'system',
        subtype: 'api_error',
        content: 'Temporary API error during earlier run',
      },
    ],
  });
  assert(
    detailed.value.includes('Objective: Implement local workflows'),
    'Detailed summary missed objective',
    detailed.value,
  );
  assert(
    detailed.value.includes('Key Updates:') &&
      detailed.value.includes('Pending / Next:') &&
      detailed.value.includes('Risks:'),
    'Detailed summary structure was incomplete',
    detailed.value,
  );
}

async function runShareSmoke() {
  const projectDir = join(tempRoot, 'share-project');
  prepareProject(projectDir);

  const success = await shareCommand.call('snapshot --detailed', {
    messages: [
      { type: 'user', content: 'Summarize and export this session' },
      { type: 'assistant', content: 'Prepared a structured summary.' },
    ],
  });
  assert(
    success.value.includes('Share snapshot exported:'),
    'Share command did not report export success',
    success.value,
  );
  const exportedPath = success.value.replace('Share snapshot exported: ', '').trim();
  assert(existsSync(exportedPath), 'Share snapshot file was not written', exportedPath);
  const exportedContent = readFileSync(exportedPath, 'utf8');
  assert(
    exportedContent.includes('## Summary') &&
      exportedContent.includes('SessionId:') &&
      exportedContent.includes('## Context Excerpts'),
    'Share snapshot content was incomplete',
    exportedContent,
  );

  const failureProjectDir = join(tempRoot, 'share-failure-project');
  prepareProject(failureProjectDir);
  const blockedPath = productPaths.getPrimaryProjectSubdir(failureProjectDir, 'shares');
  mkdirSync(dirname(blockedPath), { recursive: true });
  writeFileSync(blockedPath, 'not a directory\n', 'utf8');
  const failure = await shareCommand.call('', { messages: [] });
  assert(
    failure.value.startsWith('Failed to export share snapshot:'),
    'Share command did not expose a stable write failure message',
    failure.value,
  );
}

async function runMcpPathSmoke() {
  const projectDir = join(tempRoot, 'mcp-project');
  prepareProject(projectDir);

  const primaryMcpPath = productPaths.getPrimaryProjectMcpPath(projectDir);
  const legacyMcpPath = productPaths.getLegacyProjectMcpPath(projectDir);
  mkdirSync(dirname(primaryMcpPath), { recursive: true });
  mkdirSync(dirname(legacyMcpPath), { recursive: true });

  writeFileSync(
    legacyMcpPath,
    `${JSON.stringify(
      {
        mcpServers: {
          legacy: {
            command: 'legacy-mcp',
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    primaryMcpPath,
    `${JSON.stringify(
      {
        mcpServers: {
          product: {
            command: 'product-mcp',
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const withProduct = mcpConfig.getProjectMcpConfigsFromCwd();
  assert(
    withProduct.configPath === primaryMcpPath,
    'Project MCP loader did not prefer the product path',
    withProduct,
  );
  assert(
    withProduct.servers.product,
    'Project MCP loader did not load product-configured server',
    withProduct,
  );

  rmSync(primaryMcpPath);
  const withLegacy = mcpConfig.getProjectMcpConfigsFromCwd();
  assert(
    withLegacy.configPath === legacyMcpPath,
    'Project MCP loader did not fall back to the legacy path',
    withLegacy,
  );
  assert(
    withLegacy.servers.legacy,
    'Project MCP loader did not load legacy-configured server',
    withLegacy,
  );
}

try {
  await runForkSmoke();
  await runWorkflowSmoke();
  await runSummarySmoke();
  await runShareSmoke();
  await runMcpPathSmoke();
  console.log('Feature smoke checks passed.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
