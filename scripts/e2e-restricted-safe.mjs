#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins restricted/safe-mode behavior and bypass authorization boundaries with real tool calls.
// Only the model transport is scripted (a localhost Anthropic SSE fixture).
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-restricted-safe-e2e-')));
mkdirSync(artifacts, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const PROJECT_RULE = 'PROJECT_RULE_SAFE_77';
const HOOK_MARKER = 'SAFE_HOOK_RAN_77';

// By default the fixture returns a plain text reply; the requests are what is under test.
// A case may script the first reply as tool calls (toolUses) to exercise a tool path.
let active = { requests: [], toolUses: null };
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":100}'); return;
  }
  const body = JSON.parse(raw || '{}');
  const classifier = JSON.stringify(body.system).includes('cc_automode_permissions');
  active.requests.push({ path: req.url, headers: req.headers, body, classifier });
  res.writeHead(200, { 'content-type': body.stream ? 'text/event-stream' : 'application/json' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  if (!classifier) active.mainTurns = (active.mainTurns ?? 0) + 1;
  const scripted = !classifier ? active.toolSteps?.[active.mainTurns - 1] ?? (active.toolUses && active.mainTurns === 1 ? active.toolUses : null) : null;
  if (!body.stream) {
    const content = scripted ?? [{ type: 'text', text: classifier ? '<block>no</block>' : 'SAFE_OK' }];
    res.end(JSON.stringify({ id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: scripted ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } }));
    return;
  }
  emit('message_start', { message: { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  if (scripted) {
    scripted.forEach((call, index) => {
      emit('content_block_start', { index, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } });
      emit('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } });
      emit('content_block_stop', { index });
    });
    emit('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } });
  } else {
    emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: classifier ? '<block>no</block>' : 'SAFE_OK' } });
    emit('content_block_stop', { index: 0 });
    emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  }
  emit('message_stop', {});
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${server.address().port}`;

// Each case: extra flags, optional project fixture, and the expected outcome.
const cases = {
  // --restricted removes Bash (and WebFetch) from the tool list sent to the provider.
  'restricted-drops-bash': {
    flags: ['--restricted'],
    expect: 'completed',
  },
  // --bare builds its own short tool list; --restricted must still remove Bash from it.
  'restricted-bare-drops-bash': {
    flags: ['--restricted', '--bare'],
    expect: 'completed',
  },
  // --tools re-enables a dropped tool in either spelling; --tools=value used to be ignored.
  'restricted-tools-equals-keeps-bash': {
    flags: ['--restricted', '--tools=Bash,Read'],
    expect: 'completed',
  },
  // --restricted combined with bypassPermissions must refuse to start.
  'restricted-refuses-bypass': {
    flags: ['--restricted', '--dangerously-skip-permissions'],
    expect: 'refused',
  },
  // Repository-controlled settings cannot grant bypass; trusted user/flag settings can.
  'bypass-project-default-ignored': {
    project: true,
    projectPermissions: { defaultMode: 'bypassPermissions' },
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-denied',
  },
  'bypass-local-default-ignored': {
    project: true,
    localPermissions: { defaultMode: 'bypassPermissions' },
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-denied',
  },
  'bypass-user-default-allowed': {
    userSettings: { permissions: { defaultMode: 'bypassPermissions' } },
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-allowed',
  },
  'bypass-flag-default-allowed': {
    flags: ['--settings', JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } })],
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-allowed',
  },
  'bypass-background-requires-user-consent': {
    flags: ['--dangerously-skip-permissions'],
    env: { NOA_CLAUDE_BG_JOB: 'abcdef01' },
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-denied',
  },
  'bypass-background-user-consent-allowed': {
    flags: ['--dangerously-skip-permissions'],
    env: { NOA_CLAUDE_BG_JOB: 'abcdef01' },
    userSettings: { skipDangerousModePermissionPrompt: true },
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-allowed',
  },
  'bypass-subprocess-scrub-forces-default': {
    flags: ['--dangerously-skip-permissions'],
    env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' },
    requests: 2,
    toolUses: ({ workspace }) => [{ id: 'bypass_write', name: 'Write', input: { file_path: join(workspace, 'bypass.txt'), content: 'BYPASS_WRITE' } }],
    expect: 'write-denied',
  },
  'auto-project-default-ignored': {
    project: true,
    projectPermissions: { defaultMode: 'auto' },
    expect: 'auto-off',
  },
  'auto-local-default-ignored': {
    project: true,
    localPermissions: { defaultMode: 'auto' },
    expect: 'auto-off',
  },
  'auto-user-default-allowed': {
    userSettings: { permissions: { defaultMode: 'auto' } },
    expect: 'auto-on',
  },
  'auto-custom-endpoint-keeps-model': {
    flags: ['--permission-mode', 'auto'],
    model: 'kimi/k3.1-pro',
    requests: 3,
    toolUses: ({ workspace }) => [{ id: 'auto_bash', name: 'Bash', input: { command: `node -e "require('fs').writeFileSync('auto-route.txt','ok')"`, description: 'Run classifier route fixture' } }],
    expect: 'custom-model',
  },
  'auto-sensitive-write-requires-approval': {
    project: true,
    flags: ['--permission-mode', 'auto'],
    requests: 3,
    toolSteps: ({ workspace }) => [
      [{ id: 'sensitive_read', name: 'Read', input: { file_path: join(workspace, '.noa', 'settings.json') } }],
      [{ id: 'sensitive_write', name: 'Write', input: { file_path: join(workspace, '.noa', 'settings.json'), content: 'SENSITIVE_CLASSIFIER_CONTENT_77' } }],
    ],
    expect: 'sensitive-approval',
  },
  'auto-sensitive-edit-requires-approval': {
    project: true,
    flags: ['--permission-mode', 'auto'],
    requests: 3,
    toolSteps: ({ workspace }) => [
      [{ id: 'sensitive_read', name: 'Read', input: { file_path: join(workspace, '.noa', 'settings.json') } }],
      [{ id: 'sensitive_edit', name: 'Edit', input: { file_path: join(workspace, '.noa', 'settings.json'), old_string: HOOK_MARKER, new_string: 'SENSITIVE_CLASSIFIER_CONTENT_77' } }],
    ],
    expect: 'sensitive-approval',
  },
  'auto-repeat-action-reclassified': {
    model: 'kimi/k3.1-pro',
    flags: ['--permission-mode', 'auto'],
    requests: 5,
    toolSteps: () => [
      [{ id: 'repeat_write_1', name: 'Bash', input: { command: `node -e "require('fs').writeFileSync('repeat.txt','ok')"`, description: 'Repeat classifier fixture' } }],
      [{ id: 'repeat_write_2', name: 'Bash', input: { command: `node -e "require('fs').writeFileSync('repeat.txt','ok')"`, description: 'Repeat classifier fixture' } }],
    ],
    expect: 'reclassified',
  },
  'auto-long-context-preserves-history': {
    model: 'claude-sonnet-4-6',
    flags: ['--permission-mode', 'auto'],
    prompt: `Do not push any changes. LONG_CONTEXT_${'x'.repeat(200000)}_END. Do not delete any files.`,
    requests: 3,
    toolUses: () => [{ id: 'long_context_bash', name: 'Bash', input: { command: `node -e "require('fs').writeFileSync('long-context.txt','ok')"`, description: 'Preserve classifier history fixture' } }],
    expect: 'preserved-history',
  },
  'auto-flag-default-allowed': {
    flags: ['--settings', JSON.stringify({ permissions: { defaultMode: 'auto' } })],
    expect: 'auto-on',
  },
  // --safe-mode does not load the project CLAUDE.md or the project SessionStart hook.
  'safe-mode-skips-project': {
    flags: ['--safe-mode'],
    project: true,
    expect: 'completed',
  },
  // Auth still works under --safe-mode: the request carries the configured API key.
  'safe-mode-auth-works': {
    flags: ['--safe-mode'],
    expect: 'completed',
  },
  // --restricted ignores the project settings file, so its SessionStart hook never runs.
  'restricted-ignores-project-settings': {
    flags: ['--restricted'],
    project: true,
    expect: 'completed',
  },
  // --restricted confines writes to cwd: an in-workspace Write succeeds, one outside is refused
  // even with acceptEdits auto-approving edits. The second request carries the tool results.
  'restricted-write-confinement': {
    flags: ['--restricted', '--permission-mode', 'acceptEdits'],
    requests: 2,
    toolUses: ({ dir, workspace }) => [
      { id: 'w_inside', name: 'Write', input: { file_path: join(workspace, 'inside.txt'), content: 'INSIDE_OK' } },
      { id: 'w_outside', name: 'Write', input: { file_path: join(dir, 'outside.txt'), content: 'OUTSIDE_LEAK' } },
    ],
    expect: 'completed',
  },
  // --restricted ignores project permission rules: a project Edit deny (which also covers Write) does not apply.
  'restricted-ignores-project-permissions': {
    flags: ['--restricted', '--permission-mode', 'acceptEdits'],
    project: true,
    projectPermissions: { deny: ['Edit(**)'] },
    requests: 2,
    toolUses: ({ workspace }) => [
      { id: 'w_inside', name: 'Write', input: { file_path: join(workspace, 'inside.txt'), content: 'INSIDE_OK' } },
    ],
    expect: 'completed',
  },
  // Control: the same project deny applies without --restricted, so the write is refused.
  'project-permissions-deny-applies-control': {
    flags: ['--permission-mode', 'acceptEdits'],
    project: true,
    projectPermissions: { deny: ['Edit(**)'] },
    requests: 2,
    toolUses: ({ workspace }) => [
      { id: 'w_inside', name: 'Write', input: { file_path: join(workspace, 'inside.txt'), content: 'INSIDE_OK' } },
    ],
    expect: 'completed',
  },
  // Control for the case above: without --restricted the outside Write is still refused, but by the
  // ordinary permission prompt, so the restricted refusal is a distinct, mode-specific path.
  'write-outside-refused-without-restricted': {
    flags: ['--permission-mode', 'acceptEdits'],
    requests: 2,
    toolUses: ({ dir, workspace }) => [
      { id: 'w_inside', name: 'Write', input: { file_path: join(workspace, 'inside.txt'), content: 'INSIDE_OK' } },
      { id: 'w_outside', name: 'Write', input: { file_path: join(dir, 'outside.txt'), content: 'OUTSIDE_LEAK' } },
    ],
    expect: 'completed',
  },
};
const selected = Object.keys(cases).filter(name => !option('--case') || name === option('--case'));
assert.ok(selected.length > 0, 'unknown --case');

function writeProject(dir, permissions, localPermissions) {
  const workspace = join(dir, 'workspace');
  mkdirSync(join(workspace, '.noa'), { recursive: true });
  writeFileSync(join(workspace, 'CLAUDE.md'), `${PROJECT_RULE}\n`);
  writeFileSync(join(workspace, '.noa', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo ${HOOK_MARKER} > ${join(dir, 'hook-ran.txt')}` }] }] },
    ...(permissions && { permissions }),
  }));
  if (localPermissions) writeFileSync(join(workspace, '.noa', 'settings.local.json'), JSON.stringify({ permissions: localPermissions }));
  return workspace;
}

