#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercises the compiled CLI and actual tools; only the model transport is scripted.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const compare = option('--compare');
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-loop-e2e-')));
mkdirSync(artifacts, { recursive: true });
const model = 'claude-sonnet-4-6';
const sentinel = 'KEEP_IDENTIFIER=loop-sentinel-42';
const cases = ['read', 'large-output', 'max-turns', 'malformed', 'empty', 'alternating', 'fallback', 'refusal', 'refusal-repeat', 'budget-streaming', 'budget-nonstream', 'permission-deny', 'deny-rule', 'hook-block', 'compact-resume'].filter(name => !option('--case') || name === option('--case'));
assert.ok(cases.length > 0, 'unknown --case');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const textOf = content => typeof content === 'string' ? content : (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let active;

const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (!req.url.includes('/messages')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
    }
    if (req.url.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"input_tokens":100}');
      return;
    }
    const lastText = textOf(body.messages?.at(-1)?.content);
    const summary = lastText.startsWith('CRITICAL: Respond with TEXT ONLY.') || /create a detailed continuation summary|summarize the recent messages|summary of the conversation|summarizing.*conversation/i.test(lastText);
    active.requests.push({ path: req.url, body, summary });
    writeFileSync(join(active.dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
    const n = active.requests.filter(r => !r.summary).length;
    const error = (status, type, message) => {
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0', 'x-should-retry': status === 529 ? 'true' : 'false' });
      res.end(JSON.stringify({ type: 'error', error: { type, message } }));
    };
    if (active.case === 'fallback' && n <= 8) {
      error(529, 'overloaded_error', 'Scripted overload on primary and fallback');
      return;
    }
    let content, stop = 'end_turn';
    if (summary) {
      active.summaries++;
      assert.ok(JSON.stringify(body.messages).includes(sentinel), 'summary request lost original constraint');
      content = [{ type: 'text', text: `<summary>Original project constraint: ${sentinel}. Continue the active task; bulky pasted data is omitted.</summary>` }];
    } else if (active.case === 'large-output') {
      content = [{ type: 'text', text: 'Z'.repeat(180000) }];
    } else if (active.case === 'compact-resume' && active.phase === 'resume') {
      if (raw.length > 500_000) {
        active.oversized++;
        error(400, 'invalid_request_error', 'prompt is too long: 280000 tokens > 200000 maximum');
        return;
      }
      assert.ok(raw.includes(sentinel), 'postcompact request lost original constraint');
      content = [{ type: 'text', text: 'AUDIT_OK' }];
    } else if ((active.case === 'malformed' && n === 1) || (active.case === 'alternating' && n <= 8 && n % 2 === 1)) {
      content = [{ type: 'text', text: 'Calling a tool now.' }]; stop = 'tool_use';
    } else if ((active.case === 'empty' && n === 1) || (active.case === 'alternating' && n <= 8 && n % 2 === 0)) {
      content = [];
    } else if ((active.case === 'refusal' && n === 1) || active.case === 'refusal-repeat') {
      content = [{ type: 'text', text: 'Partial answer.' }]; stop = 'refusal';
    } else if (active.case.startsWith('budget-')) {
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'printf started > started.txt; sleep 2; printf finished > finished.txt', timeout: 10000 } }]; stop = 'tool_use';
    } else if ((active.case === 'permission-deny' || active.case === 'deny-rule') && n === 1) {
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'printf denied > denied.txt' } }]; stop = 'tool_use';
    } else if (active.case === 'max-turns' || ((active.case === 'read' || active.case === 'hook-block') && n === 1) || (active.case === 'compact-resume' && n <= 3)) {
      content = [
        ...(active.case === 'compact-resume' ? [{ type: 'text', text: 'prior-context '.repeat(5000) }] : []),
        { type: 'tool_use', id: `toolu_${n}`, name: 'Read', input: { file_path: join(active.dir, 'fixture.txt') } },
      ]; stop = 'tool_use';
    } else {
      content = [{ type: 'text', text: 'AUDIT_OK' }];
    }
    const msg = { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg)); return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    emit('message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } });
    for (const [index, block] of content.entries()) {
      emit('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
      emit('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      emit('content_block_stop', { type: 'content_block_stop', index });
    }
    if (active.case === 'budget-streaming') {
      for (let i = 0; i < 100 && !existsSync(join(active.dir, 'started.txt')); i++) await delay(20);
    }
    emit('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } });
    emit('message_stop', { type: 'message_stop' });
    res.end();
  } catch (error) {
    active.transportError = String(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const results = [];
const children = new Set();

async function run(executable, scenario, extra = [], input = 'Run the local loop fixture.') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: join(active.dir, 'config'), ANTHROPIC_API_KEY: 'local-e2e-dummy', ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: model, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    NOA_CLAUDE_STREAMING_TOOL_EXECUTION: scenario === 'budget-nonstream' ? '0' : '1', FALLBACK_FOR_ALL_PRIMARY_MODELS: '1', CLAUDE_CODE_EAGER_FLUSH: '1',
  });
  const streamingInput = scenario.startsWith('budget-');
  // Hooks are off under --bare, so the hook scenario runs the full startup path.
  const command = [...(scenario === 'hook-block' ? [] : ['--bare']), '--print', '--verbose', '--output-format', 'stream-json', '--model', model, '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', 'Read,Bash', '--max-turns', scenario === 'compact-resume' ? '6' : '2'];
  if (scenario !== 'compact-resume') command.push('--no-session-persistence');
  if (scenario === 'fallback') command.push('--fallback-model', 'claude-haiku-4-5');
  // An allow rule that the narrower deny rule must still beat.
  if (scenario === 'deny-rule') command.push('--allowedTools', 'Bash', '--disallowedTools', 'Bash(printf:*)');
  if (scenario === 'hook-block') command.push('--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'printf ran > hook-ran.txt; echo HOOK_BLOCKED_42 >&2; exit 2' }] }] } }));
  if (streamingInput) command.push('--input-format', 'stream-json', '--allowedTools', 'Bash', '--max-budget-usd', '0.0001');
  command.push(...extra);
  const started = performance.now();
  // A bundle (dist/main-dev.js) has no shebang; run it through bun.
  const [bin, binArgs] = executable.endsWith('.js') ? ['bun', [executable, ...command]] : [executable, command];
  const child = spawn(bin, binArgs, { cwd: active.dir, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  children.add(child);
  let stdout = '', stderr = '', pending = '', result;
  let budgetObservation;
  const timeout = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), 20000);
  child.stdout.on('data', chunk => {
    const s = chunk.toString(); stdout += s; pending += s;
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'result') {
        result = event;
        if (streamingInput && !budgetObservation) {
          active.startedAtResult = existsSync(join(active.dir, 'started.txt'));
          active.finishedAtResult = existsSync(join(active.dir, 'finished.txt'));
          budgetObservation = delay(2500).then(() => {
            active.started = existsSync(join(active.dir, 'started.txt'));
            active.finished = existsSync(join(active.dir, 'finished.txt'));
            child.stdin.end();
          });
        }
      }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal }));
  });
  if (streamingInput) child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: input } }) + '\n');
  else child.stdin.end(input);
  const exit = await closed;
  clearTimeout(timeout); children.delete(child);
  await budgetObservation;
  const label = active.phase || 'run';
  writeFileSync(join(active.dir, `${label}-stdout.jsonl`), stdout);
  writeFileSync(join(active.dir, `${label}-stderr.txt`), stderr);
  active.invocations.push({ executable, args: command, input_sha256: sha(input), exit, seconds: (performance.now() - started) / 1000 });
  assert.equal(exit.signal, null, `CLI terminated by ${exit.signal}: ${stderr.slice(0, 200)}`);
  assert.ok(result, `no result event: ${stderr.slice(0, 300)}`);
  return { result, code: exit.code };
}

