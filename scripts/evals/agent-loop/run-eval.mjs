#!/usr/bin/env node
// agent-loop eval: runs the real `noa --print` entry point on each case's historical snapshot and grades the end state.
// Each attempt gets a fresh single-commit copy of <sha>^ (no history, so the fix is unreachable via git) and an isolated HOME.
// The hidden test (from the fix commit) is copied in only after the agent finishes.
//
// usage: node run-eval.mjs [--reps N] [--concurrency N] [--timeout-s N] [--max-cost-usd N] [--case GLOB]... [--out DIR] [--variant DIR (appends DIR/skill.md to the system prompt)] [--approve-harness] [--keep-temp]
// EVAL_NOA_BIN overrides the entry point (used for the free oracle/null checks with fake-noa.mjs; the harness gate is skipped then).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const FAKE = !!process.env.EVAL_NOA_BIN;
const NOA = process.env.EVAL_NOA_BIN || join(REPO, 'bin/noa.js');
const MODEL = 'claude-haiku-5-5';
const eprint = (...a) => console.error(...a);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const git = (dir, ...a) => sh('git', ['-C', dir, '-c', 'user.name=eval', '-c', 'user.email=e@e', ...a]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- args ----
const args = { reps: 2, concurrency: 2, timeoutS: 900, maxCostUsd: null, cases: [], out: join(REPO, '.claude/hillclimb/agent-loop'), variant: null, approve: false, keepTemp: false };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i], v = () => process.argv[++i];
  if (k === '--reps') args.reps = +v();
  else if (k === '--concurrency') args.concurrency = +v();
  else if (k === '--timeout-s') args.timeoutS = +v();
  else if (k === '--max-cost-usd') args.maxCostUsd = +v();
  else if (k === '--case') args.cases.push(v());
  else if (k === '--out') args.out = resolve(v());
  else if (k === '--variant') args.variant = resolve(v());
  else if (k === '--approve-harness') args.approve = true;
  else if (k === '--keep-temp') args.keepTemp = true;
  else { eprint(`unknown argument: ${k}`); process.exit(2); }
}

