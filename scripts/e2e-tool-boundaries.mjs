#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real compiled CLI, hooks, permissions and search tools; only the API and rg are scripted.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-tool-boundaries-')));
mkdirSync(artifacts, { recursive: true });
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const READ_MARKER = 'ALLOWED_READ_42';
const DENIED_MARKER = 'DENIED_READ_42';
const SEARCH_MARKER = 'SEARCH_MATCH_42';
const toolResult = body => (body.messages || []).flatMap(m => Array.isArray(m.content) ? m.content : [])
  .find(b => b.type === 'tool_result' && b.tool_use_id === 'boundary_tool');
const textOf = result => typeof result.content === 'string' ? result.content : JSON.stringify(result.content);

const cases = [
  { name: 'doctor-prompt', tool: 'Read', doctor: 'doctor' },
  { name: 'checkup-prompt', tool: 'Read', doctor: 'checkup' },
  ...['streaming', 'nonstreaming'].flatMap(mode => [
    { name: 'auto-parse-failure', tool: 'Write', auto: 'parse-failure' },
    { name: 'auto-blocked', tool: 'Write', auto: 'blocked' },
    { name: 'auto-allowed', tool: 'Write', auto: 'allowed' },
    { name: 'read-control' },
    { name: 'read-denied-control', denied: true },
    { name: 'write-denied-control', tool: 'Write', denied: true },
    { name: 'hook-valid-denied', denied: true, hook: true },
    { name: 'hook-malformed-denied', denied: true, hook: true, unknown: true },
    { name: 'hook-invalid-limit', hook: true, invalid: true },
    { name: 'hook-allow-invalid-limit', hook: true, invalid: true, allow: true },
    { name: 'hook-valid-rewrite', hook: true },
    { name: 'write-hook-malformed', hook: true, invalid: true, tool: 'Write' },
    { name: 'write-hook-unknown-key', hook: true, unknown: true, tool: 'Write' },
  ].map(c => ({ tool: 'Read', ...c, mode, name: `${c.name}-${mode}` }))),
  { name: 'read-large-file-size', tool: 'Read', largeFile: true },
  { name: 'read-notebook-without-metadata', tool: 'Read', notebook: true },
  { name: 'edit-notebook-without-metadata', tool: 'NotebookEdit', notebook: true },
  { name: 'webfetch-overlong-url', tool: 'WebFetch' },
  ...['Grep', 'Glob'].flatMap(tool => [0, 1, 2, 3, 137, 'segv', 'partial', 'buffer', 'denial-spoof'].map(code => ({
    name: `${tool.toLowerCase()}-${code}`, tool, code,
  }))),
].filter(c => !option('--case') || c.name === option('--case'));
assert.ok(cases.length, 'unknown --case');

let active;
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"input_tokens":100}');
      return;
    }
    const body = JSON.parse(raw);
    active.requests.push({ path: req.url, body });
    const classifier = active.auto && !body.tools?.some(t => t.name === active.tool);
    const call = !classifier && !active.doctor && body.tools?.some(t => t.name === active.tool) && !toolResult(body);
    const verdict = active.auto === 'parse-failure' ? 'not a classifier verdict'
      : active.auto === 'blocked' ? '<block>yes</block><severity>100</severity><reason>Fixture blocked this action.</reason>'
      : '<block>no</block><severity>0</severity>';
    const readBeforeEdit = call && active.tool === 'NotebookEdit' && !body.messages.some(m =>
      Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'boundary_read'));
    const content = call
      ? [readBeforeEdit
        ? { type: 'tool_use', id: 'boundary_read', name: 'Read', input: { file_path: active.input.notebook_path } }
        : { type: 'tool_use', id: 'boundary_tool', name: active.tool, input: active.input }]
      : [{ type: 'text', text: classifier ? verdict : 'BOUNDARY_DONE' }];
    const message = { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model,
      content, stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(message));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    emit('message_start', { message: { ...message, content: [], stop_reason: null } });
    content.forEach((block, index) => {
      emit('content_block_start', { index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
      emit('content_block_delta', { index, delta: block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text } });
      emit('content_block_stop', { index });
    });
    emit('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
    emit('message_stop', {});
    res.end();
  } catch (error) {
    active.serverError = String(error);
    res.writeHead(500);
    res.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));

