#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs the compiled CLI; only the model transport is scripted. The fixture repo
// has a real commit so the review skill's git commands have something to read.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-review-e2e-')));
mkdirSync(artifacts, { recursive: true });
const model = 'claude-sonnet-4-6';
const finding = '[{"file":"src/a.ts","line":2,"summary":"E2E_FINDING_42 inverted guard","short_summary":"inverted guard","failure_scenario":"x → y","category":"correctness","verdict":"CONFIRMED"}]';

const fixture = mkdtempSync(join(tmpdir(), 'noa-review-fixture-'));
const git = (...a) => execFileSync('git', a, { cwd: fixture, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 'e2e@example.invalid');
git('config', 'user.name', 'e2e');
writeFileSync(join(fixture, 'a.ts'), 'export function ok(x: number) {\n  return x > 0\n}\n');
git('add', '.'); git('commit', '-qm', 'base');
writeFileSync(join(fixture, 'a.ts'), 'export function ok(x: number) {\n  return x < 0\n}\n');
git('commit', '-qam', 'invert guard');

const requests = [];
const sse = (res, text) => {
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const msg = { id: 'msg_e2e', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  ev('message_start', { message: msg });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  ev('message_stop', {});
  res.end();
};
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url.includes('count_tokens') ? '{"input_tokens":100}' : '{}');
    return;
  }
  const body = JSON.parse(raw || '{}');
  requests.push(JSON.stringify(body));
  sse(res, JSON.stringify(body).includes('expert code reviewer') ? finding : 'ok');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const configDir = join(artifacts, 'config');
mkdirSync(configDir, { recursive: true });

function runCli(prompt, tools) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG', 'LC_ALL', 'SHELL'].includes(k)));
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: 'local-e2e-dummy', ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: model, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
  });
  return new Promise(resolveRun => {
    const child = spawn(entry, ['--print', '--model', model, '--permission-mode', 'dontAsk', ...(tools ? ['--tools', tools] : []), '--max-turns', '3', prompt], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', code => { clearTimeout(timer); resolveRun({ code, out, err }); });
  });
}

const results = [];
async function scenario(name, prompt, tools, check) {
  requests.length = 0;
  const run = await runCli(prompt, tools);
  let failure;
  try {
    assert.equal(run.code, 0, `exit ${run.code}: ${run.err.slice(-500)}`);
    assert.ok(requests.length >= 1, 'no review request reached the scripted model');
    check(requests.join('\n'), run.out);
  } catch (error) {
    failure = String(error.message ?? error);
  }
  results.push({ name, prompt, tools, passed: !failure, failure, exit: run.code, reviewRequests: requests.length });
  writeFileSync(join(artifacts, `${name}.requests.json`), requests.join('\n'));
  writeFileSync(join(artifacts, `${name}.stdout.txt`), run.out);
  writeFileSync(join(artifacts, `${name}.stderr.txt`), run.err);
  console.log(`${failure ? 'FAIL' : 'PASS'} ${name}${failure ? `: ${failure}` : ''}`);
}