async function run(name) {
  const scenario = cases[name];
  const dir = join(artifacts, name);
  mkdirSync(dir, { recursive: true });
  const workspace = scenario.project ? writeProject(dir, scenario.projectPermissions, scenario.localPermissions) : join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  active = { requests: [], toolUses: scenario.toolUses?.({ dir, workspace }) ?? null, toolSteps: scenario.toolSteps?.({ dir, workspace }) ?? null, mainTurns: 0 };
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: join(dir, 'config'),
    ANTHROPIC_API_KEY: 'local-e2e-dummy',
    DISABLE_AUTOUPDATER: '1',
    ANTHROPIC_BASE_URL: local,
    ...scenario.env,
  });
  if (scenario.userSettings) {
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(join(env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify(scenario.userSettings));
  }
  const command = ['--print', scenario.prompt ?? 'Say SAFE_OK.', '--output-format', 'json', '--model', scenario.model ?? 'claude-opus-5-5', ...(scenario.flags ?? [])];
  const [bin, binArgs] = entry.endsWith('.js') ? ['bun', [entry, ...command]] : [entry, command];
  const child = spawn(bin, binArgs, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  const exit = await new Promise((done, reject) => { child.on('error', reject); child.on('close', (code, signal) => done({ code, signal })); });
  clearTimeout(timeout);
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
  writeFileSync(join(dir, 'stdout.txt'), stdout);
  writeFileSync(join(dir, 'stderr.txt'), stderr);
  assert.equal(exit.signal, null, `CLI terminated by ${exit.signal}: ${stderr.slice(0, 200)}`);
  return { dir, exit, stdout, stderr, workspace, command };
}

// A project's .noa/scheduled_tasks.json would fire prompts unattended, so both modes turn cron off.
function assertNoCron(body, mode) {
  const offered = JSON.stringify(body.tools) + JSON.stringify(body.messages);
  for (const tool of ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup']) {
    assert.ok(!offered.includes(`"name":"${tool}"`) && !offered.includes(`\\n${tool}\\n`), `${tool} still offered under ${mode}`);
  }
}

function check(name, { dir, exit, stdout, stderr, workspace }) {
  if (name === 'restricted-refuses-bypass') {
    assert.notEqual(exit.code, 0, 'restricted + bypass should exit non-zero');
    assert.match(stderr, /--restricted cannot be combined with bypassPermissions/, 'refusal message missing');
    assert.equal(active.requests.length, 0, 'a request was sent despite the refusal');
    return;
  }
  assert.equal(exit.code, 0, `exit ${exit.code}: ${stderr.slice(0, 300)}`);
  const result = JSON.parse(stdout);
  assert.equal(result.terminal_reason, 'completed');
  const expected = cases[name].requests ?? 1;
  assert.equal(active.requests.length, expected, `expected ${expected} request(s), got ${active.requests.length}`);
  const { body, headers } = active.requests[0];
  if (name === 'restricted-drops-bash') {
    const names = body.tools.map(t => t.name);
    assert.ok(!names.includes('Bash'), `Bash still offered under --restricted: ${names.join(', ')}`);
    assert.ok(!names.includes('WebFetch'), `WebFetch still offered under --restricted: ${names.join(', ')}`);
    assert.ok(!names.includes('Monitor') && !JSON.stringify(body.messages).includes('\\nMonitor\\n'), `Monitor still offered under --restricted: ${names.join(', ')}`);
    assert.ok(names.includes('Read'), 'Read (a non-code tool) was removed under --restricted');
    assertNoCron(body, '--restricted');
  }
  if (name === 'restricted-tools-equals-keeps-bash') {
    const names = body.tools.map(t => t.name);
    assert.ok(names.includes('Bash'), `--tools=Bash,Read did not keep Bash under --restricted: ${names.join(', ')}`);
  }
  if (name === 'restricted-bare-drops-bash') {
    const names = body.tools.map(t => t.name);
    assert.ok(!names.includes('Bash'), `Bash still offered under --restricted --bare: ${names.join(', ')}`);
    assert.ok(names.includes('Read'), 'Read was removed under --restricted --bare');
  }
  if (name === 'safe-mode-skips-project') {
    const system = JSON.stringify(body);
    const first = JSON.stringify(body.messages[0].content);
    assert.ok(!system.includes(PROJECT_RULE) && !first.includes(PROJECT_RULE), 'project CLAUDE.md leaked under --safe-mode');
    assert.equal(existsSync(join(dir, 'hook-ran.txt')), false, 'project SessionStart hook ran under --safe-mode');
  }
  if (name === 'safe-mode-auth-works') {
    assertNoCron(body, '--safe-mode');
    // SDK 1.x sends the API key as a Bearer token; older versions used x-api-key.
    assert.ok(
      headers['x-api-key'] === 'local-e2e-dummy' || headers.authorization === 'Bearer local-e2e-dummy',
      `API key was not sent under --safe-mode: ${JSON.stringify({ 'x-api-key': headers['x-api-key'], authorization: headers.authorization })}`,
    );
  }
  if (name === 'restricted-ignores-project-settings') {
    assert.equal(existsSync(join(dir, 'hook-ran.txt')), false, 'project SessionStart hook ran under --restricted');
  }
  if (name === 'restricted-ignores-project-permissions' || name === 'project-permissions-deny-applies-control') {
    const results = active.requests[1].body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
    const write = results.find(r => r.tool_use_id === 'w_inside');
    assert.ok(write, 'project-permission Write produced no tool result');
    if (name === 'restricted-ignores-project-permissions') {
      assert.ok(!write.is_error, `project deny still applied under --restricted: ${JSON.stringify(write)}`);
      assert.equal(readFileSync(join(workspace, 'inside.txt'), 'utf8'), 'INSIDE_OK', 'write did not land under --restricted');
    } else {
      assert.ok(write.is_error, `project deny did not apply without --restricted: ${JSON.stringify(write)}`);
      assert.doesNotMatch(String(write.content), /restricted mode/, 'control refusal came from --restricted');
      assert.equal(existsSync(join(workspace, 'inside.txt')), false, 'control write landed despite project deny');
    }
  }
  if (name === 'auto-repeat-action-reclassified') {
    assert.equal(active.requests.filter(r => r.classifier).length, 2, 'repeated action reused a stale verdict');
    assert.equal(readFileSync(join(workspace, 'repeat.txt'), 'utf8'), 'ok');
  }
  if (name === 'auto-long-context-preserves-history') {
    const call = active.requests.find(r => r.classifier);
    assert.ok(call, 'long-context action did not reach the classifier');
    const messages = JSON.stringify(call.body.messages);
    assert.ok(messages.includes(cases[name].prompt), 'classifier silently discarded user context or boundaries');
  }
  if (name === 'auto-custom-endpoint-keeps-model') {
    const calls = active.requests.filter(r => r.classifier);
    assert.equal(calls.length, 1, 'expected one classifier request');
    assert.ok(calls.every(r => r.body.model === 'kimi/k3.1-pro'), 'custom endpoint silently changed the classifier model');
    assert.ok(calls[0].path.startsWith('/'), 'classifier did not use the shared local endpoint');
  }
  if (cases[name].expect === 'sensitive-approval') {
    assert.equal(active.requests.filter(r => r.classifier).length, 0, 'redacted sensitive action reached the classifier');
    const results = active.requests.at(-1).body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
    const mutation = results.find(r => r.tool_use_id === (name.includes('-write-') ? 'sensitive_write' : 'sensitive_edit'));
    assert.ok(mutation?.is_error, 'sensitive mutation did not require approval');
    assert.match(String(mutation.content), /requested permissions/i, 'sensitive mutation failed before the approval boundary');
    const settings = JSON.parse(readFileSync(join(workspace, '.noa', 'settings.json'), 'utf8'));
    assert.ok(settings.hooks.SessionStart, 'sensitive mutation changed the original settings');
    assert.ok(!JSON.stringify(settings).includes('SENSITIVE_CLASSIFIER_CONTENT_77'), 'sensitive content was written without approval');
  }
  if (cases[name].expect === 'auto-off' || cases[name].expect === 'auto-on') {
    const active = JSON.stringify(body.messages).includes('## Auto Mode Active');
    assert.equal(active, cases[name].expect === 'auto-on', 'unexpected auto mode startup state');
  }
  if (cases[name].expect === 'write-denied' || cases[name].expect === 'write-allowed') {
    const results = active.requests[1].body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
    const write = results.find(r => r.tool_use_id === 'bypass_write');
    assert.ok(write, 'bypass boundary Write produced no tool result');
    const allowed = cases[name].expect === 'write-allowed';
    assert.equal(!write.is_error, allowed, `unexpected Write decision: ${JSON.stringify(write)}`);
    assert.equal(existsSync(join(workspace, 'bypass.txt')), allowed, 'Write result does not match the expected bypass boundary');
    if (name === 'bypass-subprocess-scrub-forces-default') assert.match(stderr, /Permission mode forced to default/, 'scrub downgrade warning missing');
  }
  if (name === 'restricted-write-confinement' || name === 'write-outside-refused-without-restricted') {
    const results = active.requests[1].body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
    const byId = Object.fromEntries(results.map(r => [r.tool_use_id, r]));
    assert.ok(byId.w_inside, 'in-workspace Write produced no tool result');
    assert.ok(!byId.w_inside.is_error, `in-workspace Write refused: ${JSON.stringify(byId.w_inside)}`);
    assert.equal(readFileSync(join(workspace, 'inside.txt'), 'utf8'), 'INSIDE_OK', 'in-workspace file content wrong');
    if (name === 'restricted-write-confinement') {
      assert.ok(byId.w_outside?.is_error, `outside Write was not refused: ${JSON.stringify(byId.w_outside)}`);
      assert.match(String(byId.w_outside.content), /not allowed in --restricted mode/, 'refusal did not come from restricted confinement');
      assert.equal(existsSync(join(dir, 'outside.txt')), false, 'file outside the workspace was written');
    } else {
      // Without --restricted the outside Write still fails, but through the ordinary permission
      // prompt (print mode cannot answer it), not the restricted-mode confinement message.
      assert.ok(byId.w_outside?.is_error, `control outside Write was not refused: ${JSON.stringify(byId.w_outside)}`);
      assert.doesNotMatch(String(byId.w_outside.content), /restricted mode/, 'control refusal came from --restricted');
      assert.equal(existsSync(join(dir, 'outside.txt')), false, 'control outside file was written');
    }
  }
}

const results = [];
try {
  for (const name of selected) {
    let passed = false, failure, observed, invocation;
    try {
      const ran = await run(name);
      invocation = { entry, args: ran.command };
      observed = {
        exit_code: ran.exit.code,
        stdout: ran.stdout.slice(0, 300),
        stderr: ran.stderr.slice(0, 300),
        requests: active.requests.length,
        tools: active.requests[0]?.body.tools?.map(t => t.name),
      };
      check(name, ran);
      passed = true;
    } catch (error) { failure = String(error); }
    results.push({ scenario: name, passed, failure, observed, invocation });
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${failure ? `: ${failure}` : ''}`);
  }
} finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  let revision; try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()) revision += '-dirty';
  } catch { revision = 'unavailable'; }
  const shaOf = file => existsSync(file) ? sha(readFileSync(file)) : 'missing';
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({
    command: [process.execPath, ...process.argv.slice(1)], revision, runtime: process.version,
    transport: 'deterministic localhost Anthropic SSE; no model-quality benchmark',
    entry, entry_sha256: shaOf(entry),
    script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    results_sha256: shaOf(join(artifacts, 'results.json')),
    passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