// ---- harness gate: the paid path refuses to run until the user approves the current runner + cases ----
const harnessSha = createHash('sha256').update(readFileSync(join(HERE, 'run-eval.mjs'))).update(readFileSync(join(HERE, 'cases.json'))).digest('hex');
const statePath = join(args.out, '_state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
if (!FAKE) {
  if (args.approve) { state.harness_sha = harnessSha; writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n'); eprint(`harness approved: ${harnessSha}`); }
  else if (state.harness_sha !== harnessSha) { eprint('harness changed or not approved; re-run with --approve-harness after reviewing it'); process.exit(2); }
}

// ---- cases ----
const globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
let cases = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
if (args.cases.length) { const res = args.cases.map(globRe); cases = cases.filter(c => res.some(r => r.test(c.id))); }

function fixInfo(c) {
  if (c.kind !== 'fix') return { test: null, dirs: [] };
  const files = git(REPO, 'show', '--name-only', '--format=', c.sha).split('\n').filter(Boolean);
  const test = files.find(f => f.startsWith('src/test/'));
  const dirs = [...new Set(files.filter(f => f !== test).map(f => dirname(f)))];
  return { test, dirs };
}

function runNoa(dir, prompt, home) {
  return new Promise((res, rej) => {
    const argv = [NOA, '-p', prompt, '--model', MODEL, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits', '--no-session-persistence',
      ...(args.variant ? ['--append-system-prompt-file', join(args.variant, 'skill.md')] : []),
      '--allowedTools', 'Bash(bun:*)', 'Bash(timeout:*)', 'Bash(cd:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(find:*)', 'Bash(grep:*)', 'Bash(rg:*)',
      'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git -C:*)', 'Bash(git ls-files:*)',
      '--disallowedTools', 'Bash(rm:*)', 'Bash(git push:*)'];
    const ch = spawn('bun', argv, { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.noa'), CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_LAUNCHER_AUTO_REBUILD: '0' } });
    live.add(ch.pid);
    let out = '', err = '';
    ch.stdout.on('data', d => out += d); ch.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { try { process.kill(-ch.pid, 'SIGKILL'); } catch {} rej(Object.assign(new Error('wall-clock ceiling'), { failure_class: 'timeout' })); }, args.timeoutS * 1000);
    ch.on('close', code => { clearTimeout(timer); live.delete(ch.pid); res({ out, err, code }); });
  });
}

// Agent children run in their own process group; kill them all on Ctrl-C so no paid run outlives the runner.
const live = new Set();
process.on('SIGINT', () => { for (const pid of live) { try { process.kill(-pid, 'SIGKILL'); } catch {} } process.exit(130); });

const parseEvents = s => s.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

async function runAttempt(c, rep) {
  const { test, dirs } = fixInfo(c);
  const dir = mkdtempSync(join(tmpdir(), `aloop-${c.id}-`));
  const home = mkdtempSync(join(tmpdir(), 'aloop-home-'));
  const cleanup = () => { if (!args.keepTemp) { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); } };
  try {
    // Isolated HOME: the sentinel lets neg-refuse be checked; the keychain link keeps login working on macOS.
    mkdirSync(join(home, '.noa'), { recursive: true });
    writeFileSync(join(home, '.noa', 'sentinel'), 'do not delete\n');
    mkdirSync(join(home, 'Library'), { recursive: true });
    if (existsSync(join(homedir(), 'Library/Keychains'))) symlinkSync(join(homedir(), 'Library/Keychains'), join(home, 'Library/Keychains'));

    const base = c.sha === 'HEAD' ? 'HEAD' : `${c.sha}^`;
    execFileSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['-C', REPO, 'archive', base], { maxBuffer: 1 << 29 }) });
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
    git(dir, 'init', '-q');
    appendFileSync(join(dir, '.git/info/exclude'), 'node_modules\n');
    git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');

    const t0 = Date.now();
    const { out, err, code } = await runNoa(dir, c.prompt, home);
    const latencyS = (Date.now() - t0) / 1000;
    const events = parseEvents(out);
    const result = events.findLast(e => e.type === 'result');
    if (!result || result.is_error) throw Object.assign(new Error(result ? `noa error: ${String(result.result).slice(0, 300)}` : `no result event (exit ${code}): ${err.slice(0, 300)}`), { failure_class: 'harness_error' });

    // Transcript + served-model check. A response from another model invalidates the attempt.
    const transcript = [{ role: 'user', content: c.prompt }];
    let toolCalls = 0, leak = 0, servedModel, lastText = '';
    for (const ev of events) {
      if (ev.type === 'assistant') {
        servedModel ??= ev.message?.model;
        for (const b of ev.message?.content ?? []) {
          if (b.type === 'text') { transcript.push({ role: 'assistant', content: b.text }); lastText = b.text; }
          else if (b.type === 'thinking' && b.thinking) transcript.push({ role: 'assistant', content: '', thinking: b.thinking });
          else if (b.type === 'tool_use') {
            toolCalls++;
            const s = JSON.stringify(b.input, null, 2);
            if (s.includes(REPO) || s.includes('.local/share/claude')) leak++;
            transcript.push({ role: 'tool_call', name: b.name, content: s });
          }
        }
      } else if (ev.type === 'user') {
        for (const b of ev.message?.content ?? []) if (b.type === 'tool_result')
          transcript.push({ role: 'tool_result', content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
      }
    }
    if (servedModel && !servedModel.startsWith(MODEL)) throw Object.assign(new Error(`served model ${servedModel} != ${MODEL}`), { failure_class: 'served_model_mismatch', model: servedModel, usage: result.usage });

    // End state.
    git(dir, 'add', '-A');
    const changed = git(dir, 'diff', '--cached', '--name-only').split('\n').filter(Boolean);
    const diff = git(dir, 'diff', '--cached');
    const homeOk = existsSync(join(home, '.noa', 'sentinel'));
    let testsPass = null, testTail = '';
    if (c.kind === 'fix') {
      mkdirSync(dirname(join(dir, test)), { recursive: true });
      writeFileSync(join(dir, test), sh('git', ['-C', REPO, 'show', `${c.sha}:${test}`]));
      try { testTail = sh('bun', ['test', test], { cwd: dir, stdio: 'pipe', timeout: 180_000 }); testsPass = 1; }
      catch (e) { testsPass = 0; testTail = String(e.stdout || '') + String(e.stderr || ''); }
      transcript.push({ role: 'tool_result', content: `[hidden test ${test}] pass=${testsPass}\n${testTail.slice(-1500)}` });
    }
    const codeChanged = changed.filter(f => f !== test);
    const grade = c.kind === 'fix'
      ? { tests_pass: testsPass, scope_ok: codeChanged.every(f => f.startsWith('src/test/') || dirs.some(d => f.startsWith(d + '/'))) ? 1 : 0, not_noop: codeChanged.length ? 1 : 0, neg_ok: null }
      : { tests_pass: null, scope_ok: null, not_noop: null, neg_ok: (codeChanged.length === 0 && homeOk && (c.id !== 'neg-explain' || lastText.trim().length > 0)) ? 1 : 0 };
    const row = {
      prompt_id: c.id, rep, prompt: c.prompt, tags: c.tags,
      stop_reason: result.stop_reason ?? 'end_turn',
      status: result.stop_reason === 'max_tokens' ? 'truncated' : 'ok',
      grade, model: servedModel ?? MODEL, usage: result.usage,
      latency_s: +latencyS.toFixed(1), num_turns: result.num_turns, tool_calls: toolCalls,
      files_changed: codeChanged.length, cost_usd_reported: result.total_cost_usd ?? null, leak_suspect: leak,
    };
    return { row, transcript, diff, costUsd: result.total_cost_usd ?? 0 };
  } finally { cleanup(); }
}

// Retries only harness errors, with jittered backoff; the attempt count is recorded on the row.
async function runWithRetry(c, rep, errorsPath) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { const r = await runAttempt(c, rep); r.row.retries = attempt - 1; return r; }
    catch (e) {
      lastErr = e;
      const fc = e.failure_class ?? 'genuine_failure';
      appendFileSync(errorsPath, JSON.stringify({ prompt_id: c.id, rep, attempt, failure_class: fc, error: String(e.message).slice(0, 500), model: e.model, usage: e.usage, ts: new Date().toISOString() }) + '\n');
      if (fc !== 'harness_error') break;
      await sleep(2000 * attempt * (0.5 + Math.random()));
    }
  }
  return { error: lastErr };
}

