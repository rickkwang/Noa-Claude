#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
const cases = ['agent-nested', 'agent-owned-results', 'agent-owned-auto', 'agent-cascade-stop', 'agent-schema', 'agent-schema-bg', 'hook-output', 'hook-output-null', 'blocking-limit', 'image-error', 'small-window-overflow', 'read', 'large-output', 'max-turns', 'malformed', 'empty', 'alternating', 'fallback', 'provider-quota', 'refusal', 'refusal-repeat', 'truncated', 'tool-input-streaming', 'tool-input-nonstream', 'stale-signature', 'budget-streaming', 'budget-nonstream', 'permission-deny', 'deny-rule', 'hook-block', 'compact-resume', 'task-crud', 'task-metadata-race', 'task-dependency-race', 'goal-child-usage', 'agent-custom-fork', 'hook-composition', 'tombstone-resume', 'concurrency-streaming', 'concurrency-nonstream', 'background-deadline', 'openai-overflow', 'openai-usage', 'openai-usage-nonstream', 'bedrock-overflow', 'field-reject'].filter(name => !option('--case') || name === option('--case'));
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
    const openai = req.url.includes('/chat/completions');
    if (!openai && !req.url.includes('/messages')) {
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
    const harness = active.case.startsWith('task-') || active.case === 'goal-child-usage' || active.case==='agent-custom-fork' || active.case==='agent-nested' || active.case.startsWith('agent-owned-') || active.case==='agent-cascade-stop' || active.case.startsWith('agent-schema');
    const customChild=active.case==='agent-custom-fork'&&((lastText.includes('CHILD_CUSTOM_FORK_')||body.tools?.every(t=>t.name==='Read'))||body.messages?.at(-1)?.content?.some?.(b=>b.type==='tool_result'&&b.tool_use_id.startsWith('custom_read_')));
    const child = customChild || active.case === 'goal-child-usage' && (lastText.includes('CHILD_USAGE_FIXTURE') || body.messages?.at(-1)?.content?.some?.(b => b.type === 'tool_result' && b.tool_use_id === 'child_read'));
    active.requests.at(-1).child = child;
    const n = active.requests.filter(r => active.case !== 'openai-usage-nonstream' || !r.body.stream).filter(r => (harness || active.case.startsWith('hook-') || active.case.startsWith('concurrency-') || active.case === 'background-deadline') ? r.body.tools?.length && !r.child : !r.summary).length;
    const error = (status, type, message) => {
      res.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0', 'x-should-retry': status === 529 ? 'true' : 'false' });
      res.end(JSON.stringify({ type: 'error', error: { type, message } }));
    };
    if (active.case === 'agent-owned-auto' && JSON.stringify(body.system || '').includes('<block>')) {
      // Auto-mode classifier. The grandchild's hand-back review is slow, which
      // holds its notification back after its task is already completed.
      if (JSON.stringify(body.messages).includes('GRANDCHILD_RESULT_42')) await delay(1500);
      const msg = { id: 'msg_cls', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: '<block>no</block>' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
      if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(msg)); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
      ev('message_start', { message: { ...msg, content: [], stop_reason: null } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: '<block>no</block>' } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      ev('message_stop', {}); res.end(); return;
    }
    if (active.case === 'tool-input-nonstream' && body.stream) {
      // Fail before any output so the real Anthropic transport takes its JSON fallback.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Scripted non-streaming fallback' } })}\n\n`);
      return;
    }
    if (active.case === 'compact-resume' && summary && raw.length > 500_000) {
      error(400, 'invalid_request_error', 'prompt is too long: 280000 tokens > 200000 maximum');
      return;
    }
    if (active.case === 'image-error') {
      error(400, 'invalid_request_error', 'image exceeds 5 MB maximum: 5316852 bytes > 5242880 bytes'); return;
    }
    if (active.case === 'small-window-overflow' && !summary) {
      active.endpointLimit ??= Math.ceil(JSON.stringify({system:body.system,tools:body.tools}).length/4)+2000;
      const tokens=Math.ceil(JSON.stringify({system:body.system,tools:body.tools,messages:body.messages}).length/4);
      if (tokens>active.endpointLimit) {error(400,'invalid_request_error',`prompt is too long: ${tokens} tokens > ${active.endpointLimit} maximum`);return;}
    }
    if (active.case === 'field-reject') {
      if (body.metadata) { error(400, 'invalid_request_error', 'metadata: Extra inputs are not permitted'); return; }
    }
    if (active.case === 'fallback' && n <= 8) {
      error(529, 'overloaded_error', 'Scripted overload on primary and fallback');
      return;
    }
    // After one real tool round (history to compact), a gateway-style
    // overflow: plain text, not JSON, so only the status
    // classification can carry the context-overflow signal.
    if (active.case === 'openai-overflow' && !summary && n === 2) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end("This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.");
      return;
    }
    // Bedrock's overflow wording, served over the Anthropic transport: this
    // checks the wording → reactive compact path, not Bedrock's own client.
    if (active.case === 'bedrock-overflow' && !summary && n === 2) {
      error(400, 'invalid_request_error', 'Input is too long for requested model.');
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
    } else if(active.case==='agent-nested' && body.tools?.length) {
      // Each agent's prompt carries a marker; routing keys off what its own transcript contains.
      const agentName=body.tools.find(t=>t.name==='Task'||t.name==='Agent')?.name||'Task';
      const all=JSON.stringify(body.messages);
      const spawn=prompt=>({name:agentName,input:{prompt,description:'Nested spawn fixture',subagent_type:'general-purpose',run_in_background:false}});
      let step=null,text='AUDIT_OK';
      if(/nesting limit reached/.test(all))text='DEPTH2_DONE';
      else if(all.includes('DEPTH2_DONE'))text='DEPTH1_DONE';
      else if(all.includes('DEPTH1_DONE'))text='AUDIT_OK';
      else if(all.includes('NEST_DEPTH_2'))step=spawn('NEST_DEPTH_3');
      else if(all.includes('NEST_DEPTH_1'))step=spawn('NEST_DEPTH_2');
      else step=spawn('NEST_DEPTH_1');
      content=step?[{type:'tool_use',id:'nest_'+n,...step}]:[{type:'text',text}];stop=step?'tool_use':'end_turn';
    } else if(active.case.startsWith('agent-owned-') && body.tools?.length) {
      // Background parent spawns a background grandchild and stops at once;
      // the grandchild is slow, so the parent must wait to read its result.
      const agentName=body.tools.find(t=>t.name==='Task'||t.name==='Agent')?.name||'Task';
      const all=JSON.stringify(body.messages);const first=textOf(body.messages[0]?.content);
      const spawn=(id,prompt)=>({type:'tool_use',id,name:agentName,input:{prompt,description:'Owned result fixture',subagent_type:'general-purpose',run_in_background:true}});
      let step=null,text;
      if(first.includes('OWNED_GRANDCHILD')){await delay(1000);text='GRANDCHILD_RESULT_42';}
      else if(first.includes('OWNED_PARENT'))all.includes('"tool_use_id":"owned_g"')?text=all.includes('GRANDCHILD_RESULT_42')?'PARENT_SAW_CHILD':'PARENT_MISSED_CHILD':step=spawn('owned_g','OWNED_GRANDCHILD');
      else if(!all.includes('"tool_use_id":"owned_p"'))step=spawn('owned_p','OWNED_PARENT');
      else text=all.includes('PARENT_SAW_CHILD')?'AUDIT_OK':'WAITING_FOR_PARENT';
      content=step?[step]:[{type:'text',text}];stop=step?'tool_use':'end_turn';
    } else if(active.case.startsWith('agent-schema') && body.tools?.length) {
      // Main thread spawns a sync (agent-schema) or background (agent-schema-bg)
      // subagent with a schema; the child first ends its turn without
      // StructuredOutput (the SubagentStop hook must nag), then calls it. The
      // result must reach the main thread as structured_output — inline for
      // sync, via the completion notification for background.
      const agentName=body.tools.find(t=>t.name==='Task'||t.name==='Agent')?.name||'Task';
      const all=JSON.stringify(body.messages);const first=textOf(body.messages[0]?.content);
      let step=null,text;
      if(first.includes('SCHEMA_CHILD_FIXTURE')){
        if(!all.includes('SCHEMA_IGNORE_ONCE'))text='SCHEMA_IGNORE_ONCE';
        else if(!all.includes('"tool_use_id":"schema_out"'))step={type:'tool_use',id:'schema_out',name:'StructuredOutput',input:{ok:true,answer:'SCHEMA_ANSWER_42'}};
        // A failed call AFTER the valid one: extraction must keep the
        // validated object, and the stop hook must not nag again.
        else if(!all.includes('"tool_use_id":"schema_bad"'))step={type:'tool_use',id:'schema_bad',name:'StructuredOutput',input:{ok:true,answer:42}};
        else text='CHILD_DONE';
      }
      else if(!all.includes('"tool_use_id":"schema_p"'))step={type:'tool_use',id:'schema_p',name:agentName,input:{prompt:'SCHEMA_CHILD_FIXTURE',description:'Schema fixture',subagent_type:'general-purpose',run_in_background:active.case==='agent-schema-bg',schema:{type:'object',properties:{ok:{type:'boolean'},answer:{type:'string'}},required:['ok','answer']}}};
      else text=all.includes('SCHEMA_ANSWER_42')?'AUDIT_OK':(active.case==='agent-schema-bg'?'WAITING_FOR_CHILD':'SCHEMA_MISSING');
      content=step?[step]:[{type:'text',text}];stop=step?'tool_use':'end_turn';
    } else if(active.case==='agent-cascade-stop' && body.tools?.length) {
      // Stopping a background parent must stop the grandchild it spawned; the
      // grandchild's reply is slow, so a survivor would deliver GRANDCHILD_DONE.
      const agentName=body.tools.find(t=>t.name==='Task'||t.name==='Agent')?.name||'Task';
      const all=JSON.stringify(body.messages);const first=textOf(body.messages[0]?.content);
      const has=id=>all.includes(`"tool_use_id":"${id}"`);
      const spawn=(id,prompt)=>({type:'tool_use',id,name:agentName,input:{prompt,description:'Cascade fixture',subagent_type:'general-purpose',run_in_background:true}});
      let step=null,text;
      if(first.includes('CASCADE_GRANDCHILD')){active.grandchildRequests=(active.grandchildRequests||0)+1;await delay(3000);text='GRANDCHILD_DONE';}
      else if(first.includes('CASCADE_PARENT'))step=has('cascade_g')?{type:'tool_use',id:'parent_busy',name:'Bash',input:{command:'sleep 8',description:'Stay busy'}}:spawn('cascade_g','CASCADE_GRANDCHILD');
      else if(!has('cascade_p'))step=spawn('cascade_p','CASCADE_PARENT');
      else if(!has('cascade_stop')){
        if(!active.grandchildRequests)step={type:'tool_use',id:'cascade_wait_'+active.requests.length,name:'Bash',input:{command:'sleep 0.3',description:'Wait for grandchild'}};
        else step={type:'tool_use',id:'cascade_stop',name:'TaskStop',input:{task_id:all.match(/agentId:\s*([a-zA-Z0-9_-]+)/)?.[1]}};
      } else if(!has('cascade_settle'))step={type:'tool_use',id:'cascade_settle',name:'Bash',input:{command:'sleep 4',description:'Outlast the grandchild'}};
      else text='AUDIT_OK';
      content=step?[step]:[{type:'text',text}];stop=step?'tool_use':'end_turn';
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
      const steps=[{name:'goal',input:{operation:'create_goal',objective:'Run the explicitly requested isolated child usage test and finish.',token_budget:100000}},{name:agentName,input:{prompt:'CHILD_USAGE_FIXTURE',description:'Read fixture',subagent_type:'general-purpose',run_in_background:false}},{name:'goal',input:{operation:'get_goal'}},{name:'goal',input:{operation:'update_goal',status:'complete'}}];
      const step=steps[n-1];content=step?[{type:'tool_use',id:'goal_'+n,...step}]:[{type:'text',text:'AUDIT_OK'}];stop=step?'tool_use':'end_turn';
    } else if(active.case==='small-window-overflow' && n<=2) {
      content=[{type:'tool_use',id:'small_output_'+n,name:'Bash',input:{command:n===1?'echo prior-round':"head -c 24000 /dev/zero | tr '\\0' x",description:'Generate bounded fixture output'}}];stop='tool_use';
    } else if (summary) {
      active.summaries++;
      assert.ok(JSON.stringify(body.messages).includes(sentinel), 'summary request lost original constraint');
      content = [{ type: 'text', text: `<summary>Original project constraint: ${sentinel}. Continue the active task; bulky pasted data is omitted.</summary>` }];
    } else if (active.case === 'large-output') {
      content = [{ type: 'text', text: 'Z'.repeat(180000) }];
    } else if (active.case === 'compact-resume' && active.phase === 'resume') {
      if (raw.length > 500_000) {
        active.oversized++;
        error(400, 'invalid_request_error', 'prompt is too long');
        return;
      }
      assert.ok(raw.includes(sentinel), 'postcompact request lost original constraint');
      content = [{ type: 'text', text: 'AUDIT_OK' }];
    } else if ((['malformed', 'tombstone-resume'].includes(active.case) && n === 1) || (active.case === 'alternating' && n <= 8 && n % 2 === 1)) {
      content = [{ type: 'text', text: 'Calling a tool now.' }]; stop = 'tool_use';
    } else if ((active.case === 'empty' && n === 1) || (active.case === 'alternating' && n <= 8 && n % 2 === 0)) {
      content = [];
    } else if (active.case.startsWith('tool-input-') && active.phase !== 'resume' && !body.messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result' && b.tool_use_id === 'write_original'))) {
      content = [{ type: 'thinking', thinking: 'Local input preservation fixture.', signature: 'synthetic-input-signature' }, { type: 'tool_use', id: 'write_original', name: 'Write', input: { file_path: join(active.dir, 'normalized.txt'), content: 'KEEP_TRAILING_SPACES  \n' } }]; stop = 'tool_use';
    } else if (active.case === 'truncated' && n === 1) {
      content = [{ type: 'text', text: 'PARTIAL_' }];
    } else if (active.case === 'stale-signature' && n === 1) {
      content = [{ type: 'thinking', thinking: 'plan', signature: 'sig' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: join(active.dir, 'fixture.txt') } }]; stop = 'tool_use';
    } else if (active.case === 'stale-signature' && n === 2) {
      error(400, 'invalid_request_error', 'messages.1.content.0: Invalid `signature` in `thinking` block');
      return;
    } else if (active.case === 'stale-signature' && n === 3) {
      content = [{ type: 'thinking', thinking: '', signature: 'fresh-sig' }, { type: 'tool_use', id: 'toolu_fresh', name: 'Read', input: { file_path: join(active.dir, 'fixture.txt') } }]; stop = 'tool_use';
    } else if ((active.case === 'refusal' && n === 1) || active.case === 'refusal-repeat') {
      content = [{ type: 'text', text: 'Partial answer.' }]; stop = 'refusal';
    } else if (active.case.startsWith('budget-')) {
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'printf started > started.txt; sleep 2; printf finished > finished.txt', timeout: 10000 } }]; stop = 'tool_use';
    } else if ((active.case === 'permission-deny' || active.case === 'deny-rule') && n === 1) {
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'printf denied > denied.txt' } }]; stop = 'tool_use';
    } else if (active.case === 'background-deadline' && n <= 2) {
      // Job control deliberately puts sleep in a different process group, so
      // killing only the parent shell's group cannot satisfy this fixture.
      // Then wait long enough for the limit to fire while the turn stays open.
      content = [{ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: n === 1
        ? { command: 'bash -c \'set -m; sleep 37.25 & { ps -o pgid= -p "$$"; ps -o pgid= -p "$(jobs -p)"; } > deadline-groups.txt; wait\'', run_in_background: true, timeout: 2000, description: 'Deadline fixture' }
        : { command: 'sleep 4', description: 'Wait past the deadline' } }]; stop = 'tool_use';
    } else if (active.case.startsWith('concurrency-') && n === 1) {
      content = [1, 2].map(i => ({ type: 'tool_use', id: 'write_' + i, name: 'Bash', input: { command: 'pwd' } })); stop = 'tool_use';
    } else if (active.case === 'max-turns' || ((active.case === 'read' || active.case.startsWith('openai-usage') || active.case.endsWith('-overflow') || active.case.startsWith('hook-')) && n === 1) || (active.case === 'compact-resume' && n <= 3) || (active.case === 'field-reject' && n === 2)) {
      content = [
        ...(active.case === 'compact-resume' ? [{ type: 'text', text: 'prior-context '.repeat(5000) }] : []),
        { type: 'tool_use', id: `toolu_${n}`, name: 'Read', input: { file_path: join(active.dir, 'fixture.txt') } },
      ]; stop = 'tool_use';
    } else {
      content = [{ type: 'text', text: 'AUDIT_OK' }];
    }
    const msg = { id: `msg_${active.requests.length}`, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: child ? {input_tokens:1,output_tokens:1,cache_read_input_tokens:5000,cache_creation_input_tokens:4000} : harness ? {input_tokens:1,output_tokens:1} : {input_tokens:100,output_tokens:10} };
    if (openai) {
      if (active.case === 'openai-usage-nonstream' && body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ error: { message: 'Scripted non-streaming fallback' } })}\n\n`);
        return;
      }
      const text = textOf(content) || null;
      const toolCalls = content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      const finish = toolCalls.length ? 'tool_calls' : 'stop';
      const usage = { prompt_tokens: msg.usage.input_tokens, completion_tokens: msg.usage.output_tokens, total_tokens: msg.usage.input_tokens + msg.usage.output_tokens, ...(active.case.startsWith('openai-usage') && { prompt_tokens_details: { cached_tokens: 60 } }) };
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: msg.id, object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: text, ...(toolCalls.length && { tool_calls: toolCalls }) }, finish_reason: finish }], usage }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish_reason = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: msg.id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`);
      chunk({ role: 'assistant', content: text, ...(toolCalls.length && { tool_calls: toolCalls.map((tc, index) => ({ index, ...tc })) }) });
      chunk({}, finish, { usage });
      res.end('data: [DONE]\n\n');
      return;
    }
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
    ...(scenario==='blocking-limit' && {DISABLE_AUTO_COMPACT:'1'}),
    CLAUDE_CONFIG_DIR: join(active.dir, 'config'), ANTHROPIC_API_KEY: 'local-e2e-dummy', ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: model, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    ...(scenario.startsWith('openai-') && { CLAUDE_CODE_USE_OPENAI: '1', OPENAI_BASE_URL: `${baseUrl}/v1`, OPENAI_API_KEY: 'local-e2e-dummy' }),
    CLAUDE_CODE_TASK_LIST_ID: 'harness-probe', NOA_CLAUDE_STREAMING_TOOL_EXECUTION: ['budget-nonstream', 'concurrency-nonstream'].includes(scenario) ? '0' : '1', FALLBACK_FOR_ALL_PRIMARY_MODELS: '1', CLAUDE_CODE_EAGER_FLUSH: '1',
  });
  const streamingInput = scenario.startsWith('budget-');
  const harness = scenario.startsWith('task-') || scenario === 'goal-child-usage' || scenario==='agent-custom-fork' || scenario==='agent-nested' || scenario.startsWith('agent-owned-') || scenario==='agent-cascade-stop' || scenario.startsWith('agent-schema');
  // Hooks are off under --bare, so the hook scenario runs the full startup path.
  // --bare drops run_in_background, so the deadline scenario needs the full startup path too.
  const command = [...(scenario.startsWith('hook-') || scenario.startsWith('concurrency-') || scenario.startsWith('tool-input-') || scenario === 'background-deadline' || harness ? [] : ['--bare']), '--print', '--verbose', '--output-format', 'stream-json', '--model', model, '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', harness ? (scenario==='agent-custom-fork'?'Read,Bash,Task,SendMessage':scenario==='goal-child-usage'?'Read,Task,goal':scenario==='agent-nested'||scenario.startsWith('agent-owned-')||scenario.startsWith('agent-schema')?'Task':scenario==='agent-cascade-stop'?'Task,Bash,TaskStop':'TaskCreate,TaskUpdate,TaskGet,TaskList') : scenario.startsWith('tool-input-') ? 'Read,Bash,Write' : 'Read,Bash', '--max-turns', harness ? '8' : scenario === 'compact-resume' ? '6' : scenario === 'stale-signature' ? '3' : scenario === 'background-deadline' || scenario === 'small-window-overflow' ? '4' : '2'];
  if (!scenario.startsWith('tool-input-') && scenario !== 'compact-resume' && scenario !== 'tombstone-resume' && scenario !== 'stale-signature' && scenario!=='agent-custom-fork') command.push('--no-session-persistence');
  if (scenario.startsWith('tool-input-')) command.push('--allowedTools', 'Write');
  if (scenario === 'fallback') command.push('--fallback-model', 'claude-haiku-4-5');
  // An allow rule that the narrower deny rule must still beat.
  if (scenario === 'deny-rule') command.push('--allowedTools', 'Bash', '--disallowedTools', 'Bash(printf:*)');
  if (scenario === 'background-deadline' || scenario === 'small-window-overflow') command.push('--allowedTools', 'Bash');
  if (scenario === 'agent-cascade-stop') command.push('--allowedTools', 'Bash,TaskStop');
  if (scenario === 'agent-owned-auto') command[command.indexOf('dontAsk')] = 'auto';
  if (scenario==='hook-output' || scenario==='hook-output-null') command.push('--settings',JSON.stringify({hooks:{PostToolUse:[{matcher:'Read',hooks:[{type:'command',command:`echo '${JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',updatedToolOutput:scenario==='hook-output-null'?null:'HOOK_REDACTED',updatedMCPToolOutput:'LEGACY_MUST_NOT_WIN'}})}'`}]}]}}));
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
          writeFileSync(join(dir, 'resume-input.txt'), 'Continue the prior task. Bulky input follows:\n' + 'x'.repeat(350000));
          runResult = await run(executable, scenario, ['--resume', seed.result.session_id], readFileSync(join(dir, 'resume-input.txt'), 'utf8'));
          assert.equal(runResult.code, 0);
          assert.equal(runResult.result.result, 'AUDIT_OK');
          assert.ok(active.summaries > 0, 'compaction never executed');
          assert.equal(active.oversized, 1, 'only the pre-compaction request may overflow; an oversized tail reached the endpoint after compaction');
        } else {
          runResult = await run(executable, scenario, [], scenario==='blocking-limit'?'x'.repeat(5_000_000):scenario==='goal-child-usage'?'Create a temporary goal, run a child agent, report its usage and finish.':scenario.endsWith('-overflow')?`PROJECT_CONSTRAINT: ${sentinel}. Run the local loop fixture.`:'Run the local loop fixture.');
          const count = active.requests.length;
          // Without --bare the CLI also makes side requests; the loop's own carry the tool list.
          const main = active.requests.filter(r => r.body.tools?.length);
          if(scenario==='hook-output' || scenario==='hook-output-null') {
            assert.equal(runResult.code,0);const followUp=JSON.stringify(main[1]?.body.messages);assert.ok(followUp.includes(scenario==='hook-output-null'?'null':'HOOK_REDACTED'));assert.ok(!followUp.includes('LOCAL_FIXTURE_42'));assert.ok(!followUp.includes('LEGACY_MUST_NOT_WIN'));
          } else if(scenario==='blocking-limit' || scenario==='image-error') {
            assert.equal(runResult.code,1);assert.equal(runResult.result.is_error,true);assert.equal(runResult.result.terminal_reason,scenario==='blocking-limit'?'blocking_limit':'image_error');assert.equal(count,scenario==='blocking-limit'?0:1);
          } else if(scenario==='agent-nested'){
            assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK');
            const promptReached=marker=>main.some(r=>(r.body.messages||[]).some(m=>m.role==='user'&&textOf(m.content).includes(marker)));
            assert.ok(promptReached('NEST_DEPTH_1'),'depth-1 subagent never started');
            assert.ok(promptReached('NEST_DEPTH_2'),'depth-2 subagent never started');
            assert.ok(!promptReached('NEST_DEPTH_3'),'depth-3 subagent started despite the spawn-depth cap');
            assert.ok(main.some(r=>JSON.stringify(r.body.messages).includes('nesting limit reached (depth 3 of 2)')),'refusal was not returned to the depth-2 subagent');
          } else if(scenario==='agent-schema'){
            assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK','structured output never reached the main thread');
            const childReqs=active.requests.filter(r=>textOf(r.body.messages?.[0]?.content).includes('SCHEMA_CHILD_FIXTURE'));
            assert.ok(childReqs.some(r=>r.body.tools?.some(t=>t.name==='StructuredOutput')),'child pool missing the StructuredOutput tool');
            assert.ok(childReqs.some(r=>JSON.stringify(r.body.messages).includes('You MUST call the StructuredOutput tool')),'SubagentStop enforcement hook never nudged the child');
            assert.ok(childReqs.some(r=>JSON.stringify(r.body.messages).includes('Output does not match required schema')),'invalid StructuredOutput call was not rejected by schema validation');
            const mainResult=main.flatMap(r=>r.body.messages||[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find(b=>b.type==='tool_result'&&b.tool_use_id==='schema_p');
            assert.ok(JSON.stringify(mainResult).includes('SCHEMA_ANSWER_42'),'agent result missing the structured output payload');
            assert.ok(!JSON.stringify(mainResult).includes('"answer": 42'),'a failed StructuredOutput call leaked into the result');
          } else if(scenario==='agent-schema-bg'){
            assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK','background structured output never reached the main thread');
            assert.ok(main.some(r=>{const s=JSON.stringify(r.body.messages);return s.includes('task-notification')&&s.includes('SCHEMA_ANSWER_42')}),'completion notification missing the structured output');
          } else if(scenario==='agent-cascade-stop'){
            assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK');
            assert.equal(active.grandchildRequests,1,'grandchild kept running after its parent was stopped');
            assert.ok(!main.some(r=>JSON.stringify(r.body.messages).includes('GRANDCHILD_DONE')),'stopped grandchild still delivered a result');
          } else if(scenario==='agent-owned-results' || scenario==='agent-owned-auto'){
            assert.equal(runResult.code,0);assert.equal(runResult.result.result,'AUDIT_OK','parent did not report its child result');
            const mainThread=main.filter(r=>!/OWNED_(PARENT|GRANDCHILD)/.test(textOf(r.body.messages[0]?.content)));
            assert.ok(!mainThread.some(r=>JSON.stringify(r.body.messages).includes('GRANDCHILD_RESULT_42')),'grandchild result leaked to the main thread');
          } else if(scenario==='agent-custom-fork'){
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
          } else if (scenario.endsWith('-overflow')) {
            assert.equal(runResult.code, 0, `overflow surfaced as: ${runResult.result.result}`); assert.equal(runResult.result.result, 'AUDIT_OK');
            if (scenario === 'openai-overflow') assert.ok(active.requests.every(r => r.path.includes('/chat/completions')), 'request left the OpenAI-compatible transport');
            assert.equal(active.summaries, 1, 'context overflow did not trigger reactive compact');
            assert.equal(count, scenario==='small-window-overflow'?5:4);
            assert.ok(JSON.stringify(active.requests.at(-1).body.messages).includes(sentinel), 'retry after compaction lost the original constraint');
          } else if (scenario.startsWith('openai-usage')) {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            const completed = active.requests.filter(r => scenario !== 'openai-usage-nonstream' || !r.body.stream);
            assert.equal(completed.length, 2);
            assert.ok(active.requests.every(r => r.path.includes('/chat/completions')));
            assert.ok(JSON.stringify(completed[1].body.messages).includes('LOCAL_FIXTURE_42'));
            const usage = runResult.result.modelUsage[model];
            assert.equal(usage.inputTokens, 80, 'cached input was lost or subtracted twice');
            assert.equal(usage.cacheReadInputTokens, 120);
            assert.equal(usage.outputTokens, 20);
            assert.equal(usage.inputTokens + usage.cacheReadInputTokens, 200, 'prompt tokens were double-counted');
            assert.ok(Math.abs(runResult.result.total_cost_usd - (80 * 3 + 120 * 0.3 + 20 * 15) / 1_000_000) < 1e-10);
            if (scenario === 'openai-usage') {
              assert.equal(runResult.result.usage.input_tokens, 80);
              assert.equal(runResult.result.usage.cache_read_input_tokens, 120);
              assert.equal(runResult.result.usage.output_tokens, 20);
            } else {
              const events = readFileSync(join(dir, 'run-stdout.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
              const responses = events.filter(e => e.type === 'assistant').map(e => e.message.usage);
              assert.equal(responses.length, 2);
              assert.ok(responses.every(u => u.input_tokens === 40 && u.cache_read_input_tokens === 60 && u.output_tokens === 10));
            }
          } else if (scenario === 'field-reject') {
            assert.equal(runResult.code, 0, `field rejection surfaced as: ${runResult.result.result}`); assert.equal(runResult.result.result, 'AUDIT_OK'); assert.equal(count, 3);
            assert.ok(active.requests.slice(1).every(r => !('metadata' in r.body)), 'the rejected field was sent again on a later turn');
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
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK'); assert.equal(count, 4);
            assert.ok(JSON.stringify(active.requests[1].body.messages).includes('"thinking"'), 'fixture never replayed a thinking block');
            assert.ok(!JSON.stringify(active.requests[2].body.messages).includes('"thinking"'), 'retry still sent the rejected thinking block');
            const fresh = active.requests[3].body.messages.flatMap(m => m.content).filter(b => b.type === 'thinking');
            assert.deepEqual(fresh, [{ type: 'thinking', thinking: '', signature: 'fresh-sig' }], 'recovery stripped newly generated thinking');
            const projects = join(dir, 'config', 'projects');
            const transcripts = readdirSync(projects, { recursive: true }).filter(path => path.endsWith(`${runResult.result.session_id}.jsonl`));
            assert.equal(transcripts.length, 1, 'session transcript missing');
            const transcript = readFileSync(join(projects, transcripts[0]), 'utf8');
            const recovery = transcript.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(m => m.subtype === 'thinking_signature_recovery');
            assert.ok(recovery?.signatureStripMessageUuids?.length, 'recovery boundary was not persisted');
            writeFileSync(join(dir, 'recovery-record.json'), JSON.stringify(recovery, null, 2));
            // Resume strips every signature (conversationRecovery), so this checks the
            // persisted marker loads cleanly, not that it drives later stripping.
            active.phase = 'resume';
            const resumed = await run(executable, scenario, ['--resume', runResult.result.session_id], 'Continue after signature recovery.');
            assert.equal(resumed.code, 0); assert.equal(resumed.result.result, 'AUDIT_OK');
          } else if (scenario.startsWith('tool-input-')) {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            assert.equal(readFileSync(join(dir, 'normalized.txt'), 'utf8'), 'KEEP_TRAILING_SPACES\n', 'Write execution lost its existing whitespace normalization');
            const expected = { file_path: join(dir, 'normalized.txt'), content: 'KEEP_TRAILING_SPACES  \n' };
            const assertReplay = (request, expectThinking = true) => {
              const blocks = request.body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []);
              const use = blocks.find(b => b.type === 'tool_use' && b.id === 'write_original');
              assert.deepEqual(use?.input, expected, 'API replay changed the original SDK tool input');
              assert.equal('originalInput' in use, false, 'local metadata leaked to the API');
              if (expectThinking) assert.deepEqual(blocks.filter(b => b.type === 'thinking'), [{ type: 'thinking', thinking: 'Local input preservation fixture.', signature: 'synthetic-input-signature' }]);
              assert.ok(blocks.some(b => b.type === 'tool_result' && b.tool_use_id === 'write_original' && !b.is_error), 'Write did not execute successfully');
            };
            const completed = main.filter(r => scenario !== 'tool-input-nonstream' || !r.body.stream);
            assert.equal(completed.length, 2);
            assert.ok(completed.every(r => !!r.body.stream === (scenario === 'tool-input-streaming')), 'wrong response transport exercised');
            assertReplay(completed[1]);
            assert.ok(!readFileSync(join(dir, 'run-stdout.jsonl'), 'utf8').includes('originalInput'), 'local metadata leaked to SDK output');
            active.phase = 'resume';
            const resumed = await run(executable, scenario, ['--resume', runResult.result.session_id], 'Continue after original input fixture.');
            assert.equal(resumed.code, 0); assert.equal(resumed.result.result, 'AUDIT_OK');
            assertReplay(active.requests.at(-1), false);
          } else if (scenario === 'background-deadline') {
            assert.equal(runResult.code, 0); assert.equal(runResult.result.result, 'AUDIT_OK');
            const bash = main[0].body.tools.find(t => t.name === 'Bash');
            assert.ok(bash.input_schema.properties.run_in_background.description.includes('limits how long the command may run in the background'), 'schema does not state the background limit');
            // The limit fires during the foreground wait, so the notification
            // must arrive with that tool result, inside the same turn.
            const sameTurn = JSON.stringify(main[2].body.messages.slice(-1));
            assert.ok(sameTurn.includes('was stopped after reaching its background time limit'), 'limit notification did not arrive within the turn');
            assert.ok(sameTurn.includes('<note>If the work in progress still needs it'), 'notification lacks the next-step note');
            const groups = readFileSync(join(dir, 'deadline-groups.txt'), 'utf8').trim().split(/\s+/);
            assert.equal(groups.length, 2, 'fixture did not record both process groups');
            assert.notEqual(groups[0], groups[1], 'fixture did not put the child in a separate process group');
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
    transport: 'deterministic localhost Anthropic SSE (OpenAI-compatible chat completions for openai-*); no actual model-quality benchmark',
    entry, entry_sha256: shaOf(entry), comparison: compare ? { entry: resolve(compare), sha256: shaOf(resolve(compare)) } : undefined,
    script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    results_sha256: shaOf(join(artifacts, 'results.json')),
    passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => r.required && !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => r.required && !r.passed) ? 1 : 0;
