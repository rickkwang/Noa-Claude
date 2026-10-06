#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = join(repo, 'dist', 'cli');
const artifacts = process.argv[2] || mkdtempSync(join(tmpdir(), 'noa-tool-parity-'));
mkdirSync(artifacts, { recursive: true });
const page = 'HEAD_MARK\n' + 'x'.repeat(100000 - 10) + 'TAIL_MARK\n';
const text = value => typeof value === 'string' ? value : (value || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
const resultBlocks = body => body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
let active;
const cert = join(artifacts, 'fixture-cert.pem');
const key = join(artifacts, 'fixture-key.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=fixture.example', '-addext', 'subjectAltName=DNS:fixture.example,DNS:api.anthropic.com'], { stdio: 'ignore' });
const pageServer = createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, (req, res) => {
  if (req.url.includes('/api/web/domain_info')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"can_fetch":true}');
  } else {
    active.pageReads++;
    res.writeHead(200, { 'content-type': 'text/markdown' }); res.end(page);
  }
});
await new Promise(r => pageServer.listen(0, '127.0.0.1', r));
const proxy = createServer((req, res) => {
  if (req.url.includes('/api/web/domain_info')) {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"can_fetch":true}');
  } else {
    active.pageReads++;
    res.writeHead(200, { 'content-type': 'text/markdown' }); res.end(page);
  }
});
proxy.on('connect', (req, socket, head) => {
  if (!['fixture.example:443', 'api.anthropic.com:443'].includes(req.url)) { socket.destroy(); return; }
  const upstream = connect(pageServer.address().port, '127.0.0.1', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream); upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const api = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  if (!req.url.includes('/messages')) { res.end('{}'); return; }
  if (req.url.includes('count_tokens')) { res.end('{"input_tokens":100}'); return; }
  active.requests.push(body);
  writeFileSync(join(active.dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
  const secondary = !body.tools?.length;
  const child = text(body.messages.find(m => m.role === 'user')?.content).includes('PARITY_CHILD');
  let block;
  if (secondary) {
    active.secondary.push(raw);
    block = { type: 'text', text: raw.includes('TAIL_MARK') ? 'SECONDARY_TAIL' : 'SECONDARY_HEAD' };
  } else if (child) {
    active.childCalls++;
    if (active.name.startsWith('agent-switch') || active.name === 'agent-isolation-resume') {
      const children = readdirSync(join(active.dir, '.noa', 'worktrees')).filter(n => n !== 'b');
      const old = active.name === 'agent-switch-plain' ? active.dir : active.name === 'agent-switch-resume' ? join(active.dir, 'src') : join(active.dir, '.noa', 'worktrees', children[0] || 'missing');
      active.oldAgentWorktree = old;
      if (active.name === 'agent-switch-nested' && !active.nestedCreated) {
        active.nestedCreated = true; active.b = join(old, 'nested-worktree');
        git(active.dir, 'worktree', 'add', '-b', 'fixture-nested', active.b);
      }
      const steps = active.name === 'agent-isolation-resume'
        ? active.resumingChild ? [
          { name: 'EnterWorktree', input: { path: active.b } },
          { name: 'Write', input: { file_path: join(active.b, 'escape-new.txt'), content: 'MUST_NOT_WRITE' } },
          { name: 'Bash', input: { command: 'pwd' } },
        ] : [
          { name: 'Write', input: { file_path: join(old, 'owned.txt'), content: 'KEEP_ASSIGNED_ROOT' } },
          { name: 'EnterWorktree', input: { path: active.b } },
          { name: 'Write', input: { file_path: join(active.b, 'escape-new.txt'), content: 'MUST_NOT_WRITE' } },
        ] : active.name === 'agent-switch-resume'
        ? active.resumingChild ? [
          { name: 'Bash', input: { command: 'pwd' } },
          { name: 'ExitWorktree', input: { action: 'remove', discard_changes: true } },
          { name: 'ExitWorktree', input: { action: 'keep' } },
          { name: 'Bash', input: { command: 'pwd' } },
        ] : [
          { name: 'EnterWorktree', input: { path: active.b } },
          { name: 'Write', input: { file_path: join(active.b, 'saved.txt'), content: 'SAVED_IN_B' } },
        ] : [
        { name: 'EnterWorktree', input: { path: active.b } },
        { name: 'Bash', input: { command: 'pwd' } },
        { name: 'Write', input: { file_path: join(active.name === 'agent-switch' ? active.b : old, 'escape-new.txt'), content: 'MUST_NOT_WRITE' } },
        { name: 'ExitWorktree', input: { action: 'keep' } },
      ];
      const step = steps[active.childCalls - 1];
      block = step ? { type: 'tool_use', id: (active.resumingChild ? 'resumed_child_' : 'child_') + active.childCalls, ...step } : { type: 'text', text: 'PARITY_CHILD_DONE' };
    } else {
      if (active.childCalls === 1) await new Promise(r => setTimeout(r, 150));
      block = active.childCalls === 1
        ? active.name === 'agent-parent-cd'
          ? { type: 'tool_use', id: 'child_read', name: 'Write', input: { file_path: join(active.dir, 'new.txt'), content: 'NORMAL_AGENT_WRITE' } }
          : { type: 'tool_use', id: 'child_read', name: 'Read', input: { file_path: join(active.dir, 'file.txt') } }
        : { type: 'text', text: 'PARITY_CHILD_DONE' };
    }
    if (block.type === 'text') active.childDone = true;
  } else {
    active.parentCalls++;
    if ((active.name === 'agent-parent-cd' || active.name === 'agent-switch-resume') && active.parentCalls === 1) {
      block = { type: 'tool_use', id: 'parent_cd', name: 'Bash', input: { command: 'cd src' } };
    } else if (active.name.startsWith('agent-') && (active.parentCalls === 1 || ['agent-parent-cd', 'agent-switch-resume'].includes(active.name) && active.parentCalls === 2)) {
      const input = { description: 'Parity child fixture', prompt: 'PARITY_CHILD: use the fixture tools and complete.', subagent_type: 'general-purpose' };
      if (active.name === 'agent-sync' || active.name.startsWith('agent-switch') || active.name === 'agent-isolation-resume') input.run_in_background = false;
      if (active.name === 'agent-model') input.model = 'fable';
      if (['agent-switch', 'agent-switch-nested', 'agent-isolation-resume'].includes(active.name)) input.isolation = 'worktree';
      block = { type: 'tool_use', id: 'parent_1', name: 'Agent', input };
    } else if (active.name.startsWith('agent-')) {
      if (!active.childDone) block = { type: 'tool_use', id: 'await_' + active.parentCalls, name: 'Bash', input: { command: 'sleep 0.2', description: 'Await fixture notification' } };
      else if (['agent-switch-resume', 'agent-isolation-resume'].includes(active.name) && !active.resumingChild) {
        const first = resultBlocks(body).find(b => b.tool_use_id === 'parent_1');
        const id = text(first?.content).match(/agentId: ([a-z0-9]+)/)?.[1];
        assert.ok(id, 'completed agent ID missing');
        active.resumingChild = true; active.childDone = false; active.childCalls = 0;
        block = { type: 'tool_use', id: 'resume_send', name: 'SendMessage', input: { to: id, summary: 'Continue worktree fixture', message: 'PARITY_RESUME: inspect the current directory and exit the entered worktree.' } };
      } else if ((active.name.startsWith('agent-switch') || active.name === 'agent-isolation-resume') && !active.checkedParentCwd) {
        active.checkedParentCwd = true;
        block = { type: 'tool_use', id: 'parent_pwd', name: 'Bash', input: { command: 'pwd' } };
      } else block = { type: 'text', text: 'PARITY_OK' };
    } else {
      const step = active.steps[active.parentCalls - 1];
      block = step ? { type: 'tool_use', id: (active.resuming ? 'resume_' : 'step_') + active.parentCalls, ...step } : { type: 'text', text: 'PARITY_OK' };
    }
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  emit('message_start', { message: { id: 'msg_' + active.requests.length, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } });
  emit('content_block_start', { index: 0, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
  emit('content_block_delta', { index: 0, delta: block.type === 'tool_use' ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
  emit('content_block_stop', { index: 0 });
  emit('message_delta', { delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } });
  emit('message_stop', {}); res.end();
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const records = [];
async function runCli(args, env, dir) {
  const child = spawn(binary, args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  child.stdin.end('Run the explicitly requested isolated parity fixture: use its worktrees, fetched page or child agent as instructed.\n');
  const code = await new Promise(r => child.on('close', r)); clearTimeout(timer);
  return { code, stdout, stderr };
}
try {
  for (const name of ['worktree', 'worktree-resume', 'worktree-dot', 'worktree-nested-dot', 'webfetch', 'agent-default', 'agent-sync', 'agent-disabled', 'agent-model', 'agent-parent-cd', 'agent-switch', 'agent-switch-nested', 'agent-switch-plain', 'agent-switch-resume', 'agent-isolation-resume']) {
    const dir = join(artifacts, name); mkdirSync(dir, { recursive: true });
    active = { name, dir, requests: [], steps: [], parentCalls: 0, childCalls: 0, childDone: false, secondary: [], pageReads: 0 };
    writeFileSync(join(dir, 'file.txt'), 'PARITY_READ_SENTINEL\n');
    if (name === 'agent-parent-cd' || name === 'agent-switch-resume') mkdirSync(join(dir, 'src'));
    if (name.startsWith('worktree') || name.startsWith('agent-switch') || name === 'agent-isolation-resume') {
      const gitRoot = name === 'worktree-nested-dot' ? join(dir, '..project') : dir;
      mkdirSync(gitRoot, { recursive: true }); writeFileSync(join(gitRoot, 'file.txt'), 'PARITY_READ_SENTINEL\n');
      git(gitRoot, 'init', '-b', 'main'); git(gitRoot, 'config', 'user.name', 'Fixture'); git(gitRoot, 'config', 'user.email', 'fixture@example.invalid');
      git(gitRoot, 'add', 'file.txt'); git(gitRoot, 'commit', '-m', 'fixture');
      active.a = join(gitRoot, 'manual-a'); active.b = join(gitRoot, '.noa', 'worktrees', name === 'worktree-dot' ? '..b' : 'b');
      git(gitRoot, 'worktree', 'add', '-b', 'fixture-a', active.a); git(gitRoot, 'worktree', 'add', '-b', 'fixture-b', active.b);
      mkdirSync(join(dir, '.noa', 'worktrees', 'unregistered'), { recursive: true });
      active.steps = [
        { name: 'EnterWorktree', input: { path: active.a } },
        { name: 'EnterWorktree', input: { path: active.b } },
        { name: 'ExitWorktree', input: { action: 'remove', discard_changes: true } },
        { name: 'EnterWorktree', input: { path: join(dir, '.noa', 'worktrees', 'unregistered') } },
        { name: 'Bash', input: { command: 'pwd' } },
        { name: 'ExitWorktree', input: { action: 'keep' } },
        { name: 'Bash', input: { command: 'pwd' } },
        { name: 'EnterWorktree', input: { name: 'invalid', path: active.b } },
      ];
      if (name === 'worktree-resume') active.steps = [{ name: 'EnterWorktree', input: { path: active.b } }];
    }
    if (name === 'webfetch') active.steps = [0, 100000, 200000, -1].map(offset => ({ name: 'WebFetch', input: { url: 'https://fixture.example/page', prompt: 'Report the marker in this fragment.', offset } }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG'].includes(key)));
    Object.assign(env, { CLAUDE_CONFIG_DIR: join(dir, 'config'), ANTHROPIC_API_KEY: 'fixture-dummy', ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}`, ANTHROPIC_MODEL: 'claude-sonnet-4-6', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`, NO_PROXY: '127.0.0.1,localhost', NODE_EXTRA_CA_CERTS: cert, SSL_CERT_FILE: cert });
    if (name === 'agent-disabled') env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1';
    if (name === 'agent-model') { env.CLAUDE_CODE_SUBAGENT_MODEL = 'claude-haiku-4-5'; env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'claude-fable-5-1'; }
    const args = ['--print', '--verbose', '--output-format', 'stream-json', '--model', 'claude-sonnet-4-6', '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--allowedTools', 'Agent,Read,Write,Bash,EnterWorktree,ExitWorktree,WebFetch', '--max-turns', '30', '--no-session-persistence', '--settings', JSON.stringify({ worktree: { baseRef: 'head' } })];
    if (['worktree-resume', 'agent-switch-resume', 'agent-isolation-resume'].includes(name)) args.splice(args.indexOf('--no-session-persistence'), 1);
    const { code, stdout, stderr } = await runCli(args, env, dir);
    writeFileSync(join(dir, 'stdout.jsonl'), stdout); writeFileSync(join(dir, 'stderr.txt'), stderr);
    assert.equal(code, 0, `${name}: ${stderr}`);
    let resumeArgs;
    if (name === 'worktree-resume') {
      const result = stdout.trim().split('\n').map(line => JSON.parse(line)).findLast(item => item.type === 'result');
      resumeArgs = [...args, '--resume', result.session_id];
      active.resuming = true; active.parentCalls = 0;
      active.steps = [{ name: 'ExitWorktree', input: { action: 'remove', discard_changes: true } }, { name: 'ExitWorktree', input: { action: 'keep' } }, { name: 'Bash', input: { command: 'pwd' } }];
      const resumed = await runCli(resumeArgs, env, dir);
      writeFileSync(join(dir, 'resume-stdout.jsonl'), resumed.stdout); writeFileSync(join(dir, 'resume-stderr.txt'), resumed.stderr);
      assert.equal(resumed.code, 0, resumed.stderr);
    }
    const parent = active.requests.filter(b => b.tools?.length && !text(b.messages.find(m => m.role === 'user')?.content).includes('PARITY_CHILD'));
    const blocks = parent.flatMap(resultBlocks);
    const get = id => blocks.find(b => b.tool_use_id === id);
    if (name.startsWith('worktree') && name !== 'worktree-resume') {
      assert.equal(get('step_1')?.is_error, undefined); assert.equal(get('step_2')?.is_error, undefined);
      assert.equal(get('step_3')?.is_error, true); assert.equal(get('step_4')?.is_error, true);
      assert.ok(text(get('step_5')?.content).includes(active.b)); assert.ok(text(get('step_7')?.content).includes(dir));
      assert.equal(get('step_8')?.is_error, true);
      assert.ok(existsSync(active.a) && existsSync(active.b));
    } else if (name === 'worktree-resume') {
      assert.equal(get('resume_1')?.is_error, true);
      assert.equal(get('resume_2')?.is_error, undefined);
      assert.ok(text(get('resume_3')?.content).includes(dir));
      assert.ok(existsSync(active.b));
    } else if (name === 'webfetch') {
      assert.ok(text(get('step_1')?.content).includes('offset: 100000'));
      assert.ok(text(get('step_2')?.content).includes('SECONDARY_TAIL'));
      assert.ok(text(get('step_3')?.content).includes('Nothing left to read from offset 200000'));
      assert.equal(get('step_4')?.is_error, true);
      assert.equal(active.secondary.length, 2);
      assert.ok(active.secondary[0].includes('HEAD_MARK') && !active.secondary[0].includes('TAIL_MARK'));
      assert.ok(active.secondary[1].includes('TAIL_MARK') && !active.secondary[1].includes('HEAD_MARK'));
    } else {
      assert.ok(active.childDone, `${name}: child never completed`);
      const first = text(get('parent_1')?.content);
      if (name === 'agent-default' || name === 'agent-model' || name === 'agent-parent-cd') assert.ok(!first.includes('PARITY_CHILD_DONE') && /agentId|agent_id/.test(first), first);
      else assert.ok(first.includes('PARITY_CHILD_DONE'), first);
      if (name === 'agent-model') {
        const requests = active.requests.filter(b => text(b.messages.find(m => m.role === 'user')?.content).includes('PARITY_CHILD'));
        assert.ok(requests.every(b => b.model === 'claude-fable-5-1'));
      }
      if (name === 'agent-parent-cd') assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'NORMAL_AGENT_WRITE');
      if (name === 'agent-isolation-resume') {
        const requests = active.requests.filter(b => text(b.messages.find(m => m.role === 'user')?.content).includes('PARITY_CHILD'));
        const results = requests.flatMap(resultBlocks);
        for (const id of ['child_2', 'child_3', 'resumed_child_1', 'resumed_child_2']) {
          assert.equal(results.find(b => b.tool_use_id === id)?.is_error, true);
        }
        assert.ok(text(results.find(b => b.tool_use_id === 'resumed_child_3')?.content).includes(active.oldAgentWorktree));
        assert.ok(!existsSync(join(active.b, 'escape-new.txt')));
      } else if (name === 'agent-switch-resume') {
        const requests = active.requests.filter(b => text(b.messages.find(m => m.role === 'user')?.content).includes('PARITY_CHILD'));
        const results = requests.flatMap(resultBlocks);
        assert.ok(text(results.find(b => b.tool_use_id === 'resumed_child_1')?.content).includes(active.b));
        assert.equal(results.find(b => b.tool_use_id === 'resumed_child_2')?.is_error, true);
        assert.equal(results.find(b => b.tool_use_id === 'resumed_child_3')?.is_error, undefined);
        assert.ok(text(results.find(b => b.tool_use_id === 'resumed_child_4')?.content).includes(active.oldAgentWorktree));
        assert.equal(readFileSync(join(active.b, 'saved.txt'), 'utf8'), 'SAVED_IN_B');
      } else if (name.startsWith('agent-switch')) {
        const requests = active.requests.filter(b => text(b.messages.find(m => m.role === 'user')?.content).includes('PARITY_CHILD'));
        const results = requests.flatMap(resultBlocks);
        assert.equal(results.find(b => b.tool_use_id === 'child_1')?.is_error, name === 'agent-switch' ? true : undefined);
        assert.ok(text(results.find(b => b.tool_use_id === 'child_2')?.content).includes(name === 'agent-switch' ? active.oldAgentWorktree : active.b));
        assert.equal(results.find(b => b.tool_use_id === 'child_3')?.is_error, name === 'agent-switch-nested' ? undefined : true);
        if (name === 'agent-switch') assert.equal(results.find(b => b.tool_use_id === 'child_4')?.is_error, true);
        if (name !== 'agent-switch-nested') assert.ok(!existsSync(join(name === 'agent-switch' ? active.b : active.oldAgentWorktree, 'escape-new.txt')));
        assert.ok(text(get('parent_pwd')?.content).includes(dir)); assert.ok(existsSync(active.b));
      }
    }
    records.push({ name, code, requests: active.requests.length, passed: true, args, resumeArgs });
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify(records, null, 2));
    console.log(`PASS ${name}`);
  }
} finally {
  api.close(); proxy.close(); pageServer.close();
  writeFileSync(join(artifacts, 'manifest.json'), JSON.stringify({ command: process.argv, revision: git(repo, 'rev-parse', 'HEAD'), binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'), records }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
