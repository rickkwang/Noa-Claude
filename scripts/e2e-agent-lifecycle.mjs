#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real CLI, storage, tools and teammate lifecycle; only model replies are scripted.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-agent-lifecycle-')));
const cases = ['team-empty', 'team-shutdown', 'resume-depth', 'resume-legacy'].filter(name => !option('--case') || name === option('--case'));
assert.ok(cases.length, 'unknown --case');
mkdirSync(artifacts, { recursive: true });
const entryRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(entry), encoding: 'utf8' }).trim();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: entryRepo, encoding: 'utf8' }).trim();
const text = content => typeof content === 'string' ? content : (content || []).map(b => b.text || '').join('\n');
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const say = value => [{ type: 'text', text: value }];
const agentId = all => all.match(/agentId:\s*([a-zA-Z0-9_-]+)/)?.[1];
const agentFiles = dir => readdirSync(dir, { recursive: true }).filter(name => name.endsWith('.meta.json') && name.includes('subagents')).map(name => join(dir, name));
let failed = false;
for (const scenario of cases) {
  const dir = join(artifacts, scenario);
  mkdirSync(dir, { recursive: true });
  const config = join(dir, 'config');
  const requests = [], counts = {};
  let serverError, editedLegacy = false;
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":10}'); return;
      }
      const body = JSON.parse(raw);
      const first = text(body.messages?.find(m => m.role === 'user')?.content);
      const role = [...first.matchAll(/LIFECYCLE_(MAIN|PARENT|LEAF|GRAND|A|B)\b/g)].at(-1)?.[1] || 'SIDE';
      const row = { role, body }; requests.push(row);
      const n = counts[role] = (counts[role] || 0) + 1;
      const all = JSON.stringify(body.messages || []);
      const agent = body.tools?.find(t => ['Agent', 'Task'].includes(t.name))?.name || 'Agent';
      const launch = (id, role, extra = {}) => tool(id, agent, { prompt: `LIFECYCLE_${role} Complete the fixture.`, description: `Lifecycle ${role}`, subagent_type: 'general-purpose', run_in_background: false, ...extra });
      let blocks;
      if (!body.tools?.length || role === 'SIDE') blocks = say('SIDE_DONE');
      else if (scenario.startsWith('team-')) {
        if (role === 'MAIN') {
          if (n === 1) blocks = [tool('create_team', 'TeamCreate', { team_name: 'lifecycle-team', description: 'Lifecycle regression fixture' })];
          else if (scenario === 'team-empty') blocks = say('AUDIT_OK');
          else if (!all.includes('"tool_use_id":"spawn_A"')) blocks = ['A', 'B'].map(r => launch(`spawn_${r}`, r, { name: `worker${r}`, team_name: 'lifecycle-team' }));
          else if (!all.includes('REPORT_A') || !all.includes('REPORT_B')) blocks = say('WAIT_FOR_REPORTS');
          else if (!all.includes('"tool_use_id":"shutdown_A"')) blocks = ['A', 'B'].map(r => tool(`shutdown_${r}`, 'SendMessage', { to: `worker${r}`, message: { type: 'shutdown_request', reason: 'Fixture complete' } }));
          else blocks = say('AUDIT_OK');
        } else {
          const shutdown = text(body.messages?.at(-1)?.content).match(/"requestId":"([^"]+)"/);
          if (shutdown) blocks = [tool(`approve_${role}`, 'SendMessage', { to: 'team-lead', message: { type: 'shutdown_response', request_id: shutdown[1], approve: true } })];
          else if (n === 1) blocks = [tool(`report_${role}`, 'SendMessage', { to: 'team-lead', message: `REPORT_${role}`, summary: 'Lifecycle fixture report' })];
          else blocks = say(`${role}_IDLE`);
        }
      } else if (role === 'MAIN') {
        if (n === 1) blocks = [launch('spawn_parent', 'PARENT')];
        else if (!all.includes('"tool_use_id":"resume_parent_1"')) {
          const id = agentId(all); assert.ok(id, 'parent ID missing');
          if (scenario === 'resume-legacy') {
            const files = agentFiles(config); assert.ok(files.length, 'legacy metadata not found');
            for (const file of files) { const meta = JSON.parse(readFileSync(file, 'utf8')); delete meta.depth; writeFileSync(file, JSON.stringify(meta)); }
            editedLegacy = true;
          }
          blocks = [tool('resume_parent_1', 'SendMessage', { to: id, message: 'RESUME_PARENT_1', summary: 'Resume parent first time' })];
        } else if (scenario === 'resume-legacy') blocks = say(all.includes('LEGACY_LIMIT_PRESERVED') ? 'AUDIT_OK' : 'WAIT_FOR_RESUME');
        else if (all.includes('PARENT_RESUMED_1') && !all.includes('"tool_use_id":"resume_parent_2"')) blocks = [tool('resume_parent_2', 'SendMessage', { to: agentId(all), message: 'RESUME_PARENT_2', summary: 'Resume parent again' })];
        else if (all.includes('PARENT_RESUMED_2') && !all.includes('"tool_use_id":"resume_leaf"')) {
          const id = [...all.matchAll(/LEAF_AGENT_ID=([a-zA-Z0-9_-]+)/g)].at(-1)?.[1]; assert.ok(id, 'depth-2 agent ID missing');
          blocks = [tool('resume_leaf', 'SendMessage', { to: id, message: 'RESUME_LEAF', summary: 'Resume at depth limit' })];
        } else blocks = say(all.includes('RESUMED_LEAF_LIMIT') ? 'AUDIT_OK' : 'WAIT_FOR_RESUME');
      } else if (role === 'PARENT') {
        const pass = all.includes('RESUME_PARENT_2') ? 2 : all.includes('RESUME_PARENT_1') ? 1 : 0;
        if (!pass) blocks = say('PARENT_IDLE');
        else if (!all.includes(`"tool_use_id":"spawn_leaf_${pass}"`)) blocks = [launch(`spawn_leaf_${pass}`, 'LEAF')];
        else if (scenario === 'resume-legacy') blocks = say(all.includes('depth Infinity') ? 'LEGACY_LIMIT_PRESERVED' : 'LEGACY_LIMIT_BYPASSED');
        else blocks = say(`PARENT_RESUMED_${pass} LEAF_AGENT_ID=${[...all.matchAll(/agentId:\s*([a-zA-Z0-9_-]+)/g)].at(-1)?.[1] || 'missing'}`);
      } else if (role === 'LEAF') {
        const resumed = all.includes('RESUME_LEAF');
        const id = resumed ? 'spawn_grand_resumed' : 'spawn_grand';
        if (!all.includes(`"tool_use_id":"${id}"`)) blocks = [launch(id, 'GRAND')];
        else blocks = say(resumed ? 'RESUMED_LEAF_LIMIT' : 'LEAF_LIMIT');
      } else blocks = say('GRAND_SHOULD_NOT_START');
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
  Object.assign(env, { CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'local-fixture-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2' });
  const cliArgs = ['--print', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-4-6', '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', 'Agent,SendMessage,TeamCreate', '--allowedTools', 'SendMessage,TeamCreate', '--teammate-mode', 'in-process', '--debug', '--debug-file', join(dir, 'debug.log'), '--max-turns', '20', '--', 'LIFECYCLE_MAIN Complete the lifecycle fixture.'];
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
    if (scenario === 'team-empty') assert.equal(main.length, 2, 'leader-only team triggered extra shutdown work');
    if (scenario === 'team-shutdown') {
      for (const role of ['A', 'B']) {
        assert.ok(main.some(r => JSON.stringify(r.body.messages).includes(`REPORT_${role}`)), `${role} report lost`);
        assert.ok(requests.some(r => r.role === role && r.response?.some(b => b.input?.message?.type === 'shutdown_response' && b.input.message.approve)), `${role} never approved shutdown`);
        assert.ok(main.some(r => r.body.messages.some(m => text(m.content).includes('"type":"shutdown_approved"') && text(m.content).includes(`"from":"worker${role}"`))), `${role} approval never reached leader`);
      }
      assert.ok(!existsSync(join(config, 'teams/lifecycle-team')), 'team directory not cleaned up on exit');
    }
    if (scenario === 'resume-depth') {
      assert.ok(counts.LEAF >= 6, 'nested agents or depth-2 resume never ran');
      assert.equal(counts.GRAND || 0, 0, 'resume bypassed depth cap');
      assert.ok(requests.filter(r => r.role === 'LEAF').some(r => JSON.stringify(r.body.messages).includes('depth 3 of 2')), 'depth refusal missing');
      assert.ok(main.some(r => JSON.stringify(r.body.messages).includes('PARENT_RESUMED_2')), 'second resume not completed');
      const depths = agentFiles(config).map(file => JSON.parse(readFileSync(file, 'utf8')).depth).sort();
      assert.deepEqual(depths, [1, 2, 2], 'original depth not retained in metadata');
    }
    if (scenario === 'resume-legacy') {
      assert.ok(editedLegacy); assert.equal(counts.LEAF || 0, 0, 'unknown-depth legacy resume bypassed cap');
      assert.ok(main.some(r => JSON.stringify(r.body.messages).includes('LEGACY_LIMIT_PRESERVED')));
    }
  } catch (error) { failed = true; failure = String(error); }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ command, revision, entry_sha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), source_diff_sha256: createHash('sha256').update(execFileSync('git', ['diff', '--', 'src'], { cwd: entryRepo })).digest('hex'), input: cliArgs.at(-1), exit, seconds: (performance.now() - start) / 1000, counts, passed: !failure, failure }, null, 2));
  console.log(`${failure ? 'FAIL' : 'PASS'} ${scenario}${failure ? ': ' + failure : ''}`);
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = failed ? 1 : 0;