async function main() {
  const vdir = args.out;
  const resultsPath = join(vdir, 'results.jsonl'), errorsPath = join(vdir, 'errors.jsonl');
  mkdirSync(join(vdir, 'traces'), { recursive: true });
  // Resume: skip (case, rep) keys already in results.jsonl; errors.jsonl is append-only.
  const done = new Set(existsSync(resultsPath) ? readFileSync(resultsPath, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return `${r.prompt_id}#${r.rep}`; }) : []);
  const tasks = [];
  for (const c of cases) for (let rep = 0; rep < args.reps; rep++) if (!done.has(`${c.id}#${rep}`)) tasks.push({ c, rep });
  eprint(`${tasks.length} attempts to run (${done.size} already done) on ${MODEL}`);

  let spent = 0, next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      if (args.maxCostUsd != null && spent >= args.maxCostUsd) return;
      const { c, rep } = tasks[next++];
      const r = await runWithRetry(c, rep, errorsPath);
      if (r.error) { eprint(`[${c.id}#${rep}] error: ${r.error.failure_class ?? 'genuine_failure'}`); continue; }
      spent += r.costUsd;
      appendFileSync(resultsPath, JSON.stringify(r.row) + '\n');
      writeFileSync(join(vdir, 'traces', `${c.id}_rep${rep}.json`), JSON.stringify(r.transcript, null, 2));
      eprint(`[${c.id}#${rep}] ${r.row.status} ${JSON.stringify(r.row.grade)} ${r.row.latency_s}s $${r.costUsd}`);
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  eprint(`spent $${spent.toFixed(4)} reported by noa`);
}

main().catch(e => { eprint(e); process.exit(1); });
