#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins what --restricted and --safe-mode put on the wire and that auth still works under safe mode.
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

// The fixture returns a plain text reply; the requests are what is under test.
let active = { requests: [] };
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":100}'); return;
  }
  const body = JSON.parse(raw || '{}');
  active.requests.push({ path: req.url, headers: req.headers, body });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  emit('message_start', { message: { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'SAFE_OK' } });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
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
  // --restricted combined with bypassPermissions must refuse to start.
  'restricted-refuses-bypass': {
    flags: ['--restricted', '--dangerously-skip-permissions'],
    expect: 'refused',
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
};
const selected = Object.keys(cases).filter(name => !option('--case') || name === option('--case'));
assert.ok(selected.length > 0, 'unknown --case');

function writeProject(dir) {
  const workspace = join(dir, 'workspace');
  mkdirSync(join(workspace, '.noa'), { recursive: true });
  writeFileSync(join(workspace, 'CLAUDE.md'), `${PROJECT_RULE}\n`);
  writeFileSync(join(workspace, '.noa', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo ${HOOK_MARKER} > ${join(dir, 'hook-ran.txt')}` }] }] },
  }));
  return workspace;
}

async function run(name) {
  const scenario = cases[name];
  const dir = join(artifacts, name);
  mkdirSync(dir, { recursive: true });
  const workspace = scenario.project ? writeProject(dir) : join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  active = { requests: [] };
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: join(dir, 'config'),
    ANTHROPIC_API_KEY: 'local-e2e-dummy',
    DISABLE_AUTOUPDATER: '1',
    ANTHROPIC_BASE_URL: local,
  });
  const command = ['--print', 'Say SAFE_OK.', '--output-format', 'json', '--model', 'claude-opus-5-5', ...scenario.flags];
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
  assert.equal(active.requests.length, 1, `expected 1 request, got ${active.requests.length}`);
  const { body, headers } = active.requests[0];
  if (name === 'restricted-drops-bash') {
    const names = body.tools.map(t => t.name);
    assert.ok(!names.includes('Bash'), `Bash still offered under --restricted: ${names.join(', ')}`);
    assert.ok(!names.includes('WebFetch'), `WebFetch still offered under --restricted: ${names.join(', ')}`);
    assert.ok(names.includes('Read'), 'Read (a non-code tool) was removed under --restricted');
  }
  if (name === 'safe-mode-skips-project') {
    const system = JSON.stringify(body);
    const first = JSON.stringify(body.messages[0].content);
    assert.ok(!system.includes(PROJECT_RULE) && !first.includes(PROJECT_RULE), 'project CLAUDE.md leaked under --safe-mode');
    assert.equal(existsSync(join(dir, 'hook-ran.txt')), false, 'project SessionStart hook ran under --safe-mode');
  }
  if (name === 'safe-mode-auth-works') {
    assert.equal(headers['x-api-key'], 'local-e2e-dummy', 'API key was not sent under --safe-mode');
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
