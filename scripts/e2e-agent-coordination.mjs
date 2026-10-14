#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real CLI, peer messages, permissions and task capacity; only model replies are scripted.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-agent-coordination-')));
const cases = ['peer', 'peer-denied', 'peer-parent-denied', 'cap-foreground', 'cap-background', 'cap-mixed', 'cap-mixed-reverse', 'cap-disabled-background', 'cap-reuse', 'cap-unlimited', 'cap-nested', 'cap-resume'].filter(name => !option('--case') || name === option('--case'));
assert.ok(cases.length, 'unknown --case');
mkdirSync(artifacts, { recursive: true });
const entryRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(entry), encoding: 'utf8' }).trim();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: entryRepo, encoding: 'utf8' }).trim();
const text = content => typeof content === 'string' ? content : (content || []).map(b => b.text || '').join('\n');
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const say = value => [{ type: 'text', text: value }];
const agentId = all => all.match(/agentId:\s*([a-zA-Z0-9_-]+)/)?.[1];
let failed = false;
for (const scenario of cases) {
  const dir = join(artifacts, scenario);
  mkdirSync(dir, { recursive: true });
  const config = join(dir, 'config');
  const requests = [], counts = {};
  let serverError;
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":10}'); return;
      }
      const body = JSON.parse(raw);
      const first = text(body.messages?.find(m => m.role === 'user')?.content);
      const role = body.tools?.length ? ([...first.matchAll(/COORD_(MAIN|A|B|C|LEAF)\b/g)].at(-1)?.[1] || 'SIDE') : 'SIDE';
      const row = { role, body }; requests.push(row);
      const n = counts[role] = (counts[role] || 0) + 1;
      const all = JSON.stringify(body.messages || []);
      const agent = body.tools?.find(t => ['Agent', 'Task'].includes(t.name))?.name || 'Agent';
      const launch = (id, who, bg) => tool(id, agent, { prompt: `COORD_${who} Complete the fixture.`, description: `Coordination ${who}`, subagent_type: scenario === 'peer-denied' ? 'no-message' : 'general-purpose', run_in_background: bg });
      let blocks;
      if (role === 'SIDE') blocks = say('SIDE_DONE');
      else if (scenario.startsWith('peer')) {
        if (role === 'MAIN') {
          if (n === 1) blocks = [launch('spawn_B', 'B', true)];
          else if (!all.includes('"tool_use_id":"spawn_A"')) {
            const id = agentId(all); assert.ok(id, 'recipient ID missing');
            const call = launch('spawn_A', 'A', true); call.input.prompt += ` Recipient: ${id}`; blocks = [call];
          } else blocks = say('AUDIT_OK');
        } else if (role === 'A' && n === 1) {
          const id = first.match(/Recipient: ([a-zA-Z0-9_-]+)/)?.[1]; assert.ok(id, 'recipient not briefed');
          blocks = [tool('peer_send', 'SendMessage', { to: id, message: 'PEER_DELIVERED_42', summary: 'Fixture peer delivery' })];
        } else if (role === 'B' && n === 1) blocks = [tool('peer_wait', 'Bash', { command: 'sleep 0.5', description: 'Wait for peer message at tool boundary' })];
        else blocks = say(role === 'B' && all.includes('PEER_DELIVERED_42') ? 'B_RECEIVED_42' : `${role}_DONE`);
      } else if (role === 'MAIN') {
        if (scenario === 'cap-resume') {
          if (n === 1) blocks = [launch('spawn_A', 'A', false)];
          else if (!all.includes('"tool_use_id":"spawn_B"')) blocks = [launch('spawn_B', 'B', true)];
          else if (!all.includes('"tool_use_id":"resume_A"')) blocks = [tool('resume_A', 'SendMessage', { to: agentId(all), message: 'RESUMED_A', summary: 'Try occupied-slot resume' })];
          else blocks = say('AUDIT_OK');
        } else if (n === 1) blocks = [launch('spawn_A', 'A', scenario === 'cap-background' || scenario === 'cap-mixed'), ...(scenario === 'cap-nested' ? [] : [launch('spawn_B', 'B', scenario === 'cap-background' || scenario === 'cap-mixed-reverse')])];
        else if (scenario === 'cap-reuse' && !all.includes('"tool_use_id":"spawn_C"')) blocks = [launch('spawn_C', 'C', false)];
        else blocks = say('AUDIT_OK');
      } else if (scenario === 'cap-nested' && role === 'A' && n === 1) blocks = [launch('spawn_leaf', 'LEAF', false)];
      else if (n === 1) blocks = [tool(`bash_${role}`, 'Bash', { command: `echo ${role}-start >> events.txt; sleep 0.3; echo ${role}-end >> events.txt`, description: 'Record real agent execution' })];
      else blocks = say(`${role}_DONE`);
      row.response = blocks;
      const message = { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: blocks, stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
      if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      blocks.forEach((block, index) => {
        ev('content_block_start', { index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
        ev('content_block_delta', { index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
        ev('content_block_stop', { index });
      });
      ev('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
      ev('message_stop', {}); res.end();
    } catch (error) { serverError = String(error); res.writeHead(500); res.end('{}'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG'].includes(k)));
  Object.assign(env, { CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'local-fixture-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2', NOA_CLAUDE_MAX_CONCURRENT_AGENTS: scenario.startsWith('peer') ? '2' : scenario === 'cap-unlimited' ? '0' : '1', ...(scenario === 'cap-reuse' ? { NOA_CLAUDE_MAX_SUBAGENTS_PER_SESSION: '2' } : {}), ...(scenario === 'cap-disabled-background' ? { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } : {}) });
  const cliArgs = ['--print', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-4-6', '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', 'Agent,Bash,SendMessage', '--allowedTools', 'Bash,SendMessage', '--debug', '--debug-file', join(dir, 'debug.log'), '--max-turns', '20', '--', 'COORD_MAIN Complete the coordination fixture.'];
  if (scenario === 'peer-denied') cliArgs.splice(cliArgs.indexOf('--'), 0, '--agents', JSON.stringify({ 'no-message': { description: 'Fixture without messaging permission', prompt: 'Complete the fixture using Bash only.', tools: ['Bash'] } }));
  if (scenario === 'peer-parent-denied') cliArgs.splice(cliArgs.indexOf('--'), 0, '--disallowedTools', 'SendMessage');
  const command = entry.endsWith('.js') ? ['bun', entry, ...cliArgs] : [entry, ...cliArgs];
  const start = performance.now();
  const child = spawn(command[0], command.slice(1), { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
  const exit = await new Promise((r, reject) => { child.on('error', reject); child.on('close', (code, signal) => r({ code, signal })); });
  clearTimeout(timer); server.closeAllConnections(); await new Promise(r => server.close(r));
  writeFileSync(join(dir, 'requests.json'), JSON.stringify(requests, null, 2));
  writeFileSync(join(dir, 'stdout.jsonl'), stdout); writeFileSync(join(dir, 'stderr.txt'), stderr);
  let failure;
  try {
    assert.equal(serverError, undefined, serverError);
    assert.equal(exit.signal, null, `CLI did not exit: ${exit.signal}`); assert.equal(exit.code, 0);
    const events = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    assert.equal(events.filter(e => e.type === 'result').at(-1)?.result, 'AUDIT_OK');
    const main = requests.filter(r => r.role === 'MAIN');
    const mainWire = JSON.stringify(main.map(r => r.body.messages));
    const childWire = JSON.stringify(requests.filter(r => r.role !== 'MAIN').map(r => r.body.messages));
    if (scenario.startsWith('peer')) {
      const sender = requests.filter(r => r.role === 'A');
      assert.ok(sender.length >= 2, 'sender tool result was not checked');
      const exposed = sender[0].body.tools.some(t => t.name === 'SendMessage');
      const recipient = requests.filter(r => r.role === 'B');
      assert.ok(recipient.length >= 2, 'recipient tool boundary never ran');
      const received = recipient.some(r => JSON.stringify(r.body.messages).includes('PEER_DELIVERED_42'));
      if (scenario !== 'peer-parent-denied') assert.equal(exposed, scenario === 'peer', 'custom tool boundary changed');
      assert.equal(received, scenario === 'peer', 'peer delivery crossed a restriction or was lost');
      if (scenario === 'peer') {
        assert.ok(sender.some(r => r.body.messages.some(m => (Array.isArray(m.content) ? m.content : []).some(b => { if (b.type !== 'tool_result' || b.tool_use_id !== 'peer_send') return false; try { return JSON.parse(text(b.content)).success === true; } catch { return false; } }))), 'send was not accepted');
        assert.ok(mainWire.includes('B_RECEIVED_42'), 'receipt was not handed back to main');
      } else if (scenario === 'peer-denied') assert.ok(childWire.includes('No such tool available: SendMessage'), 'denial was not observed');
      else assert.ok(sender.some(r => r.body.messages.some(m => (Array.isArray(m.content) ? m.content : []).some(b => b.type === 'tool_result' && b.tool_use_id === 'peer_send' && b.is_error))), 'parent permission denial was not observed');
    } else {
      const lines = existsSync(join(dir, 'events.txt')) ? readFileSync(join(dir, 'events.txt'), 'utf8').trim().split('\n') : [];
      let active = 0, peak = 0;
      for (const line of lines) { active += line.endsWith('-start') ? 1 : -1; peak = Math.max(peak, active); }
      assert.equal(active, 0, 'real child command did not finish');
      const limited = !['cap-unlimited', 'cap-reuse'].includes(scenario);
      assert.equal(peak, scenario === 'cap-unlimited' ? 2 : scenario === 'cap-nested' ? 0 : 1, 'actual execution escaped the cap');
      if (scenario === 'cap-nested') {
        assert.equal(counts.LEAF || 0, 0, 'nested agent took an occupied slot');
        assert.ok(childWire.includes('Concurrent subagent limit reached'), 'nested capacity refusal missing');
      } else {
        assert.equal(lines.filter(s => s.endsWith('-start')).length, ['cap-unlimited', 'cap-reuse', 'cap-resume'].includes(scenario) ? 2 : 1);
        if (scenario === 'cap-resume') { assert.equal(counts.A, 2, 'resume ran despite occupied capacity'); assert.ok(mainWire.includes('B_DONE')); }
        if (scenario === 'cap-reuse') { assert.ok(counts.C >= 2, 'completed slot was not reusable'); assert.ok(mainWire.includes('C_DONE')); }
      }
      assert.equal(mainWire.includes('Concurrent subagent limit reached'), scenario === 'cap-nested' ? false : limited || scenario === 'cap-reuse', 'capacity refusal mismatch');
    }
  } catch (error) { failed = true; failure = String(error); }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ command, revision, entry_sha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), source_diff_sha256: createHash('sha256').update(execFileSync('git', ['diff', '--', 'src'], { cwd: entryRepo })).digest('hex'), input: cliArgs.at(-1), exit, seconds: (performance.now() - start) / 1000, counts, passed: !failure, failure }, null, 2));
  console.log(`${failure ? 'FAIL' : 'PASS'} ${scenario}${failure ? ': ' + failure : ''}`);
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = failed ? 1 : 0;
