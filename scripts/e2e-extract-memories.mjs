#!/usr/bin/env bun
// Turn-end memory extraction end to end: real CLI + local Messages API fixture.
// The main model never writes memory; the fixture answers the extraction fork
// with one Write, so a memory file appears only when extraction ran.
// bun run build:dev && bun scripts/e2e-extract-memories.mjs [--entry dist/main.js] [--case name]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(root, 'dist/main-dev.js'));
const artifacts = mkdtempSync(join(tmpdir(), 'noa-extract-memories-'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const off = JSON.stringify({ autoMemoryExtractEnabled: false });
const cases = [
  { name: 'interactive-default', interactive: true, settings: '{}', expect: true },
  { name: 'interactive-off', interactive: true, settings: off, expect: false },
  { name: 'print-plain', settings: '{}', expect: false },
  { name: 'print-host', settings: '{}', host: true, expect: true },
  { name: 'print-host-off', settings: off, host: true, expect: false },
  { name: 'forked-skill-cycle', settings: off, skillCycle: true },
].filter(c => !option('--case') || c.name === option('--case'));
assert.ok(cases.length, 'unknown --case');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;

async function run(c) {
  const dir = join(artifacts, c.name), cwd = join(dir, 'workspace'), config = join(dir, 'config');
  for (const d of [cwd, config, join(dir, 'home')]) mkdirSync(d, { recursive: true });
  const requests = [];
  let memFile;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    if (!req.url.includes('/messages') || req.url.includes('count_tokens')) { res.end('{"input_tokens":10}'); return; }
    const body = JSON.parse(raw);
    const all = JSON.stringify(body);
    let blocks, kind;
    if (c.skillCycle && body.tools?.some(t => t.name === 'Skill')) {
      kind = 'skill';
      const last = body.messages.at(-1).content;
      const result = Array.isArray(last) && last.find(b => b.type === 'tool_result');
      if (result) {
        blocks = [{ type: 'text', text: JSON.stringify(result).includes('already running in this call chain') ? 'CYCLE_BLOCKED' : JSON.stringify(result).includes('CYCLE_BLOCKED') ? 'ANSWER_391' : 'CYCLE_MISSED' }];
      } else {
        const skill = all.includes('FORK_CYCLE_INNER') ? '/cycle-outer' : 'cycle-inner';
        blocks = requests.filter(r => r.kind === 'skill').length < 3
          ? [{ type: 'tool_use', id: `cycle_${requests.length}`, name: 'Skill', input: { skill } }]
          : [{ type: 'text', text: 'EXTRA_FORK' }];
      }
    } else if (all.includes('acting as the memory extraction subagent')) {
      kind = 'extract';
      if (!all.includes('"tool_use_id":"mem_write"')) {
        memFile = all.match(/(\/[^"\\ `]*?\/projects\/[^"\\ `]*?\/memory\/)/)?.[1] + 'user_go.md';
        blocks = [{ type: 'tool_use', id: 'mem_write', name: 'Write', input: { file_path: memFile, content: '---\nname: user-go\ndescription: Go engineer new to React\nmetadata:\n  type: user\n---\n\nExplain frontend code with Go analogies.\n' } }];
      } else blocks = [{ type: 'text', text: 'saved' }];
    } else if (!body.tools?.length) { kind = 'side'; blocks = [{ type: 'text', text: 'side' }]; }
    else { kind = 'main'; blocks = [{ type: 'text', text: 'ANSWER_391' }]; }
    requests.push({ kind, response: blocks });
    const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: blocks, stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
    if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { ...message, content: [], stop_reason: null } });
    blocks.forEach((block, index) => {
      ev('content_block_start', { index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
      ev('content_block_delta', { index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      ev('content_block_stop', { index });
    });
    ev('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {}); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const globalConfig = JSON.stringify({ theme: 'dark-ansi', hasCompletedOnboarding: true, lastOnboardingVersion: '99.0.0', customApiKeyResponses: { approved: ['sk-noa-e2e'], rejected: [] }, projects: { [realpathSync(cwd)]: { hasTrustDialogAccepted: true, allowedTools: [] } } });
  writeFileSync(join(config, '.config.json'), globalConfig);
  writeFileSync(join(config, '.claude.json'), globalConfig);
  writeFileSync(join(config, 'settings.json'), c.settings);
  const env = { PATH: process.env.PATH, HOME: join(dir, 'home'), TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PRODUCT_DIR: config, ANTHROPIC_API_KEY: 'sk-noa-e2e', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...(c.host ? { NOA_CLAUDE_HOST_MEMORY_EXTRACT: '1' } : {}) };
  const cli = [entry, '--model', 'claude-haiku-5-5', '--debug-file', join(dir, 'debug.log')];
  if (c.skillCycle) {
    cli.push('--allowedTools', 'Skill');
    for (const name of ['outer', 'inner']) {
      const skillDir = join(config, 'skills', `cycle-${name}`);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: cycle-${name}\ndescription: Fork cycle fixture\ncontext: fork\n---\nFORK_CYCLE_${name.toUpperCase()}\n`);
    }
  }
  const prompt = c.skillCycle ? '/cycle-outer' : "FYI I'm a Go engineer new to React. What's 17*23?";
  let command, output = '', exit = 0;
  try {
    if (c.interactive) {
      const socket = `noa-extract-${process.pid}-${c.name}`;
      const tmux = (...a) => execFileSync('tmux', ['-L', socket, ...a], { encoding: 'utf8' });
      const screen = () => tmux('capture-pane', '-p', '-t', 'ui');
      const submit = async text => { tmux('send-keys', '-t', 'ui', '-l', text); await sleep(200); tmux('send-keys', '-t', 'ui', 'Enter'); };
      command = 'env -i ' + Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(' ') + ' bun ' + cli.map(quote).join(' ');
      try {
        tmux('new-session', '-d', '-s', 'ui', '-x', '110', '-y', '40', '-c', cwd, command);
        for (let i = 0; i < 100 && !/\? for shortcuts|shift\+tab/.test(screen()); i++) await sleep(200);
        await sleep(800);
        // Extraction is armed by the first submit, which an instant fixture reply can beat; the second turn covers both.
        await submit(prompt);
        for (let i = 0; i < 50 && !screen().includes('ANSWER_391'); i++) await sleep(200);
        await submit('And 2+2?');
        for (let i = 0; i < 40 && !(memFile && existsSync(memFile)); i++) await sleep(200);
        await sleep(c.expect ? 300 : 3000);
        output = screen();
      } finally { try { tmux('kill-server'); } catch {} }
    } else {
      // Async: the fixture server shares this event loop.
      // Host cases run the way the desktop app does: stream-json in and out.
      const io = c.host ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : [];
      command = ['bun', ...cli, '-p', ...io, ...(c.host ? [] : [prompt])];
      const child = spawn(command[0], command.slice(1), { cwd, env });
      if (c.host) child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n');
      child.stdin.end();
      child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      exit = await new Promise(r => child.on('close', code => r(code ?? -1)));
      clearTimeout(timer);
    }
  } finally { server.close(); }
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(requests, null, 2));
  writeFileSync(join(dir, 'output.txt'), output);
  const extracts = requests.filter(r => r.kind === 'extract').length;
  const written = !!memFile && existsSync(memFile);
  assert.equal(exit, 0, `CLI exit ${exit}`);
  if (c.skillCycle) {
    const skillRequests = requests.filter(r => r.kind === 'skill');
    assert.deepEqual(skillRequests.flatMap(r => r.response).filter(b => b.type === 'tool_use').map(b => b.input.skill), ['cycle-inner', '/cycle-outer'], 'the cycle started an extra fork');
    assert.ok(output.includes('ANSWER_391'), 'forked skill did not finish after the recursion error');
  } else {
    assert.ok(output.includes('ANSWER_391'), 'main turn did not answer');
  }
  if (c.expect) {
    assert.ok(written, 'extraction did not write the memory file');
    assert.match(readFileSync(memFile, 'utf8'), /Go analogies/);
  } else {
    assert.equal(extracts, 0, 'extraction ran while disabled');
  }
  return { command, extracts, written, exit };
}

let failed = false;
for (const c of cases) {
  try {
    const result = await run(c);
    console.log(`PASS ${c.name}`, JSON.stringify({ extracts: result.extracts, written: result.written, exit: result.exit }));
  } catch (error) {
    failed = true;
    console.log(`FAIL ${c.name}: ${error.message}`);
  }
}
console.log(JSON.stringify({ entry, revision, artifacts }));
process.exit(failed ? 1 : 0);
