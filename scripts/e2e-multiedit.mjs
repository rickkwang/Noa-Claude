#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Drives MultiEdit, background-shell output, encoding refusals and Bash input
// repair through the real CLI tools.
// Only the model transport is scripted: each request n returns the n-th scripted step.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-multiedit-e2e-')));
mkdirSync(artifacts, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const BG_MARK = 'BG_TASK_MARK_31';

let active = { requests: [], workspace: '' };
const toolResultText = (body, id) => {
  for (const message of body.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'tool_result' && block.tool_use_id === id) {
        return { text: typeof block.content === 'string' ? block.content : (block.content || []).map(b => b.text ?? '').join('\n'), isError: !!block.is_error };
      }
    }
  }
  return undefined;
};

// Scripted steps, indexed by request number (1-based). Each returns the next tool call or text.
const steps = [
  () => ({ tool: 'Read', id: 'read_1', input: { file_path: join(active.workspace, 'fixture.txt') } }),
  // Second edit misses: nothing may be written.
  () => ({ tool: 'MultiEdit', id: 'multi_bad', input: { file_path: join(active.workspace, 'fixture.txt'), edits: [{ old_string: 'ALPHA', new_string: 'ONE' }, { old_string: 'MISSING_TOKEN', new_string: 'X' }] } }),
  // Two independent edits in one call; both must land in the single write.
  () => ({ tool: 'MultiEdit', id: 'multi_good', input: { file_path: join(active.workspace, 'fixture.txt'), edits: [{ old_string: 'ALPHA', new_string: 'ONE' }, { old_string: 'BETA', new_string: 'GAMMA' }] } }),
  () => ({ tool: 'Bash', id: 'bg_start', input: { command: `echo ${BG_MARK}`, description: 'Background marker', run_in_background: true } }),
  () => ({ tool: 'Bash', id: 'settle', input: { command: 'sleep 1', description: 'Let background task finish' } }),
  () => {
    const output = toolResultText(active.requests.at(-2).body, 'bg_start')?.text ?? '';
    const path = output.match(/to: (\/\S+?)\.?(?:\s|$)/)?.[1];
    assert.ok(path, `background output path missing from: ${output.slice(0, 200)}`);
    return { tool: 'Read', id: 'read_bg', input: { file_path: path } };
  },
  // A GBK file: Edit and Write must refuse rather than rewrite it as U+FFFD.
  () => ({ tool: 'Read', id: 'read_gbk', input: { file_path: join(active.workspace, 'gbk.txt') } }),
  () => ({ tool: 'Edit', id: 'edit_gbk', input: { file_path: join(active.workspace, 'gbk.txt'), old_string: 'hello', new_string: 'world' } }),
  () => ({ tool: 'Write', id: 'write_gbk', input: { file_path: join(active.workspace, 'gbk.txt'), content: 'replaced\n' } }),
  // Field names models commonly send instead of `description` / `timeout`.
  () => ({ tool: 'Bash', id: 'bash_alias', input: { command: 'echo BASH_ALIAS_OK', command_description: 'Echo marker', timeout_ms: 5000 } }),
  () => ({ text: 'MULTIEDIT_DONE' }),
];

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":100}'); return;
  }
  const body = JSON.parse(raw || '{}');
  active.requests.push({ path: req.url, headers: req.headers, body });
  const n = active.requests.length;
  const step = (steps[n - 1] ?? steps.at(-1))();
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  emit('message_start', { message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  if (step.tool) {
    emit('content_block_start', { index: 0, content_block: { type: 'tool_use', id: step.id, name: step.tool, input: {} } });
    emit('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } });
    emit('content_block_stop', { index: 0 });
    emit('message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } });
  } else {
    emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: step.text } });
    emit('content_block_stop', { index: 0 });
    emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  }
  emit('message_stop', {});
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${server.address().port}`;

const FIXTURE = 'ALPHA BETA\n';
// "中文 hello" encoded as GBK.
const GBK_FIXTURE = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x20, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0a]);

async function run() {
  const dir = join(artifacts, 'multiedit');
  mkdirSync(dir, { recursive: true });
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'fixture.txt'), FIXTURE);
  writeFileSync(join(workspace, 'gbk.txt'), GBK_FIXTURE);
  active = { requests: [], workspace };
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: join(dir, 'config'),
    ANTHROPIC_API_KEY: 'local-e2e-dummy',
    DISABLE_AUTOUPDATER: '1',
    ANTHROPIC_BASE_URL: local,
  });
  const command = ['--print', 'Run the MultiEdit fixture.', '--output-format', 'json', '--model', 'claude-opus-5-5', '--dangerously-skip-permissions'];
  const [bin, binArgs] = entry.endsWith('.js') ? ['bun', [entry, ...command]] : [entry, command];
  const child = spawn(bin, binArgs, { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 60000);
  const exit = await new Promise((done, reject) => { child.on('error', reject); child.on('close', (code, signal) => done({ code, signal })); });
  clearTimeout(timeout);
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
  writeFileSync(join(dir, 'stdout.txt'), stdout);
  writeFileSync(join(dir, 'stderr.txt'), stderr);
  assert.equal(exit.signal, null, `CLI terminated by ${exit.signal}: ${stderr.slice(0, 200)}`);
  return { dir, exit, stdout, stderr, workspace };
}

function check({ exit, stdout, stderr, workspace }) {
  assert.equal(exit.code, 0, `exit ${exit.code}: ${stderr.slice(0, 300)}`);
  const result = JSON.parse(stdout);
  assert.equal(result.terminal_reason, 'completed');
  assert.equal(active.requests.length, steps.length, `expected ${steps.length} requests, got ${active.requests.length}`);

  const bad = toolResultText(active.requests[2].body, 'multi_bad');
  assert.ok(bad?.isError, `invalid MultiEdit was not rejected: ${bad?.text}`);
  assert.match(bad.text, /No changes were written/);
  assert.match(bad.text, /Edit 2/, 'failing edit not named');

  const good = toolResultText(active.requests[3].body, 'multi_good');
  assert.ok(!good?.isError, `valid MultiEdit failed: ${good?.text}`);
  assert.match(good.text, /2 edit\(s\), all applied/);

  const finalFile = readFileSync(join(workspace, 'fixture.txt'), 'utf8');
  assert.equal(finalFile, 'ONE GAMMA\n', `file after MultiEdit is ${JSON.stringify(finalFile)}`);

  const bgRead = toolResultText(active.requests[6].body, 'read_bg');
  assert.ok(bgRead?.text.includes(BG_MARK), `background output not readable via Read: ${bgRead?.text?.slice(0, 200)}`);

  for (const [index, id] of [[8, 'edit_gbk'], [9, 'write_gbk']]) {
    const refused = toolResultText(active.requests[index].body, id);
    assert.ok(refused?.isError, `${id} was not refused: ${refused?.text}`);
    assert.match(refused.text, /not valid UTF-8/);
  }
  const gbkAfter = readFileSync(join(workspace, 'gbk.txt'));
  assert.ok(gbkAfter.equals(GBK_FIXTURE), `GBK file changed: ${gbkAfter.toString('hex')}`);

  const alias = toolResultText(active.requests[10].body, 'bash_alias');
  assert.ok(!alias?.isError, `Bash with aliased fields failed: ${alias?.text}`);
  assert.match(alias.text, /BASH_ALIAS_OK/);
  return { final_file: finalFile, bad_edit_result: bad.text.slice(0, 200), bg_read_contains_marker: true, gbk_unchanged: true, bash_alias_ok: true };
}

const results = [];
let outcome;
try {
  const ran = await run();
  try {
    outcome = { passed: true, observed: check(ran) };
  } catch (error) {
    outcome = { passed: false, failure: String(error) };
  }
  results.push({ scenario: 'multiedit-and-bg-output', ...outcome });
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`${outcome.passed ? 'PASS' : 'FAIL'} multiedit-and-bg-output${outcome.failure ? `: ${outcome.failure}` : ''}`);
} catch (error) {
  console.log(`FAIL multiedit-and-bg-output: ${error}`);
  outcome = { passed: false, failure: String(error) };
  results.push({ scenario: 'multiedit-and-bg-output', ...outcome });
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
    transport: 'deterministic localhost Anthropic SSE; scripted tool calls, no model-quality benchmark',
    entry, entry_sha256: shaOf(entry),
    script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    results_sha256: shaOf(join(artifacts, 'results.json')),
    passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
