#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins what --bare puts on the wire and that its three tools still work; only the model transport is scripted.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-bare-e2e-')));
mkdirSync(artifacts, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Bare is meant to cost a few KB per call. The whole request, schemas included.
const MAX_BODY_CHARS = 6000;
const TOOL_DESCRIPTIONS = { Bash: 'execute shell commands', Edit: 'modify file contents in place', Read: 'read files, images, PDFs, notebooks' };

// route 'direct': ANTHROPIC_BASE_URL names api.anthropic.com and an HTTP proxy
// lands the request here, so the CLI takes its first-party branch.
// route 'custom': the base URL is this server, the untrusted-identity branch.
const scenarios = {
  'shape-direct': { model: 'claude-opus-5-5', route: 'direct' },
  'shape-direct-older-model': { model: 'claude-sonnet-4-6', route: 'direct' },
  'shape-custom-url': { model: 'claude-opus-5-5', route: 'custom' },
  'add-dir': { model: 'claude-opus-5-5', route: 'direct', extra: dir => ['--add-dir', join(dir, 'extra')] },
  'unknown-slash': { model: 'claude-opus-5-5', route: 'direct', prompt: '/no-such-command arg' },
  'tool-loop': {
    model: 'claude-opus-5-5', route: 'direct', extra: () => ['--dangerously-skip-permissions'],
    script: dir => [
      { name: 'Bash', input: { command: "printf 'a\\nb\\n' > f.txt", description: 'Write fixture' } },
      { name: 'Read', input: { file_path: join(dir, 'f.txt') } },
      { name: 'Edit', input: { file_path: join(dir, 'f.txt'), old_string: 'a', new_string: 'A' } },
      { name: 'Write', input: { file_path: join(dir, 'n.txt'), content: 'x' } },
      { name: 'Bash', input: { command: 'echo bg', description: 'Background', run_in_background: true } },
    ],
  },
};
const cases = Object.keys(scenarios).filter(name => !option('--case') || name === option('--case'));
assert.ok(cases.length > 0, 'unknown --case');
let active;

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":100}'); return;
  }
  const body = JSON.parse(raw || '{}');
  active.requests.push({ path: req.url, body });
  const step = active.script[active.requests.length - 1];
  const block = step ? { type: 'tool_use', id: `toolu_${active.requests.length}`, name: step.name, input: step.input } : { type: 'text', text: 'BARE_OK' };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  emit('message_start', { message: { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  emit('content_block_start', { index: 0, content_block: step ? { ...block, input: {} } : { type: 'text', text: '' } });
  emit('content_block_delta', { index: 0, delta: step ? { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } : { type: 'text_delta', text: block.text } });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', { delta: { stop_reason: step ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  emit('message_stop', {});
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${server.address().port}`;

async function run(name) {
  const scenario = scenarios[name];
  const dir = join(artifacts, name);
  mkdirSync(join(dir, 'extra'), { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), 'CWD_RULE_42\n');
  writeFileSync(join(dir, 'extra', 'CLAUDE.md'), 'ADD_DIR_RULE_42\n');
  active = { requests: [], script: scenario.script?.(dir) ?? [] };
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  Object.assign(env, { CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'local-e2e-dummy', DISABLE_AUTOUPDATER: '1' },
    scenario.route === 'custom' ? { ANTHROPIC_BASE_URL: local } : { ANTHROPIC_BASE_URL: 'http://api.anthropic.com', HTTP_PROXY: local, http_proxy: local });
  const prompt = scenario.prompt ?? 'Run the bare fixture.';
  const command = ['--bare', '--print', prompt, '--output-format', 'json', '--model', scenario.model, ...(scenario.extra?.(dir) ?? [])];
  // A bundle (dist/main-dev.js) has no shebang; run it through bun.
  const [bin, binArgs] = entry.endsWith('.js') ? ['bun', [entry, ...command]] : [entry, command];
  const child = spawn(bin, binArgs, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
  const exit = await new Promise((done, reject) => { child.on('error', reject); child.on('close', (code, signal) => done({ code, signal })); });
  clearTimeout(timeout);
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
  writeFileSync(join(dir, 'stdout.json'), stdout);
  writeFileSync(join(dir, 'stderr.txt'), stderr);
  assert.equal(exit.signal, null, `CLI terminated by ${exit.signal}: ${stderr.slice(0, 200)}`);
  let result;
  try { result = JSON.parse(stdout); } catch { assert.fail(`stdout is not a JSON result: ${stdout.slice(0, 200)} ${stderr.slice(0, 200)}`); }
  return { dir, exit, result, invocation: { entry, args: command, route: scenario.route, input_sha256: sha(prompt) } };
}

function check(name, { dir, exit, result }) {
  assert.equal(exit.code, 0);
  assert.equal(result.result, 'BARE_OK');
  assert.equal(result.terminal_reason, 'completed');
  const { body } = active.requests[0];
  const chars = JSON.stringify(body).length;
  assert.ok(chars <= MAX_BODY_CHARS || name === 'add-dir', `first request is ${chars} chars, over ${MAX_BODY_CHARS}`);
  // system[0] is the billing line, system[1] the identity prefix.
  assert.equal(body.system.length, 3);
  assert.match(body.system[2].text, /^CWD: .+\nDate: \d{4}-\d{2}-\d{2}$/, 'system prompt carries more than CWD and Date');
  assert.deepEqual(Object.fromEntries(body.tools.map(t => [t.name, t.description])), TOOL_DESCRIPTIONS);
  const bash = body.tools.find(t => t.name === 'Bash');
  assert.ok(!('run_in_background' in bash.input_schema.properties), 'bare Bash schema offers run_in_background');
  const first = body.messages[0].content;
  const firstText = typeof first === 'string' ? first : first.map(b => b.text).join('');
  if (name === 'add-dir') {
    assert.ok(firstText.includes('ADD_DIR_RULE_42'), '--add-dir CLAUDE.md was not loaded');
    assert.ok(!firstText.includes('CWD_RULE_42'), 'cwd CLAUDE.md leaked into a bare session');
  } else if (name === 'unknown-slash') {
    assert.equal(firstText, '/no-such-command arg', 'unknown slash command was not passed through as typed');
  } else {
    assert.equal(firstText, 'Run the bare fixture.', 'something was injected ahead of the prompt');
  }
  if (name !== 'tool-loop') { assert.equal(active.requests.length, 1); return; }
  assert.equal(active.requests.length, 6);
  assert.equal(readFileSync(join(dir, 'f.txt'), 'utf8'), 'A\nb\n', 'Bash and Edit did not produce the expected file');
  assert.equal(existsSync(join(dir, 'n.txt')), false, 'Write ran although bare does not offer it');
  const results = active.requests.at(-1).body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
  const text = id => { const c = results.find(r => r.tool_use_id === id)?.content; return typeof c === 'string' ? c : JSON.stringify(c); };
  assert.ok(text('toolu_2').includes('1\ta'), 'Read result missing');
  assert.ok(text('toolu_3').includes('no need to Read it back'), 'Edit result does not say the file state is current');
  assert.ok(text('toolu_4').includes('No such tool available: Write. Tools available in this session: Bash, Edit, Read.'), 'unknown-tool error does not name the tools');
  assert.ok(text('toolu_5').includes('run_in_background'), 'run_in_background was accepted under bare');
}

const results = [];
try {
  for (const name of cases) {
    let passed = false, failure, observed, invocation;
    try {
      const ran = await run(name);
      invocation = ran.invocation;
      const body = active.requests[0]?.body;
      observed = { exit: ran.exit, result: ran.result.result, subtype: ran.result.subtype, terminal_reason: ran.result.terminal_reason, requests: active.requests.length,
        first_request_chars: body && JSON.stringify(body).length, tools: body?.tools.map(t => t.name) };
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
    transport: 'deterministic localhost Anthropic SSE; no actual model-quality benchmark',
    entry, entry_sha256: shaOf(entry),
    script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    results_sha256: shaOf(join(artifacts, 'results.json')),
    passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