const ALL_TOOLS = undefined;
try {
  await scenario('explicit-effort-and-cap', '/code-review high --max-findings 3', ALL_TOOLS, (req, out) => {
    assert.ok(req.includes('Effort: high'), 'effort not applied');
    assert.ok(req.includes('at most 3 findings'), 'max-findings not applied');
    assert.ok(req.includes('recall'), 'high-tier lead-in missing');
    assert.ok(req.includes('via the Agent tool'), 'fan-out instruction missing with Agent tool');
    assert.ok(out.includes('E2E_FINDING_42'), 'model findings not returned to the user');
  });
  await scenario('reuse-last-effort-and-cap', '/code-review', ALL_TOOLS, req => {
    assert.ok(req.includes('Effort: high (reused from the level you typed last time; type a level'), 'last effort not reused');
    assert.ok(req.includes('at most 3 findings'), 'last max-findings not reused');
    assert.ok(req.includes('type a level like `/code-review high` to change it'), 'reuse hint missing');
    assert.ok(req.includes('Pass `--max-findings default` to go back to the usual limit.'), 'max reuse hint missing');
  });
  await scenario('uppercase-effort-and-pr-number', '/code-review HIGH #123 --comment', ALL_TOOLS, req => {
    assert.ok(req.includes('Effort: high'), 'uppercase effort not accepted');
    assert.ok(!req.includes('Ignoring unrecognized effort'), 'uppercase effort reported as unrecognized');
    assert.ok(req.includes('Post each surviving finding with `gh api`'), '#123 not treated as a PR');
    assert.ok(!req.includes('needs a PR target'), '#123 refused as a non-PR target');
  });
  await scenario('ultra-unsupported', '/code-review ultra', ALL_TOOLS, req => {
    assert.ok(req.includes('Noa does not support'), 'ultra was not refused');
    assert.ok(!req.includes('expert code reviewer'), 'ultra started a review');
  });
  await scenario('invalid-effort-and-max-notices', '/code-review hig --max-findings 0', ALL_TOOLS, req => {
    assert.ok(req.includes('Ignoring unrecognized effort \\"hig\\"; valid: low, medium, high, xhigh, max.'), 'unrecognized effort notice missing');
    assert.ok(req.includes('was ignored: type a whole number above zero'), 'invalid max-findings notice missing');
    assert.ok(req.includes('You set `--max-findings 3` last time.'), 'stored max not reported when the bad flag falls back to it');
    assert.ok(!req.includes('Using the usual limit.'), 'usual-limit notice shown although the stored limit is reused');
    assert.ok(req.includes('Effort: high (reused from the level you typed last time; type a level'), 'invalid effort should fall back to the last typed level');
  });
  await scenario('no-agent-tool-fallback', '/code-review medium', 'Read,Bash,Grep,Glob', req => {
    assert.ok(req.includes('tool is not available here'), 'single-pass fallback missing without Agent tool');
    assert.ok(!req.includes('via the Agent tool'), 'fan-out instruction present without Agent tool');
  });
  await scenario('low-tier-with-fix', '/review low --max-findings all --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('Review at low effort'), 'low tier prompt missing');
    assert.ok(req.includes('every finding that survives'), 'max-findings all not applied');
    assert.ok(req.includes('Apply a fix for each finding (low effort does not verify findings)'), 'low-tier fix section missing');
  });
  await scenario('flag-after-bad-max-is-kept', '/code-review medium --max-findings --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('was ignored: type a whole number'), 'bad max-findings value not reported');
    assert.ok(req.includes('Apply a fix for each CONFIRMED finding'), '--fix swallowed as the max-findings value');
  });
  await scenario('fix-refused-for-target', '/code-review 123 --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('change no files and say so'), '--fix not refused for a PR target');
    assert.ok(!req.includes('Apply a fix for each'), '--fix applied to a PR target');
  });
  await scenario('user-rules-path', '/code-review medium', ALL_TOOLS, req => {
    assert.ok(req.includes(`${configDir}/CLAUDE.md`), 'convention angle does not use the config home CLAUDE.md');
    assert.ok(!req.includes('~/.claude/CLAUDE.md'), 'hardcoded ~/.claude/CLAUDE.md still in the prompt');
  });
  await scenario('xhigh-candidate-budget', '/code-review max', ALL_TOOLS, req => {
    assert.ok(req.includes('up to 8 candidates'), 'xhigh/max finder budget does not match the tier line');
  });
  await scenario('comment-without-pr', '/code-review --comment', ALL_TOOLS, req => {
    assert.ok(req.includes('needs a PR target'), '--comment without PR not refused');
  });
} finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ entry, fixture, results }, null, 2));
}
const failed = results.filter(r => !r.passed).length;
console.log(`Evidence: ${artifacts}`);
process.exitCode = failed ? 1 : 0;
