#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real CLI, peer messages, permissions and task capacity; only model replies are scripted.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-agent-coordination-')));
const historyCases = ['message-history-tail', 'message-history-tool', 'message-history-hook', 'message-history-tools', 'message-history-compact', 'message-history-limit', 'message-history-restart'];
const cases = [...historyCases, 'name-foreground', 'name-background', 'name-reserved', 'message-tail', 'message-tail-hook', 'message-tail-limit', 'peer', 'peer-denied', 'peer-parent-denied', 'cap-foreground', 'cap-background', 'cap-mixed', 'cap-mixed-reverse', 'cap-disabled-background', 'cap-reuse', 'cap-unlimited', 'cap-nested', 'cap-resume'].filter(name => !option('--case') || name === option('--case'));
assert.ok(cases.length, 'unknown --case');
mkdirSync(artifacts, { recursive: true });
const entryRepo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dirname(entry), encoding: 'utf8' }).trim();
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: entryRepo, encoding: 'utf8' }).trim();
const text = content => typeof content === 'string' ? content : (content || []).map(b => b.text || '').join('\n');
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const say = value => [{ type: 'text', text: value }];
const agentId = all => all.match(/agentId:\s*([a-zA-Z0-9_-]+)/)?.[1];
const invalidNames = ['main', 'TEAM-LEAD', 'user', 'system', 'a1234567890abcdef', 'bad name'];
let failed = false;
for (const scenario of cases) {
  const dir = join(artifacts, scenario);
  mkdirSync(dir, { recursive: true });
  const config = join(dir, 'config');
  const requests = [], counts = {};
  let serverError, restart = false;
  const invocations = [];
  let releaseTail;
  const tailGate = new Promise(resolve => { releaseTail = resolve; });
  const followupCases = ['name-foreground', 'name-background', 'message-tail', 'message-tail-hook', 'message-tail-limit'];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":10}'); return;
      }
      const body = JSON.parse(raw);
      const summary = scenario === 'message-history-compact' && /create a detailed continuation summary|summarize the recent messages|summary of the conversation|summarizing.*conversation|^CRITICAL: Respond with TEXT ONLY\./i.test(text(body.messages?.at(-1)?.content));
      const first = text(body.messages?.find(m => m.role === 'user')?.content);
      const role = !summary && body.tools?.length ? ([...first.matchAll(/COORD_(MAIN|A|B|C|LEAF)\b/g)].at(-1)?.[1] || 'SIDE') : 'SIDE';
      const row = { role, body, summary }; requests.push(row);
      const n = counts[role] = (counts[role] || 0) + 1;
      const all = JSON.stringify(body.messages || []);
      const agent = body.tools?.find(t => ['Agent', 'Task'].includes(t.name))?.name || 'Agent';
      const launch = (id, who, bg) => tool(id, agent, { prompt: `COORD_${who} Complete the fixture.`, description: `Coordination ${who}`, subagent_type: scenario === 'peer-denied' ? 'no-message' : 'general-purpose', run_in_background: bg });
      let blocks;
      if (summary) {
        assert.ok(all.includes('HISTORY_INSTRUCTION_42'), 'compaction did not receive the collaboration instruction');
        blocks = say('<summary>COORD_A Continue the fixture. Retain HISTORY_INSTRUCTION_42.</summary>');
      } else if (scenario === 'message-history-compact' && role === 'A' && n === 2) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 280000 tokens > 200000 maximum' } }));
        return;
      } else if (role === 'SIDE') blocks = say('SIDE_DONE');
      else if (scenario === 'name-reserved') {
        blocks = role === 'MAIN' && n === 1
          ? invalidNames.map((name, i) => {
            const call = launch(`invalid_${i}`, 'A', true);
            call.input.name = name;
            return call;
          })
          : say('AUDIT_OK');
      } else if (historyCases.includes(scenario)) {
        if (role === 'MAIN') {
          if (restart) blocks = !all.includes('"tool_use_id":"restart_check"')
            ? [tool('restart_check', 'SendMessage', { to: agentId(all), message: 'HISTORY_RESTART_42', summary: 'Check history in a fresh process' })]
            : say(all.includes('RESTART_RETAINED_42') ? 'AUDIT_OK' : 'WAIT_FOR_RESTART');
          else if (n === 1) blocks = [launch('history_spawn', 'A', true)];
          else if (!all.includes('"tool_use_id":"history_send"')) blocks = [tool('history_send', 'SendMessage', { to: agentId(all), message: 'HISTORY_INSTRUCTION_42', summary: 'Retain a collaboration instruction' })];
          else if (!all.includes('HISTORY_HANDLED_42') && !(scenario === 'message-history-limit' && all.includes('partial result'))) {
            releaseTail(); blocks = say('WAIT_FOR_HISTORY');
          } else if (!all.includes('"tool_use_id":"history_check"')) {
            await new Promise(r => setTimeout(r, 100));
            blocks = [tool('history_check', 'SendMessage', { to: agentId(all), message: 'HISTORY_CHECK_42', summary: 'Check instruction after resume' })];
          } else blocks = say(all.includes('HISTORY_RETAINED_42') ? 'AUDIT_OK' : all.includes('HISTORY_LOST_42') ? 'HISTORY_FAILED' : 'WAIT_FOR_CHECK');
        } else if (n === 1) {
          await tailGate;
          blocks = scenario === 'message-history-tools'
            ? ['1', '2'].map(id => tool(`history_probe_${id}`, 'Bash', { command: `printf history${id}`, description: 'Exercise parallel tool hooks' }))
            : ['message-history-tool', 'message-history-hook', 'message-history-compact'].includes(scenario)
            ? [tool('history_probe', 'Bash', { command: 'printf history', description: 'Exercise tool-boundary context' })]
            : say('HISTORY_FIRST_DONE');
        } else if (all.includes('HISTORY_RESTART_42')) blocks = say(all.includes('HISTORY_INSTRUCTION_42') ? 'RESTART_RETAINED_42' : 'RESTART_LOST_42');
        else if (all.includes('HISTORY_CHECK_42')) blocks = say(all.includes('HISTORY_INSTRUCTION_42') && (scenario !== 'message-history-hook' || (all.includes('HISTORY_TOOL_CONTEXT_42') && all.includes('HISTORY_START_CONTEXT_42'))) && (scenario !== 'message-history-tools' || ['1', '2'].every(id => all.includes(`HISTORY_TOOL_CONTEXT_42_history_probe_${id}`))) && (scenario !== 'message-history-compact' || all.includes('HISTORY_COMPACT_CONTEXT_42')) ? 'HISTORY_RETAINED_42' : 'HISTORY_LOST_42');
        else blocks = say('HISTORY_HANDLED_42');
      } else if (followupCases.includes(scenario)) {
        if (role === 'MAIN') {
          if (n === 1) blocks = [launch('spawn_A', 'A', scenario !== 'name-foreground')];
          else if (!all.includes('"tool_use_id":"followup"')) {
            if (scenario === 'name-background' && !all.includes('A_DONE')) blocks = say('WAIT_FOR_AGENT');
            else {
              if (scenario === 'message-tail-hook') {
                for (let i = 0; !existsSync(join(dir, 'hook-started')) && i < 200; i++) await new Promise(r => setTimeout(r, 10));
                assert.ok(existsSync(join(dir, 'hook-started')), 'SubagentStop hook did not run');
              }
              const to = scenario.startsWith('name-') ? 'audit-worker' : agentId(all);
              assert.ok(to, 'followup recipient missing');
              blocks = [tool('followup', 'SendMessage', { to, message: 'FOLLOWUP_DELIVERED_42', summary: 'Check final-turn message delivery' })];
            }
          } else {
            releaseTail();
            if (scenario === 'message-tail-hook') writeFileSync(join(dir, 'hook-release'), 'release');
            blocks = say(all.includes(scenario === 'message-tail-limit' ? 'stopped at its 1-turn limit (partial result)' : 'FOLLOWUP_HANDLED_42') ? 'AUDIT_OK' : 'WAIT_FOR_FOLLOWUP');
          }
          if (n === 1 && scenario.startsWith('name-')) blocks[0].input.name = 'audit-worker';
        } else {
          if (scenario.startsWith('message-tail') && scenario !== 'message-tail-hook' && n === 1) await tailGate;
          blocks = say(all.includes('FOLLOWUP_DELIVERED_42') ? 'FOLLOWUP_HANDLED_42' : 'A_DONE');
        }
      } else if (scenario.startsWith('peer')) {
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
  if (scenario === 'message-history-compact') cliArgs.splice(cliArgs.indexOf('--'), 0, '--settings', JSON.stringify({ hooks: { SessionStart: [{ matcher: 'compact', hooks: [{ type: 'command', command: `echo '${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'HISTORY_COMPACT_CONTEXT_42' } })}'` }] }] } }));
  if (scenario === 'message-history-limit') cliArgs.splice(cliArgs.indexOf('--'), 0, '--agents', JSON.stringify({ 'general-purpose': { description: 'One-turn retention fixture', prompt: 'Complete the fixture.', maxTurns: 1 } }));
  if (['message-history-hook', 'message-history-tools'].includes(scenario)) {
    writeFileSync(join(dir, 'history-hook.mjs'), `import {existsSync,writeFileSync} from 'node:fs';let raw='';for await(const c of process.stdin)raw+=c;const input=JSON.parse(raw),event=input.hook_event_name;if(event==='SubagentStart'){if(existsSync('history-started'))process.exit(0);writeFileSync('history-started','1');}console.log(JSON.stringify({hookSpecificOutput:{hookEventName:event,additionalContext:event==='SubagentStart'?'HISTORY_START_CONTEXT_42':'HISTORY_TOOL_CONTEXT_42'+(${JSON.stringify(scenario === 'message-history-tools')}?'_'+input.tool_use_id:'')}}));`);
    cliArgs.splice(cliArgs.indexOf('--'), 0, '--settings', JSON.stringify({ hooks: { SubagentStart: [{ hooks: [{ type: 'command', command: 'bun history-hook.mjs' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bun history-hook.mjs' }] }] } }));
  }
  if (scenario === 'message-tail-limit') cliArgs.splice(cliArgs.indexOf('--'), 0, '--agents', JSON.stringify({ 'general-purpose': { description: 'One-turn messaging fixture', prompt: 'Complete the fixture.', maxTurns: 1 } }));
  if (scenario === 'message-tail-hook') cliArgs.splice(cliArgs.indexOf('--'), 0, '--settings', JSON.stringify({ hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: 'touch hook-started; while [ ! -f hook-release ]; do sleep 0.02; done' }] }] } }));
  if (scenario === 'peer-denied') cliArgs.splice(cliArgs.indexOf('--'), 0, '--agents', JSON.stringify({ 'no-message': { description: 'Fixture without messaging permission', prompt: 'Complete the fixture using Bash only.', tools: ['Bash'] } }));
  if (scenario === 'peer-parent-denied') cliArgs.splice(cliArgs.indexOf('--'), 0, '--disallowedTools', 'SendMessage');
  const command = entry.endsWith('.js') ? ['bun', entry, ...cliArgs] : [entry, ...cliArgs];
  const start = performance.now();
  let stdout = '', stderr = '';
  const invoke = async extra => {
    const current = [...command.slice(0, -2), ...extra, ...command.slice(-2)];
    invocations.push(current);
    const child = spawn(current[0], current.slice(1), { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
    const exit = await new Promise((r, reject) => { child.on('error', reject); child.on('close', (code, signal) => r({ code, signal })); });
    clearTimeout(timer);
    return exit;
  };
  const seedExit = await invoke([]);
  let exit = seedExit;
  if (scenario === 'message-history-restart' && seedExit.code === 0) {
    const seed = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).filter(e => e.type === 'result').at(-1);
    assert.ok(seed?.session_id, 'seed session ID missing');
    restart = true;
    exit = await invoke(['--resume', seed.session_id]);
  }
  server.closeAllConnections(); await new Promise(r => server.close(r));
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
    const sidechain = historyCases.includes(scenario) || scenario === 'peer'
      ? readdirSync(config, { recursive: true }).filter(p => p.includes('subagents/') && p.endsWith('.jsonl')).flatMap(p => readFileSync(join(config, p), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
      : [];
    if (historyCases.includes(scenario)) {
      const saved = sidechain.filter(m => m.type === 'attachment' && m.attachment?.prompt === 'HISTORY_INSTRUCTION_42');
      assert.ok(saved.length, 'collaboration message was not persisted');
      assert.equal(new Set(saved.map(m => m.attachment.source_uuid)).size, 1, 'message identity changed during resume');
      assert.ok(saved.every(m => m.attachment.source_uuid && m.attachment.origin?.kind === 'coordinator'), 'message identity or origin missing');
      assert.equal(seedExit.code, 0);
      const child = requests.filter(r => r.role === 'A');
      const checked = child.find(r => JSON.stringify(r.body.messages).includes('HISTORY_CHECK_42'));
      assert.ok(checked, 'explicit agent resume never ran');
      assert.ok(JSON.stringify(checked.body.messages).includes('HISTORY_INSTRUCTION_42'), 'collaboration instruction was lost on resume');
      assert.equal(counts.A, scenario === 'message-history-limit' ? 2 : scenario === 'message-history-restart' || scenario === 'message-history-compact' ? 4 : 3, 'instruction bypassed turn limit or was executed more than once');
      if (scenario === 'message-history-compact') {
        assert.ok(requests.some(r => r.summary), 'compaction never ran');
        const post = child.find(r => JSON.stringify(r.body.messages).includes('HISTORY_COMPACT_CONTEXT_42'));
        assert.ok(post && post !== checked, 'post-compact hook context never reached the model');
        assert.ok(JSON.stringify(checked.body.messages).includes('HISTORY_COMPACT_CONTEXT_42'), 'post-compact context was lost on resume');
      }
      if (scenario === 'message-history-tools') {
        const wire = JSON.stringify(checked.body.messages);
        for (const id of ['1', '2']) assert.ok(wire.includes(`HISTORY_TOOL_CONTEXT_42_history_probe_${id}`), 'parallel hook context fell off the transcript chain');
        const results = checked.body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result' && b.tool_use_id?.startsWith('history_probe_'));
        assert.equal(new Set(results.map(b => b.tool_use_id)).size, 2, 'a parallel tool result was lost');
      }
      if (scenario === 'message-history-hook') {
        assert.ok(JSON.stringify(child[1].body.messages).includes('HISTORY_TOOL_CONTEXT_42'), 'tool hook context never reached the model');
        assert.ok(JSON.stringify(checked.body.messages).includes('HISTORY_TOOL_CONTEXT_42'), 'tool hook context was lost on resume');
        assert.ok(JSON.stringify(checked.body.messages).includes('HISTORY_START_CONTEXT_42'), 'initial hook context was lost');
      }
      if (scenario === 'message-history-restart') {
        const fresh = child.find(r => JSON.stringify(r.body.messages).includes('HISTORY_RESTART_42'));
        assert.ok(fresh && JSON.stringify(fresh.body.messages).includes('HISTORY_INSTRUCTION_42'), 'fresh process lost collaboration history');
      }
    } else if (scenario === 'name-reserved') {
      assert.equal(counts.A || 0, 0, 'an invalid or reserved name launched an agent');
      const rejected = main.flatMap(r => r.body.messages).flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result' && b.tool_use_id?.startsWith('invalid_') && b.is_error);
      assert.equal(new Set(rejected.map(b => b.tool_use_id)).size, invalidNames.length, 'not all invalid names were refused');
    } else if (scenario === 'message-tail-limit') {
      assert.equal(counts.A, 1, 'pending messages bypassed the agent turn limit');
      assert.ok(mainWire.includes('stopped at its 1-turn limit (partial result)'), 'turn-limited result was reported as complete');
      assert.ok(!childWire.includes('FOLLOWUP_DELIVERED_42'), 'message was consumed past the turn limit');
    } else if (followupCases.includes(scenario)) {
      assert.equal(counts.A, 2, 'followup was dropped or executed more than once');
      assert.ok(mainWire.includes('FOLLOWUP_HANDLED_42'), 'followup result never reached main');
      assert.ok(requests.filter(r => r.role === 'A').some(r => JSON.stringify(r.body.messages).includes('FOLLOWUP_DELIVERED_42')), 'agent did not receive followup');
      assert.ok(main.some(r => r.body.messages.some(m => (Array.isArray(m.content) ? m.content : []).some(b => { if (b.tool_use_id !== 'followup') return false; try { return JSON.parse(text(b.content)).success === true; } catch { return false; } }))), 'followup was not accepted');
    } else if (scenario.startsWith('peer')) {
      const sender = requests.filter(r => r.role === 'A');
      assert.ok(sender.length >= 2, 'sender tool result was not checked');
      const exposed = sender[0].body.tools.some(t => t.name === 'SendMessage');
      const recipient = requests.filter(r => r.role === 'B');
      assert.ok(recipient.length >= 2, 'recipient tool boundary never ran');
      const received = recipient.some(r => JSON.stringify(r.body.messages).includes('PEER_DELIVERED_42'));
      if (scenario !== 'peer-parent-denied') assert.equal(exposed, scenario === 'peer', 'custom tool boundary changed');
      assert.equal(received, scenario === 'peer', 'peer delivery crossed a restriction or was lost');
      if (scenario === 'peer') {
        const senderId = sidechain.find(m => m.type === 'user' && text(m.message?.content).includes('COORD_A'))?.agentId;
        const saved = sidechain.filter(m => m.type === 'attachment' && m.attachment?.prompt === 'PEER_DELIVERED_42');
        assert.ok(senderId && saved.length && saved.every(m => m.attachment.origin?.agentId === senderId && m.attachment.source_uuid), 'peer sender or message identity was lost');
        assert.ok(recipient.some(r => JSON.stringify(r.body.messages).includes(JSON.stringify(`Agent "${senderId}" sent a message`).slice(1, -1))), 'model was not told who sent the peer message');
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
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ command, invocations, revision, entry_sha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), source_diff_sha256: createHash('sha256').update(execFileSync('git', ['diff', '--', 'src'], { cwd: entryRepo })).digest('hex'), input: cliArgs.at(-1), exit, seconds: (performance.now() - start) / 1000, counts, passed: !failure, failure }, null, 2));
  console.log(`${failure ? 'FAIL' : 'PASS'} ${scenario}${failure ? ': ' + failure : ''}`);
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = failed ? 1 : 0;