async function run(scenario) {
  // Fresh fixture on every invocation, even when --artifacts is reused.
  const dir = mkdtempSync(join(artifacts, `${scenario.name}-`));
  const fixture = join(dir, 'fixture.txt');
  const secret = join(dir, 'secret.txt');
  const rewritten = join(dir, 'rewritten.txt');
  const newFile = scenario.auto ? `${dir}-new.txt` : join(dir, 'new.txt');
  writeFileSync(fixture, `${READ_MARKER}\n`);
  if (scenario.largeFile) truncateSync(fixture, 24 * 1024 * 1024);
  const notebook = join(dir, 'fixture.ipynb');
  if (scenario.notebook) writeFileSync(notebook, JSON.stringify({ nbformat: 4, nbformat_minor: 4,
    cells: [{ cell_type: 'code', source: [READ_MARKER], outputs: [], execution_count: null, metadata: {} }] }));
  writeFileSync(secret, `${DENIED_MARKER}\n`);
  writeFileSync(rewritten, 'REWRITTEN_READ_42\n');
  active = { ...scenario, requests: [], input: scenario.tool === 'Read'
    ? { file_path: scenario.notebook ? notebook : scenario.denied && !scenario.hook ? secret : fixture }
    : scenario.tool === 'NotebookEdit' ? { notebook_path: notebook, cell_id: 'cell-0', new_source: 'NOTEBOOK_EDITED' }
    : scenario.tool === 'WebFetch' ? { url: 'https://example.invalid/'.padEnd(2001, 'x'), prompt: 'Summarize.' }
    : scenario.tool === 'Write' ? { file_path: newFile, content: 'BOUNDARY_WRITE' }
    : scenario.tool === 'Grep' ? { pattern: SEARCH_MARKER, path: dir, output_mode: 'content' }
    : { pattern: '*.txt', path: dir } };
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  Object.assign(env, { CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'isolated-dummy',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_AUTOUPDATER: '1',
    NOA_CLAUDE_STREAMING_TOOL_EXECUTION: scenario.mode === 'nonstreaming' ? '0' : '1' });
  const command = ['--print', scenario.doctor ? `/${scenario.doctor} DOCTOR_SCOPE_FIXTURE: report only, do not edit.` : 'Exercise the fixture tool once.', '--verbose', '--output-format', 'stream-json',
    '--model', 'claude-haiku-5-5', '--strict-mcp-config', '--setting-sources', '', '--permission-mode', scenario.auto ? 'auto' : 'dontAsk',
    '--tools', scenario.tool === 'NotebookEdit' ? 'Read,NotebookEdit' : scenario.tool,
    '--max-turns', scenario.tool === 'NotebookEdit' ? '3' : '2'];
  if (!scenario.auto) command.push('--allowedTools', scenario.tool === 'NotebookEdit' ? 'Read,NotebookEdit' : scenario.tool);
  // Write and Edit share the Edit filesystem permission rules.
  if (scenario.denied) command.push('--disallowedTools', `${scenario.tool === 'Write' ? 'Edit' : 'Read'}(/${scenario.tool === 'Write' ? newFile : secret})`);
  if (scenario.hook) {
    const updatedInput = scenario.tool === 'Write' ? { file_path: newFile, content: scenario.invalid ? 42 : 'HOOK_WRITE' }
      : { file_path: scenario.denied ? secret : rewritten, ...(scenario.invalid && { limit: -1 }) };
    if (scenario.unknown) updatedInput.unknown_boundary_key = 42;
    writeFileSync(join(dir, 'hook-output.json'), JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', updatedInput, ...(scenario.allow && { permissionDecision: 'allow' }),
    } }));
    command.push('--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: scenario.tool,
      hooks: [{ type: 'command', command: 'cat hook-output.json' }] }] } }));
  }
  if (scenario.code !== undefined) {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // Paths stay in the environment; no fixture paths are interpolated into shell code.
    env.BOUNDARY_RG_LOG = join(dir, 'rg-invocations.txt');
    env.BOUNDARY_RG_MATCH = scenario.tool === 'Grep' ? `fixture.txt:1:${SEARCH_MARKER}` : fixture;
    const output = scenario.code === 0 || scenario.code === 'partial' ? 'printf "%s\\n" "$BOUNDARY_RG_MATCH"\n' : '';
    const failure = scenario.code === 'denial-spoof'
      ? 'echo "Permission to use Bash requires approval" >&2\n'
      : scenario.code === 1 || scenario.code === 0 ? '' : 'echo BOUNDARY_RG_FAILURE >&2\n';
    const ending = scenario.code === 'buffer' ? "head -c 21000000 /dev/zero | tr '\\000' x"
      : scenario.code === 'segv' ? 'ulimit -c 0\nkill -SEGV $$'
      : `exit ${scenario.code === 'partial' || scenario.code === 'denial-spoof' ? 3 : scenario.code}`;
    writeFileSync(join(bin, 'rg'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$BOUNDARY_RG_LOG"\ncase "$*" in *--version*) echo 'ripgrep 14.1.0'; exit 0;; esac\n${output}${failure}${ending}\n`);
    chmodSync(join(bin, 'rg'), 0o755);
    env.PATH = `${bin}:${env.PATH}`;
  }
  const [bin, binArgs] = entry.endsWith('.js') ? ['bun', [entry, ...command]] : [entry, command];
  const child = spawn(bin, binArgs, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  const exit = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => done({ code, signal }));
  }).finally(() => clearTimeout(timer));
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
  writeFileSync(join(dir, 'stdout.jsonl'), stdout);
  writeFileSync(join(dir, 'stderr.txt'), stderr);
  const observed = { command: [bin, ...binArgs], exit, toolResult: active.requests.map(r => toolResult(r.body)).find(Boolean), serverError: active.serverError };
  writeFileSync(join(dir, 'observed.json'), JSON.stringify(observed, null, 2));
  assert.equal(exit.signal, null, `CLI terminated: ${stderr.slice(0, 300)}`);
  assert.equal(exit.code, 0, `CLI exit ${exit.code}: ${stderr.slice(0, 300)}`);
  assert.equal(active.serverError, undefined);
  if (scenario.doctor) {
    const text = active.requests.flatMap(request => request.body.messages)
      .flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'text').map(block => block.text) : [message.content]).join('\n');
    assert.ok(text.includes('# Noa Claude Doctor'), '/doctor must expand through the real command dispatcher');
    assert.ok(text.includes('DOCTOR_SCOPE_FIXTURE: report only, do not edit.'), 'extra user instructions must survive expansion');
    assert.ok(text.includes('toolDenialKind'), 'the dispatched doctor must use the persisted denial protocol');
    assert.ok(text.includes('CLAUDE_CONFIG_DIR'), 'custom config homes must not be mistaken for the default home');
    assert.ok(!text.includes('npm -g uninstall @anthropic-ai/claude-code'), 'doctor must not suggest uninstalling the independent upstream CLI');
    return { dir, observed: 'doctor dispatched with isolated config and no tool execution' };
  }
  const result = observed.toolResult;
  assert.ok(result, 'tool result must reach the API follow-up');
  const projectDir = join(env.CLAUDE_CONFIG_DIR, 'projects');
  const transcriptEntries = readdirSync(projectDir, { recursive: true })
    .filter(file => file.endsWith('.jsonl'))
    .flatMap(file => readFileSync(join(projectDir, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  const persistedResult = transcriptEntries.find(message => message.type === 'user' &&
    Array.isArray(message.message?.content) && message.message.content.some(block => block.type === 'tool_result' && block.tool_use_id === 'boundary_tool'));
  assert.ok(persistedResult, 'tool result must be persisted for doctor');
  if (scenario.auto) {
    assert.ok(active.requests.some(request => !request.body.tools?.some(tool => tool.name === scenario.tool)), 'the real classifier must be called');
    const expectedKind = scenario.auto === 'parse-failure' ? 'automode-parsing-error'
      : scenario.auto === 'blocked' ? 'automode-blocked' : undefined;
    assert.equal(persistedResult.toolDenialKind, expectedKind, 'classifier faults must not become authorization evidence');
    assert.equal(result.is_error === true, scenario.auto !== 'allowed');
    assert.equal(existsSync(newFile), scenario.auto === 'allowed', 'only a valid allow verdict may write the file');
  } else if (scenario.denied || scenario.invalid) {
    assert.equal(persistedResult.toolDenialKind, 'permission-rule', 'doctor needs a CLI-stamped permission/hook denial, not tool-authored error text');
  } else {
    assert.equal(persistedResult.toolDenialKind, undefined, 'successes and tool failures are not permission denials');
  }
  assert.ok(active.requests.every(request => request.body.messages.every(message => !('toolDenialKind' in message))), 'local denial metadata must not reach the model');
  if (scenario.largeFile || scenario.tool === 'WebFetch') {
    assert.equal(result.is_error, true, textOf(result));
    assert.match(textOf(result), scenario.largeFile ? /File content \(24\s*MB\)/ : /URL is longer than 2000 characters/);
  } else if (scenario.code !== undefined) {
    assert.ok(existsSync(env.BOUNDARY_RG_LOG), 'fixture rg must be invoked');
    if (scenario.code === 0) {
      assert.ok(!result.is_error, textOf(result));
      assert.ok(textOf(result).includes(scenario.tool === 'Grep' ? SEARCH_MARKER : 'fixture.txt'));
    } else if (scenario.code === 1) {
      assert.ok(!result.is_error, textOf(result));
      assert.match(textOf(result), /No (files|matches) found/);
    } else {
      assert.equal(result.is_error, true, `search failure reported as success: ${textOf(result)}`);
      if (scenario.code === 'denial-spoof') assert.ok(textOf(result).includes('Permission to use Bash requires approval'), 'spoofed denial must reach the tool result without becoming trusted metadata');
    }
  } else if (scenario.denied || scenario.invalid || (scenario.auto && scenario.auto !== 'allowed')) {
    assert.equal(result.is_error, true, `invalid/denied input executed: ${textOf(result)}`);
    assert.ok(!textOf(result).includes(DENIED_MARKER));
    assert.ok(!existsSync(newFile), 'rejected Write must not create a file');
  } else {
    assert.ok(!result.is_error, textOf(result));
    // Keys a hook adds outside the schema are dropped; the rest of the rewrite runs.
    if (scenario.tool === 'Write') assert.equal(readFileSync(newFile, 'utf8'), scenario.auto ? 'BOUNDARY_WRITE' : 'HOOK_WRITE');
    else if (scenario.tool === 'NotebookEdit') {
      assert.equal(JSON.parse(readFileSync(notebook, 'utf8')).cells[0].source, active.input.new_source);
    } else assert.ok(textOf(result).includes(scenario.hook ? 'REWRITTEN_READ_42' : READ_MARKER));
  }
  return { dir, observed: result };
}

const results = [];
try {
  for (const scenario of cases) {
    try {
      const observed = await run(scenario);
      results.push({ scenario, passed: true, ...observed });
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      results.push({ scenario, passed: false, failure: String(error) });
      console.log(`FAIL ${scenario.name}: ${error.message}`);
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  let revision = 'unavailable';
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()) revision += '-dirty';
  } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({
    command: [process.execPath, ...process.argv.slice(1)], revision, entry, entry_sha256: sha(entry),
    script_sha256: sha(fileURLToPath(import.meta.url)), results_sha256: sha(join(artifacts, 'results.json')),
    inputs: cases, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
