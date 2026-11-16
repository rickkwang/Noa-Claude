#!/usr/bin/env bun
// /focus end to end: real CLI in fullscreen + local Messages API fixture + tmux.
// Checks the fold on screen, the hidden count on the turn_duration row, and that
// the "# Focus mode" system prompt section follows the toggle mid-session.
// bun run build:dev && bun scripts/e2e-focus-view.mjs [--entry bin/noa.js]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dir, '..');
const entryFlag = process.argv.indexOf('--entry');
const entry = entryFlag < 0 ? join(root, 'dist/main-dev.js') : resolve(process.argv[entryFlag + 1]);
const dir = join(tmpdir(), `noa-focus-e2e-${process.pid}`);
const cwd = dir + '/workspace';
const config = dir + '/config';
mkdirSync(cwd, { recursive: true });
mkdirSync(config);
mkdirSync(dir + '/home');
writeFileSync(join(cwd, 'notes.txt'), 'alpha\nbeta\n');

const socket = `noa-focus-${process.pid}`;
const requests = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
const screen = () => tmux('capture-pane', '-p', '-t', 'ui');
const keys = (...args) => tmux('send-keys', '-t', 'ui', ...args);
const type = s => keys('-l', s);
const steps = [];
function save(name) { const s = screen(); steps.push(name); writeFileSync(`${dir}/${name}.txt`, s); return s; }
async function wait(name, predicate, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = screen(); if (predicate(s)) return save(name); await sleep(100); }
  save(`${name}-timeout`);
  throw Error(`Timeout ${name}\n${screen()}`);
}
function assert(value, msg) { if (!value) throw Error(msg); }
const savedFocus = () => [config + '/.claude.json', config + '/.config.json'].filter(existsSync).map(f => JSON.parse(readFileSync(f, 'utf8')).briefTranscript);

