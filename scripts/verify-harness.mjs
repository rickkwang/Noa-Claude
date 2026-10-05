#!/usr/bin/env node
/**
 * Black-box harness parity against an installed upstream Claude Code binary.
 *
 * Each scenario scripts the Messages API the same way for both CLIs and
 * compares what they did: how many model requests they made and whether they
 * ended with the scripted final answer. Recovery paths (overload, cut-off
 * streams, malformed tool calls, rejected thinking signatures, …) live in
 * bytecode upstream, so behaviour is the only thing that can be compared.
 *
 *   bun run verify:harness [--entry dist/cli] [--case <name>] [--artifacts <dir>]
 *   NOA_UPSTREAM_CLAUDE_BINARY=/path/to/claude bun run verify:harness
 *
 * With no upstream binary present it reports skipped and exits 0.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-harness-parity-')));

function findUpstream() {
  const explicit = process.env.NOA_UPSTREAM_CLAUDE_BINARY;
  if (explicit) return existsSync(explicit) ? explicit : null;
  const dir = join(homedir(), '.local', 'share', 'claude', 'versions');
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir).filter(name => /^\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => a.split('.').map(Number).reduce((d, n, i) => d || n - Number(b.split('.')[i]), 0));
  for (const version of versions.reverse()) if (statSync(join(dir, version)).isFile()) return join(dir, version);
  return null;
}

const upstream = findUpstream();
if (!upstream) {
  console.log('verify:harness — skipped: no upstream Claude Code binary found.\n  Looked in ~/.local/share/claude/versions/, or set NOA_UPSTREAM_CLAUDE_BINARY=/path/to/claude.');
  process.exit(0);
}
if (!existsSync(entry)) { console.error(`verify:harness — ${entry} not found; run bun run compile first.`); process.exit(1); }
mkdirSync(artifacts, { recursive: true });

const FINAL = 'FINAL_OK';
const message = (body, n, content, stop) => ({ id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } });
function reply(res, body, m, { cut = false } = {}) {
  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...m, content: m.content.map(b => b.type === 'thinking' ? { ...b, signature: 'sig' } : b) }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  emit('message_start', { message: { ...m, content: [], stop_reason: null, usage: { ...m.usage, output_tokens: 0 } } });
  m.content.forEach((block, index) => {
    if (block.type === 'text') {
      emit('content_block_start', { index, content_block: { type: 'text', text: '' } });
      emit('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'thinking') {
      emit('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      emit('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      emit('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'sig' } });
    } else {
      emit('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      emit('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: block.raw ?? JSON.stringify(block.input) } });
    }
    emit('content_block_stop', { index });
  });
  if (cut) { res.end(); return; }
  emit('message_delta', { delta: { stop_reason: m.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
  emit('message_stop', {});
  res.end();
}
const fail = (res, status, type, text, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify({ type: 'error', error: { type, message: text } })); };
const final = (res, body, n) => reply(res, body, message(body, n, [{ type: 'text', text: FINAL }], 'end_turn'));
const first = (once, then = final) => (res, body, n, dir) => n === 1 ? once(res, body, n, dir) : then(res, body, n, dir);
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });

// Each scenario answers the nth main-loop request.
const scenarios = {
  'truncated-after-output': first((res, body, n) => reply(res, body, message(body, n, [{ type: 'text', text: 'PARTIAL_' }], 'end_turn'), { cut: true })),
  'no-events': first(res => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(); }),
  'overloaded-x2': (res, body, n) => n <= 2 ? fail(res, 529, 'overloaded_error', 'Overloaded') : final(res, body, n),
  'rate-limit-retry-after': first(res => fail(res, 429, 'rate_limit_error', 'Rate limited', { 'retry-after': '1' })),
  'server-500': first(res => fail(res, 500, 'api_error', 'Internal server error')),
  'max-tokens-mid-text': first((res, body, n) => reply(res, body, message(body, n, [{ type: 'text', text: 'HALF_' }], 'max_tokens'))),
  'thinking-only': first((res, body, n) => reply(res, body, message(body, n, [{ type: 'thinking', thinking: 'hmm' }], 'end_turn'))),
  'empty-end-turn': first((res, body, n) => reply(res, body, message(body, n, [], 'end_turn'))),
  'malformed-tool-use': first((res, body, n) => reply(res, body, message(body, n, [{ type: 'text', text: 'Calling a tool.' }], 'tool_use'))),
  'refusal': first((res, body, n) => reply(res, body, message(body, n, [], 'refusal'))),
  'bad-tool-input': first((res, body, n) => reply(res, body, message(body, n, [tool('tu1', 'Read', { nope: 1 })], 'tool_use'))),
  'unknown-tool': first((res, body, n) => reply(res, body, message(body, n, [tool('tu1', 'NoSuchTool', {})], 'tool_use'))),
  'invalid-json-tool-input': first((res, body, n) => reply(res, body, message(body, n, [{ ...tool('tu1', 'Read', {}), raw: '{"file_path": "/tmp/x' }], 'tool_use'))),
  'parallel-tools': first((res, body, n, dir) => reply(res, body, message(body, n, [tool('tu1', 'Read', { file_path: join(dir, 'x') }), tool('tu2', 'Read', { file_path: join(dir, 'y') })], 'tool_use'))),
  'denied-tool': first((res, body, n) => reply(res, body, message(body, n, [tool('tu1', 'Bash', { command: 'touch DENIED', description: 'x' })], 'tool_use'))),
  'large-output': first((res, body, n) => reply(res, body, message(body, n, [tool('tu1', 'Bash', { command: 'seq 1 60000', description: 'x' })], 'tool_use'))),
  'prompt-too-long': first(res => fail(res, 400, 'invalid_request_error', 'prompt is too long: 250000 tokens > 200000 maximum')),
  'stale-signature-400': (res, body, n) => n === 1 ? reply(res, body, message(body, n, [{ type: 'thinking', thinking: 'plan' }, tool('tu1', 'Bash', { command: 'echo hi', description: 'x' })], 'tool_use'))
    : n === 2 ? fail(res, 400, 'invalid_request_error', 'messages.1.content.0: Invalid `signature` in `thinking` block') : final(res, body, n),
  'empty-text-400': first(res => fail(res, 400, 'invalid_request_error', 'messages: text content blocks must be non-empty')),
};

async function run(bin, name) {
  let n = 0;
  const requests = [];
  const dir = mkdtempSync(join(tmpdir(), 'noa-harness-case-'));
  writeFileSync(join(dir, 'x'), 'x');
  writeFileSync(join(dir, 'y'), 'y');
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (!req.url.includes('/messages') || req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":1}'); return; }
    const body = JSON.parse(raw || '{}');
    n++;
    requests.push({ stream: body.stream === true, thinking: (raw.match(/"type":"(?:redacted_)?thinking"/g) ?? []).length, last: body.messages?.at(-1)?.content });
    scenarios[name](res, body, n, dir);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'local-parity-dummy',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_MAX_RETRIES: '3' };
  const command = ['--bare', '--print', 'Do the task.', '--output-format', 'json', '--model', 'claude-opus-5-5', '--permission-mode', 'dontAsk',
    '--allowedTools', 'Bash(echo hi)', 'Bash(seq 1 60000)', 'Read'];
  const [exe, argv] = bin.endsWith('.js') ? ['bun', [bin, ...command]] : [bin, command];
  const child = spawn(exe, argv, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  const code = await new Promise(r => child.on('close', r));
  clearTimeout(timer);
  server.close();
  let result = null;
  try { result = JSON.parse(out.trim().split('\n').at(-1)); } catch {}
  return { ok: result?.result === FINAL && !result?.is_error, requests: n, exit: code, isError: result?.is_error, subtype: result?.subtype, validResult: result?.type === 'result' && typeof result?.is_error === 'boolean', result: String(result?.result ?? out.slice(-200)).slice(0, 200), terminal: result?.terminal_reason, sideEffect: existsSync(join(dir, 'DENIED')), requestLog: requests };
}

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const cases = Object.keys(scenarios).filter(name => !option('--case') || name === option('--case'));
if (!cases.length) { console.error('verify:harness — unknown --case'); process.exit(1); }
const results = [];
for (const name of cases) {
  const [reference, candidate] = await Promise.all([run(upstream, name), run(entry, name)]);
  const match = reference.ok === candidate.ok && reference.requests === candidate.requests && reference.sideEffect === false && candidate.sideEffect === false
    && reference.validResult && candidate.validResult
    && reference.exit === candidate.exit && reference.isError === candidate.isError
    && reference.subtype === candidate.subtype && reference.terminal === candidate.terminal;
  results.push({ name, match, reference, candidate });
  console.log(`${match ? 'MATCH' : 'DIFF '} ${name}  upstream ${reference.ok ? 'ok' : 'err'}/${reference.requests}  noa ${candidate.ok ? 'ok' : 'err'}/${candidate.requests}${match ? '' : `  noa: ${candidate.result.slice(0, 80)}`}`);
}
let revision = 'unavailable';
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch {}
const mismatches = results.filter(r => !r.match).map(r => r.name);
const exitCode = mismatches.length ? 1 : 0;
writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({
  command: [process.execPath, ...process.argv.slice(1)], revision, entry, entry_sha256: sha(entry), upstream, upstream_sha256: sha(upstream),
  transport: 'Scripted local Messages API, identical per scenario for both CLIs; --bare --print', cases, matched: results.length - mismatches.length, mismatches, exit_code: exitCode,
}, null, 2));
console.log(`${results.length - mismatches.length}/${results.length} scenarios match ${upstream.split('/').at(-1)} · evidence: ${artifacts}`);
process.exit(exitCode);
