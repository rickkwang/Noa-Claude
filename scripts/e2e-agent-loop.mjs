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
const cases = ['read', 'large-output', 'max-turns', 'malformed', 'empty', 'alternating', 'fallback', 'provider-quota', 'refusal', 'refusal-repeat', 'truncated', 'stale-signature', 'budget-streaming', 'budget-nonstream', 'permission-deny', 'deny-rule', 'hook-block', 'compact-resume', 'task-crud', 'task-metadata-race', 'task-dependency-race', 'goal-child-usage', 'agent-custom-fork', 'hook-composition', 'tombstone-resume', 'concurrency-streaming', 'concurrency-nonstream', 'background-deadline'].filter(name => !option('--case') || name === option('--case'));
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
    const harness = active.case.startsWith('task-') || active.case === 'goal-child-usage' || active.case==='agent-custom-fork';
    const customChild=active.case==='agent-custom-fork'&&((lastText.includes('CHILD_CUSTOM_FORK_')||body.tools?.every(t=>t.name==='Read'))||body.messages?.at(-1)?.content?.some?.(b=>b.type==='tool_result'&&b.tool_use_id.startsWith('custom_read_')));
    const child = customChild || active.case === 'goal-child-usage' && (lastText.includes('CHILD_USAGE_FIXTURE') || body.messages?.at(-1)?.content?.some?.(b => b.type === 'tool_result' && b.tool_use_id === 'child_read'));
    active.requests.at(-1).child = child;
    const n = active.requests.filter(r => (harness || active.case.startsWith('hook-') || active.case.startsWith('concurrency-') || active.case === 'background-deadline') ? r.body.tools?.length && !r.child : !r.summary).length;
    const error = (status, type, message) => {
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0', 'x-should-retry': status === 529 ? 'true' : 'false' });
      res.end(JSON.stringify({ type: 'error', error: { type, message } }));
    };
    if (active.case === 'fallback' && n <= 8) {
      error(529, 'overloaded_error', 'Scripted overload on primary and fallback');
      return;
    }
    if(active.case==='provider-quota'){error(403,'permission_error',"You've reached your weekly (7-day) usage limit. Your quota will reset when the current 7-day window ends.");return;}
    let content, stop = 'end_turn';
    if (harness && !body.tools?.length) {
      content = [{type:'text',text:active.case==='goal-child-usage'?JSON.stringify({achieved:true,reason:'Fixture child Read completed.'}):'metadata'}];
    } else if (customChild) {
      active.childRequests=(active.childRequests||0)+1;
      active.requests.at(-1).childStep=active.childRequests;
      const reading=active.childRequests%2===1;
      content=reading?[{type:'tool_use',id:'custom_read_'+active.childRequests,name:'Read',input:{file_path:join(active.dir,'fixture.txt')}}]:[{type:'text',text:'CUSTOM_DONE'}];stop=reading?'tool_use':'end_turn';
    } else if(active.case==='agent-custom-fork') {
      const agentName=body.tools.find(t=>t.name==='Task'||t.name==='Agent')?.name||'Task';
      let step;
      if(n===1)step={name:agentName,input:{prompt:'CHILD_CUSTOM_FORK_LAUNCH',description:'Custom fork fixture',subagent_type:'fork',run_in_background:false}};
      else if(n===2){const all=JSON.stringify(body.messages);const id=all.match(/agentId:\s*([a-zA-Z0-9_-]+)/)?.[1];assert.ok(id,'agent id not returned');step={name:'SendMessage',input:{to:id,message:'CHILD_CUSTOM_FORK_RESUME',summary:'Resume custom fixture'}};}
      else if((active.childRequests||0)<4)step={name:'Bash',input:{command:'sleep 0.2',description:'Await resumed fixture'}};
      content=step?[{type:'tool_use',id:'parent_'+n,...step}]:[{type:'text',text:'AUDIT_OK'}];stop=step?'tool_use':'end_turn';
    } else if (child) {
      active.childRequests=(active.childRequests||0)+1;
      content=active.childRequests===1?[{type:'tool_use',id:'child_read',name:'Read',input:{file_path:join(active.dir,'fixture.txt')}}]:[{type:'text',text:'CHILD_'},{type:'text',text:'DONE'}];stop=active.childRequests===1?'tool_use':'end_turn';
    } else if(active.case==='task-crud'){
      const steps=[{name:'TaskCreate',input:{subject:'HARNESS_TASK_PROBE',description:'Isolated CRUD'}},{name:'TaskUpdate',input:{taskId:'1',status:'in_progress'}},{name:'TaskGet',input:{taskId:'1'}},{name:'TaskUpdate',input:{taskId:'1',status:'completed'}},{name:'TaskList',input:{}}];
      const step=steps[n-1];content=step?[{type:'tool_use',id:'task_'+n,...step}]:[{type:'text',text:'AUDIT_OK'}];stop=step?'tool_use':'end_turn';
    } else if(active.case==='task-metadata-race'){
      if(n===1){content=[{type:'tool_use',id:'create',name:'TaskCreate',input:{subject:'HARNESS_METADATA_RACE',description:'Concurrent field merge'}}];stop='tool_use'}
      else if(n===2){content=[{type:'tool_use',id:'alpha',name:'TaskUpdate',input:{taskId:'1',metadata:{alpha:1}}},{type:'tool_use',id:'beta',name:'TaskUpdate',input:{taskId:'1',metadata:{beta:2}}}];stop='tool_use'}
      else content=[{type:'text',text:'AUDIT_OK'}];
    } else if(active.case==='task-dependency-race'){
      if(n<=3){content=[{type:'tool_use',id:'create_'+n,name:'TaskCreate',input:{subject:'DEPENDENCY_'+n,description:'Concurrent graph'}}];stop='tool_use'}
      else if(n===4){content=[{type:'tool_use',id:'block_b',name:'TaskUpdate',input:{taskId:'1',addBlocks:['2']}},{type:'tool_use',id:'block_c',name:'TaskUpdate',input:{taskId:'1',addBlocks:['3']}}];stop='tool_use'}
      else content=[{type:'text',text:'AUDIT_OK'}];
    } else if(active.case==='goal-child-usage'){
      const agentName=body.tools.find(t=>t.name==='Task'||t.name==='Agent')?.name||'Task';
      const steps=[{name:'goal',input:{operation:'create_goal',objective:'Run the explicitly requested isolated child usage test and finish.',token_budget:100000}},{name:agentName,input:{prompt:'CHILD_USAGE_FIXTURE',description:'Read fixture',subagent_type:'general-purpose'}},{name:'goal',input:{operation:'get_goal'}},{name:'goal',input:{operation:'update_goal',status:'complete'}}];
      const step=steps[n-1];content=step?[{type:'tool_use',id:'goal_'+n,...step}]:[{type:'text',text:'AUDIT_OK'}];stop=step?'tool_use':'end_turn';
    } else if (summary) {
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
    } else if ((['malformed', 'tombstone-resume'].includes(active.case) && n === 1) || (active.case === 'alternating' && n <= 8 && n % 2 === 1)) {
      content = [{ type: 'text', text: 'Calling a tool now.' }]; stop = 'tool_use';
    } else if ((active.case === 'empty' && n === 1) || (active.case === 'alternating' && n <= 8 && n % 2 === 0)) {
      content = [];
    } else if (active.case === 'truncated' && n === 1) {
      content = [{ type: 'text', text: 'PARTIAL_' }];
    } else if (active.case === 'stale-signature' && n === 1) {
      content = [{ type: 'thinking', thinking: 'plan', signature: 'sig' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: join(active.dir, 'fixture.txt') } }]; stop = 'tool_use';
    } else if (active.case === 'stale-signature' && n === 2) {
      error(400, 'invalid_request_error', 'messages.1.content.0: Invalid `signature` in `thinking` block');
      return;
    } else if ((active.case === 'refusal' && n === 1) || active.case === 'refusal-repeat') {
      content = [{ type: 'text', text: 'Partial answer.' }]; stop = 'refusal';
    } else if (active.case.startsWith('budget-')) {
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'printf started > started.txt; sleep 2; printf finished > finished.txt', timeout: 10000 } }]; stop = 'tool_use';
    } else if ((active.case === 'permission-deny' || active.case === 'deny-rule') && n === 1) {
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'printf denied > denied.txt' } }]; stop = 'tool_use';
    } else if (active.case === 'background-deadline' && n <= 2) {
      // A background command that outlives its limit, then a foreground wait
      // long enough for the limit to fire while the turn is still open.
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: n === 1
        ? { command: 'sleep 37.25', run_in_background: true, timeout: 2000, description: 'Deadline fixture' }
        : { command: 'sleep 4', description: 'Wait past the deadline' } }]; stop = 'tool_use';
    } else if (active.case.startsWith('concurrency-') && n === 1) {
      content = [1, 2].map(i => ({ type: 'tool_use', id: 'write_' + i, name: 'Bash', input: { command: 'pwd' } })); stop = 'tool_use';
    } else if (active.case === 'max-turns' || ((active.case === 'read' || active.case.startsWith('hook-')) && n === 1) || (active.case === 'compact-resume' && n <= 3)) {
      content = [
        ...(active.case === 'compact-resume' ? [{ type: 'text', text: 'prior-context '.repeat(5000) }] : []),
        { type: 'tool_use', id: `toolu_${n}`, name: 'Read', input: { file_path: join(active.dir, 'fixture.txt') } },
      ]; stop = 'tool_use';
    } else {
      content = [{ type: 'text', text: 'AUDIT_OK' }];
    }
    const msg = { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: child ? {input_tokens:1,output_tokens:1,cache_read_input_tokens:5000,cache_creation_input_tokens:4000} : harness ? {input_tokens:1,output_tokens:1} : {input_tokens:100,output_tokens:10} };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg)); return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    emit('message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null, usage: {...msg.usage,output_tokens:0} } });
    for (const [index, block] of content.entries()) {
      if (block.type === 'thinking') {
        emit('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
        emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
        emit('content_block_stop', { type: 'content_block_stop', index });
        continue;
      }
      emit('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } });
      emit('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      emit('content_block_stop', { type: 'content_block_stop', index });
    }
    if (active.case === 'budget-streaming') {
      for (let i = 0; i < 100 && !existsSync(join(active.dir, 'started.txt')); i++) await delay(20);
    }
    // The connection drops after output: no stop reason, no message_stop.
    if (active.case === 'truncated' && n === 1) { res.end(); return; }
    emit('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: {output_tokens:msg.usage.output_tokens} });
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
    CLAUDE_CODE_TASK_LIST_ID: 'harness-probe', NOA_CLAUDE_STREAMING_TOOL_EXECUTION: ['budget-nonstream', 'concurrency-nonstream'].includes(scenario) ? '0' : '1', FALLBACK_FOR_ALL_PRIMARY_MODELS: '1', CLAUDE_CODE_EAGER_FLUSH: '1',
  });
  const streamingInput = scenario.startsWith('budget-');
  const harness = scenario.startsWith('task-') || scenario === 'goal-child-usage' || scenario==='agent-custom-fork';
  // Hooks are off under --bare, so the hook scenario runs the full startup path.
  // --bare drops run_in_background, so the deadline scenario needs the full startup path too.
  const command = [...(scenario.startsWith('hook-') || scenario.startsWith('concurrency-') || scenario === 'background-deadline' || harness ? [] : ['--bare']), '--print', '--verbose', '--output-format', 'stream-json', '--model', model, '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', harness ? (scenario==='agent-custom-fork'?'Read,Bash,Task,SendMessage':scenario==='goal-child-usage'?'Read,Task,goal':'TaskCreate,TaskUpdate,TaskGet,TaskList') : 'Read,Bash', '--max-turns', harness ? '8' : scenario === 'compact-resume' ? '6' : scenario === 'background-deadline' ? '4' : '2'];
  if (scenario !== 'compact-resume' && scenario !== 'tombstone-resume' && scenario!=='agent-custom-fork') command.push('--no-session-persistence');
  if (scenario === 'fallback') command.push('--fallback-model', 'claude-haiku-4-5');
  // An allow rule that the narrower deny rule must still beat.
  if (scenario === 'deny-rule') command.push('--allowedTools', 'Bash', '--disallowedTools', 'Bash(printf:*)');
  if (scenario === 'background-deadline') command.push('--allowedTools', 'Bash');
  if (scenario === 'hook-block') command.push('--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'printf ran > hook-ran.txt; echo HOOK_BLOCKED_42 >&2; exit 2' }] }] } }));
  if (scenario === 'hook-composition') command.push('--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Read', hooks: [
    { type: 'command', command: 'printf ran > hook-ran.txt; echo HOOK_BLOCKED_42 >&2; exit 2' },
    { type: 'command', command: `sleep 0.05; echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'` },
  ] }] } }));
  if (scenario.startsWith('concurrency-')) {
    writeFileSync(join(active.dir, 'rewrite-hook.cjs'), `let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',()=>{const id=JSON.parse(raw).tool_use_id;const command='if mkdir write-lock 2>/dev/null; then echo start-'+id+' >> writes.txt; sleep 0.1; echo end-'+id+' >> writes.txt; rmdir write-lock; else echo OVERLAP >> writes.txt; fi';console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{command}}}));});`);
    command.push('--settings', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bun rewrite-hook.cjs' }] }] } }));
  }
  if (streamingInput) command.push('--input-format', 'stream-json', '--allowedTools', 'Bash', '--max-budget-usd', '0.0001');
  command.push(...extra);
  const started = performance.now();
  // A bundle (dist/main-dev.js) has no shebang; run it through bun.
  const [bin, binArgs] = executable.endsWith('.js') ? ['bun', [executable, ...command]] : [executable, command];
  if(scenario==='agent-custom-fork')binArgs.push('--agents',JSON.stringify({fork:{description:'Custom agent named fork',prompt:'FORK_CUSTOM_RULE_42',tools:['Read']}}));
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
      if (executable !== entry && (scenario === 'compact-resume' || scenario === 'goal-child-usage')) continue;
      const dir = join(artifacts, `${executable === entry ? 'candidate' : 'comparison'}-${scenario}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'fixture.txt'), 'LOCAL_FIXTURE_42\n');
      active = { case: scenario, dir, requests: [], invocations: [], summaries: 0, oversized: 0 };
      let passed = false, failure, observation, runResult;
      try {
        if (scenario === 'tombstone-resume') {
          active.phase = 'seed';
          const seed = await run(executable, scenario);
          assert.equal(seed.code, 0); assert.equal(seed.result.result, 'AUDIT_OK');
          assert.ok(active.requests.some(r => JSON.stringify(r.body.messages).includes('failed to produce a valid tool call')), 'malformed recovery never ran');
          active.phase = 'resume';
          runResult = await run(executable, scenario, ['--resume', seed.result.session_id], 'Continue the prior task.');
          assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
          assert.ok(!JSON.stringify(active.requests.at(-1).body.messages).includes('Calling a tool now.'), 'tombstoned response returned on resume');
        } else if (scenario === 'compact-resume') {
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
          runResult = await run(executable, scenario, [], scenario==='goal-child-usage'?'Create a temporary goal, run a child agent, report its usage and finish.':'Run the local loop fixture.');
          const count = active.requests.length;
          // Without --bare the CLI also makes side requests; the loop's own carry the tool list.
          const main = active.requests.filter(r => r.body.tools?.length);
          if(scenario==='agent-custom-fork'){
            assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK');assert.ok(active.childRequests>=4,'resumed child never ran');
            const resumed=active.requests.find(r=>r.childStep===3);assert.ok(JSON.stringify(resumed.body.system).includes('FORK_CUSTOM_RULE_42'),'custom agent named fork lost its system prompt on resume');assert.deepEqual(resumed.body.tools.map(t=>t.name),['Read'],'resuming custom fork widened its tool pool');
          } else if (scenario.startsWith('task-') || scenario==='goal-child-usage') {
          assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK');assert.ok(count>=3,'tools never ran');
          const task=id=>JSON.parse(readFileSync(join(dir,`config/tasks/harness-probe/${id}.json`),'utf8'));
          if(scenario==='task-crud')assert.equal(task(1).status,'completed');
          if(scenario==='task-metadata-race'){active.finalState=task(1);assert.deepEqual(active.finalState.metadata,{alpha:1,beta:2});}
          if(scenario==='task-dependency-race'){active.finalState=[task(1),task(2),task(3)];assert.deepEqual(active.finalState[0].blocks.sort(),['2','3']);assert.deepEqual(active.finalState[1].blockedBy,['1']);assert.deepEqual(active.finalState[2].blockedBy,['1']);}
          if(scenario==='goal-child-usage'){
            const goals=active.requests.flatMap(r=>r.body.messages||[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='tool_result'&&b.tool_use_id==='goal_3').map(b=>{try{return JSON.parse(b.content).goal}catch{return null}}).filter(Boolean);
            assert.ok(active.childRequests>=2,'child did not call a real tool');assert.ok(goals.some(g=>g.tokens_used===2*(1+1+5000+4000)+2),'child/cache tokens missing from parent goal');
          }
          } else if(scenario==='provider-quota') {
            assert.equal(runResult.code,1);assert.equal(runResult.result.is_error,true);assert.equal(runResult.result.terminal_reason,'api_error');assert.equal(count,1);assert.ok(runResult.result.result.includes('weekly (7-day) usage limit'));
            if(executable===entry)assert.ok(runResult.result.result.startsWith('Usage limit reached.'),'quota was reported as invalid authentication');
          } else if (scenario === 'alternating' || scenario === 'fallback') {
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
          } else if (scenario.startsWith('concurrency-')) {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            const writes = readFileSync(join(dir, 'writes.txt'), 'utf8').trim().split('\n');
            assert.equal(writes.length, 4, 'a rewritten write was skipped or overlapped');
            assert.deepEqual(writes.map(line => line.split('-')[0]), ['start', 'end', 'start', 'end']);
            assert.equal(writes[0].slice(6), writes[1].slice(4)); assert.equal(writes[2].slice(6), writes[3].slice(4));
            active.finalState = writes;
          } else if (scenario === 'stale-signature') {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK'); assert.equal(count, 3);
            assert.ok(JSON.stringify(active.requests[1].body.messages).includes('"thinking"'), 'fixture never replayed a thinking block');
            assert.ok(!JSON.stringify(active.requests[2].body.messages).includes('"thinking"'), 'retry still sent the rejected thinking block');
          } else if (scenario === 'background-deadline') {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            const bash = main[0].body.tools.find(t => t.name === 'Bash');
            assert.ok(bash.input_schema.properties.run_in_background.description.includes('limits how long the command may run in the background'), 'schema does not state the background limit');
            // The limit fires during the foreground wait, so the notification
            // must arrive with that tool result, inside the same turn.
            const sameTurn = JSON.stringify(main[2].body.messages.slice(-1));
            assert.ok(sameTurn.includes('was stopped after reaching its background time limit'), 'limit notification did not arrive within the turn');
            assert.ok(sameTurn.includes('<note>If the work in progress still needs it'), 'notification lacks the next-step note');
            // The fixture's unusual duration is its fingerprint in the process table.
            let survivors = '';
            try { survivors = execFileSync('pgrep', ['-f', 'sleep 37.25'], { encoding: 'utf8' }).trim(); } catch {}
            assert.equal(survivors, '', 'background command kept running past its limit');
            active.finalState = { notified: true, survivors };
          } else if (scenario.startsWith('hook-')) {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            assert.equal(existsSync(join(dir, 'hook-ran.txt')), true, 'PreToolUse hook never ran; block path untested');
            const followUp = JSON.stringify(main[1]?.body.messages);
            assert.ok(followUp.includes('HOOK_BLOCKED_42'), 'hook block reason did not reach the model');
            assert.ok(!followUp.includes('LOCAL_FIXTURE_42'), 'Read ran despite the blocking hook');
          } else {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK'); assert.equal(count, 2);
            if (scenario === 'truncated') assert.ok(JSON.stringify(active.requests[1].body.messages).includes('cut off mid-stream'), 'truncated output was returned as complete');
            if (scenario === 'refusal') assert.ok(JSON.stringify(active.requests[1].body.messages).includes('stopped by a safety classifier'), 'retry did not tell the model why it stopped');
            if (scenario === 'read') assert.ok(JSON.stringify(active.requests[1].body.messages).includes('LOCAL_FIXTURE_42'), 'actual Read result missing');
          }
        }
        assert.equal(active.transportError, undefined);
        passed = true;
      } catch (error) { failure = String(error); }
      observation = { result: runResult?.result, finalState:active.finalState, childRequests:active.childRequests, requests: active.requests.length, summaries: active.summaries, oversized: active.oversized, startedAtResult: active.startedAtResult, finishedAtResult: active.finishedAtResult, started: active.started, finished: active.finished };
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