// One turn = four model calls: mid-turn text + Read, Bash, Write, then the final answer.
// A prompt containing "slow" delays the final answer past the 30s turn_duration threshold.
function turnStep(body) {
  const msgs = body.messages ?? [];
  let k = msgs.length - 1;
  while (k >= 0 && !(msgs[k].role === 'user' && (typeof msgs[k].content === 'string' || msgs[k].content.some(c => c.type === 'text' && !c.text.startsWith('<')))) ) k--;
  const prompt = typeof msgs[k]?.content === 'string' ? msgs[k].content : msgs[k]?.content.filter(c => c.type === 'text').map(c => c.text).join(' ') ?? '';
  const done = msgs.slice(k + 1).filter(m => m.role === 'assistant').length;
  return { prompt, done };
}
const server = createServer(async (req, res) => {
  let text = '';
  for await (const c of req) text += c;
  let body = {};
  try { body = JSON.parse(text); } catch {}
  if (req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":100}'); return; }
  const system = JSON.stringify(body.system ?? '');
  const { prompt, done } = turnStep(body);
  // Side queries (titles, suggestions) repeat the prompt but carry no tools.
  const isMain = prompt.includes('focus-turn') && (body.tools ?? []).some(t => t.name === 'Read');
  if (isMain) requests.push({ prompt, done, focusSection: system.includes('# Focus mode') });
  const id = `t${requests.length}`;
  let content;
  let stop = 'tool_use';
  if (!isMain) { content = [{ type: 'text', text: 'ok' }]; stop = 'end_turn'; }
  else if (done === 0) content = [{ type: 'text', text: 'MID-TURN NOTE visible only outside focus.' }, { type: 'tool_use', id: `${id}_read`, name: 'Read', input: { file_path: join(realpathSync(cwd), 'notes.txt') } }];
  else if (done === 1) content = [{ type: 'tool_use', id: `${id}_bash`, name: 'Bash', input: { command: 'echo focus-bash-ran', description: 'Echo marker' } }];
  else if (done === 2) content = [{ type: 'tool_use', id: `${id}_write`, name: 'Write', input: { file_path: join(realpathSync(cwd), `out-${requests.length}.txt`), content: 'one\ntwo\nthree\n' } }];
  else {
    if (prompt.includes('slow')) await sleep(31000);
    content = [{ type: 'text', text: `FINAL ANSWER for ${prompt.match(/focus-turn-\w+/)?.[0]}.` }];
    stop = 'end_turn';
  }
  const msg = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 30 } };
  if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg)); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  emit('message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  content.forEach((c, index) => {
    emit('content_block_start', { type: 'content_block_start', index, content_block: c.type === 'text' ? { type: 'text', text: '' } : { ...c, input: {} } });
    emit('content_block_delta', { type: 'content_block_delta', index, delta: c.type === 'text' ? { type: 'text_delta', text: c.text } : { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } });
    emit('content_block_stop', { type: 'content_block_stop', index });
  });
  emit('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } });
  emit('message_stop', { type: 'message_stop' });
  res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const globalConfig = JSON.stringify({ theme: 'dark-ansi', hasCompletedOnboarding: true, lastOnboardingVersion: '99.0.0', customApiKeyResponses: { approved: ['sk-noa-e2e'], rejected: [] }, projects: { [realpathSync(cwd)]: { hasTrustDialogAccepted: true, allowedTools: [], mcpContextUris: [] } } });
writeFileSync(config + '/.config.json', globalConfig);
writeFileSync(config + '/.claude.json', globalConfig);
writeFileSync(config + '/settings.json', JSON.stringify({ permissions: { allow: ['Read', 'Bash', 'Write'] } }));
const env = { PATH: process.env.PATH, HOME: dir + '/home', TERM: 'xterm-256color', CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PRODUCT_DIR: config, ANTHROPIC_API_KEY: 'sk-noa-e2e', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, NOA_CLAUDE_NO_FLICKER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', NOA_CLAUDE_NO_THINKING: '1' };
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
let exit = 0;
try {
  const invocation = entry.endsWith('.js') ? `bun ${quote(entry)}` : quote(entry);
  const cmd = 'env -i ' + Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(' ') + ` ${invocation} --model claude-haiku-5-5`;
  tmux('new-session', '-d', '-s', 'ui', '-x', '110', '-y', '40', '-c', cwd, cmd);
  await wait('startup', s => s.includes('? for shortcuts') || s.includes('shift+tab'));
  await sleep(800);
  const submit = async s => { type(s); await sleep(200); keys('Enter'); };

  await submit('focus-turn-one please');
  let s = await wait('turn-one-default', s => s.includes('FINAL ANSWER for focus-turn-one'));
  assert(s.includes('MID-TURN NOTE'), 'default view should show mid-turn text');
  assert(requests.every(r => !r.focusSection), 'focus section sent before /focus');

  await submit('/focus');
  s = await wait('focus-on', s => s.includes('Focus view enabled') && !s.includes('MID-TURN NOTE'));
  assert(s.includes('FINAL ANSWER for focus-turn-one'), 'final answer hidden by fold');
  assert(savedFocus().includes(true), 'briefTranscript not persisted to global config');
  assert(/[Ee]dited 1 file/.test(s) && /read 1 file/i.test(s), 'summary row missing edit/read parts');

  const before = requests.length;
  await submit('focus-turn-two slow');
  s = await wait('turn-two-live', () => requests.slice(before).some(r => r.done === 3), 20000);
  assert(!s.includes('MID-TURN NOTE') && !s.includes('FINAL ANSWER for focus-turn-two'), 'live turn shows mid-turn text or a final answer early');
  assert(/[Ee]dit(ing|ed) 1 file/.test(s), 'live summary row missing');
  s = await wait('turn-two-focus', s => s.includes('FINAL ANSWER for focus-turn-two') && /messages? hidden \(\/focus to show\)/.test(s), 60000);
  assert(!s.includes('MID-TURN NOTE'), 'mid-turn text shown in focus view');
  assert(requests.slice(before).every(r => r.focusSection), 'focus section missing after /focus');

  await submit('/focus off');
  s = await wait('focus-off', s => s.includes('Focus view disabled') && s.includes('MID-TURN NOTE'));
  assert(!/hidden \(\/focus to show\)/.test(s), 'hidden count left on screen after /focus off');
  assert(!savedFocus().includes(true), 'briefTranscript still true after /focus off');
  const mid = requests.length;
  await submit('focus-turn-three please');
  await wait('turn-three-default', s => s.includes('FINAL ANSWER for focus-turn-three'));
  assert(requests.slice(mid).every(r => !r.focusSection), 'focus section still sent after /focus off');

  // A "viewMode" setting starts the session folded, sends the section, and pins /focus.
  tmux('kill-session', '-t', 'ui');
  writeFileSync(config + '/settings.json', JSON.stringify({ viewMode: 'focus', permissions: { allow: ['Read', 'Bash', 'Write'] } }));
  tmux('new-session', '-d', '-s', 'ui', '-x', '110', '-y', '40', '-c', cwd, cmd);
  await wait('viewmode-startup', s => s.includes('? for shortcuts') || s.includes('shift+tab'));
  await sleep(800);
  const pinned = requests.length;
  await submit('focus-turn-four please');
  s = await wait('viewmode-turn', s => s.includes('FINAL ANSWER for focus-turn-four'));
  assert(!s.includes('MID-TURN NOTE'), 'viewMode focus did not fold the turn');
  assert(requests.slice(pinned).every(r => r.focusSection), 'viewMode focus did not send the section');
  await submit('/focus off');
  await wait('viewmode-pinned', s => s.includes('Focus view is set by "viewMode": "focus"'));
  console.log(JSON.stringify({ result: 'pass', dir, steps, requests }, null, 1));
} catch (e) {
  exit = 1;
  console.error(e.message);
  console.error(JSON.stringify({ result: 'fail', dir, steps, requests }, null, 1));
} finally {
  try { tmux('kill-server'); } catch {}
  server.close();
}
process.exit(exit);