try {
  for (const executable of [entry, ...(compare ? [resolve(compare)] : [])]) {
    for (const scenario of cases) {
      if (executable !== entry && scenario === 'compact-resume') continue;
      const dir = join(artifacts, `${executable === entry ? 'candidate' : 'comparison'}-${scenario}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'fixture.txt'), 'LOCAL_FIXTURE_42\n');
      active = { case: scenario, dir, requests: [], invocations: [], summaries: 0, oversized: 0 };
      let passed = false, failure, observation, runResult;
      try {
        if (scenario === 'compact-resume') {
          active.phase = 'seed';
          const seed = await run(executable, scenario, [], `PROJECT_CONSTRAINT: ${sentinel}. Read the fixture three times, then pause.`);
          assert.equal(seed.code, 0);
          active.phase = 'resume';
          writeFileSync(join(dir, 'resume-input.txt'), 'Continue the prior task. Bulky input follows:\n' + 'x'.repeat(1000000));
          runResult = await run(executable, scenario, ['--resume', seed.result.session_id], readFileSync(join(dir, 'resume-input.txt'), 'utf8'));
          assert.equal(runResult.code, 0);
          assert.equal(runResult.result.result, 'AUDIT_OK');
          assert.ok(active.summaries > 0, 'compaction never executed');
          assert.equal(active.oversized, 0, 'oversized verbatim tail reached the model after compaction');
        } else {
          runResult = await run(executable, scenario);
          const count = active.requests.length;
          // Without --bare the CLI also makes side requests; the loop's own carry the tool list.
          const main = active.requests.filter(r => r.body.tools?.length);
          if (scenario === 'alternating' || scenario === 'fallback') {
            assert.equal(runResult.code, 1, 'recovery only stopped when the scripted provider succeeded');
            assert.equal(runResult.result.is_error, true);
            // An error before the first request also ends with is_error; that is a crash, not bounded recovery.
            assert.ok(count >= 2, `recovery never ran: ${count} requests`);
            assert.ok(count <= (scenario === 'fallback' ? 6 : 3), `unbounded recovery: ${count} requests`);
          } else if (scenario === 'refusal-repeat') {
            assert.equal(runResult.result.is_error, true); assert.equal(count, 2, `refusal retried ${count - 1} times`);
          } else if (scenario === 'large-output') {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'Z'.repeat(180000)); assert.equal(count, 1);
          } else if (scenario === 'max-turns') {
            assert.equal(runResult.result.subtype, 'error_max_turns'); assert.equal(count, 2);
          } else if (scenario.startsWith('budget-')) {
            assert.equal(runResult.result.subtype, 'error_max_budget_usd');
            if (scenario === 'budget-streaming') assert.equal(active.started, true, 'Bash did not start; cancellation path untested');
            assert.equal(active.finishedAtResult, false, 'Bash already finished before the budget result');
            assert.equal(active.finished, false, 'Bash wrote after the terminal budget result');
          } else if (scenario === 'permission-deny' || scenario === 'deny-rule') {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            assert.equal(existsSync(join(dir, 'denied.txt')), false, 'denied Bash command still ran');
            const toolResult = main[1]?.body.messages.at(-1).content.find(b => b.type === 'tool_result');
            assert.equal(toolResult?.is_error, true, 'denial was not reported to the model as an error');
            assert.deepEqual(runResult.result.permission_denials.map(d => d.tool_name), ['Bash']);
          } else if (scenario === 'hook-block') {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            assert.equal(existsSync(join(dir, 'hook-ran.txt')), true, 'PreToolUse hook never ran; block path untested');
            const followUp = JSON.stringify(main[1]?.body.messages);
            assert.ok(followUp.includes('HOOK_BLOCKED_42'), 'hook block reason did not reach the model');
            assert.ok(!followUp.includes('LOCAL_FIXTURE_42'), 'Read ran despite the blocking hook');
          } else {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK'); assert.equal(count, 2);
            if (scenario === 'refusal') assert.ok(JSON.stringify(active.requests[1].body.messages).includes('stopped by a safety classifier'), 'retry did not tell the model why it stopped');
            if (scenario === 'read') assert.ok(JSON.stringify(active.requests[1].body.messages).includes('LOCAL_FIXTURE_42'), 'actual Read result missing');
          }
        }
        assert.equal(active.transportError, undefined);
        passed = true;
      } catch (error) { failure = String(error); }
      observation = { result: runResult?.result, requests: active.requests.length, summaries: active.summaries, oversized: active.oversized, startedAtResult: active.startedAtResult, finishedAtResult: active.finishedAtResult, started: active.started, finished: active.finished };
      results.push({ executable, required: executable === entry, scenario, passed, failure, observation, invocations: active.invocations });
      writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
      console.log(`${passed ? 'PASS' : 'FAIL'} ${executable === entry ? 'candidate' : 'comparison'} ${scenario}${failure ? `: ${failure}` : ''}`);
    }
  }
} finally {
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
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
    entry, entry_sha256: shaOf(entry), comparison: compare ? { entry: resolve(compare), sha256: shaOf(resolve(compare)) } : undefined,
    script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    results_sha256: shaOf(join(artifacts, 'results.json')),
    passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => r.required && !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => r.required && !r.passed) ? 1 : 0;
