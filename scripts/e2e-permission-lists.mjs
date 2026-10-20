#!/usr/bin/env bun
// Real CLI + local Messages API fixture + tmux; writes screens and a hashed manifest.
// bun run build:dev && bun scripts/e2e-permission-lists.mjs [--entry bin/noa.js]
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dir, '..');
const entryFlag=process.argv.indexOf('--entry');
const entry=entryFlag < 0 ? join(root,'dist/main-dev.js') : resolve(process.argv[entryFlag+1]);
const skillsOnly=process.argv.includes('--skills-only');
const upstream=process.argv.includes('--upstream');
const projectDirName=upstream?'.claude':'.noa';
const dir=join(tmpdir(),`noa-align-e2e-${process.pid}`);mkdirSync(dir,{recursive:true});const cwd=dir+'/workspace';const config=dir+'/config';mkdirSync(cwd);mkdirSync(config);mkdirSync(dir+'/home');
for(let i=1;i<=24;i++) {
 const name=`e2e-skill-${String(i).padStart(2,'0')}`;
 const skillDir=join(cwd,projectDirName,'skills',name);mkdirSync(skillDir,{recursive:true});
 writeFileSync(join(skillDir,'SKILL.md'),`---\nname: ${name}\ndescription: Terminal verification fixture ${i}\n---\nUse only for this verification.\n`);
}
for(const [base,name,description,frontmatter] of [
 [join(cwd,projectDirName),'zz-heavy-project','Long description '.repeat(80),''],
 [config,'a-user','User fixture',''],
 [config,'locked-author','Author fixture','disable-model-invocation: true\n'],
 [config,'model-only-author','Model fixture','user-invocable: false\n'],
]) {
 const skillDir=join(base,'skills',name);mkdirSync(skillDir,{recursive:true});
 writeFileSync(join(skillDir,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n${frontmatter}---\nDo nothing until invoked.\n`);
}
const mcpFile=join(dir,'mcp-fixture.mjs');
const mcpValuesFile=join(dir,'mcp-values.json');
writeFileSync(mcpFile, `import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
let callId;
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize') send({id:m.id,result:{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}});
 else if(m.method==='tools/list') send({id:m.id,result:{tools:[{name:'form',description:'Verification form',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}}]}});
 else if(m.method==='tools/call') {
  callId=m.id;
  send({id:'form-input',method:'elicitation/create',params:{message:'Verify field navigation',requestedSchema:{type:'object',properties:Object.fromEntries(Array.from({length:10},(_,i)=>['field'+i,{type:'string',title:'Field '+i,default:i===0?'Alice':i===9?'Bob':'middle'}]))}}});
 } else if(m.id==='form-input') {
  writeFileSync(process.argv[2],JSON.stringify(m.result));
  send({id:callId,result:{content:[{type:'text',text:'Form received'}]}});
 } else if(m.id!==undefined) send({id:m.id,result:{}});
});`);
const mcpConfig=join(dir,'mcp.json');
writeFileSync(mcpConfig,JSON.stringify({mcpServers:{fixture:{command:process.execPath,args:[mcpFile,mcpValuesFile]}}}));
const socket=`noa-align-${process.pid}`;const steps=[];const requests=[];const seenPrompts=new Set();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tmux=(...args)=>execFileSync('tmux',['-L',socket,...args],{encoding:'utf8'});
const screen=(ansi=false)=>tmux('capture-pane',...(ansi?['-e']:[]),'-p','-t','ui');
const keys=(...args)=>tmux('send-keys','-t','ui',...args);
const type=s=>keys('-l',s);
const sgr=(code,x,y,up=false)=>keys('-H',...Buffer.from(`\x1b[<${code};${x};${y}${up?'m':'M'}`).toString('hex').match(/../g));
const click=(x,y)=>{sgr(0,x,y);sgr(0,x,y,true)};
function save(name){const s=screen();steps.push({name,screen:s});writeFileSync(`${dir}/${name}.txt`,s);writeFileSync(`${dir}/${name}.ansi`,screen(true));return s;}
async function wait(name,predicate,ms=15000){const until=Date.now()+ms;while(Date.now()<until){const s=screen();if(predicate(s))return save(name);await sleep(100)}throw Error(`Timeout ${name}\n${screen()}`)}
function assert(value,msg){if(!value)throw Error(msg)}
const server=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;let body={};try{body=JSON.parse(text)}catch{};
 if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":100}');return}
 const last=body.messages?.at(-1);requests.push({path:req.url,stream:body.stream,lastRole:last?.role,results:last?.content?.filter?.(b=>b.type==='tool_result').length??0});
 let toolResults=last?.content?.some?.(c=>c.type==='tool_result');
 const promptText=typeof last?.content==='string'?last.content:last?.content?.filter?.(c=>c.type==='text').map(c=>c.text).join(' ')??'';
 if(promptText && !seenPrompts.has(promptText)){seenPrompts.add(promptText);toolResults=false}
 const content=promptText.includes('mcp form')&&!toolResults?[{type:'tool_use',id:`tool_${requests.length}_form`,name:'mcp__fixture__form',input:{}}]:toolResults?[{type:'text',text:'Verification batch complete.'}]:Array.from({length:promptText.includes('single permission')||promptText.includes('hook interrupt')?1:5},(_,i)=>({type:'tool_use',id:`tool_${requests.length}_${i}`,name:'Bash',input:{command:'pwd',description:`Approval ${i+1}`}}));
 const msg={id:`msg_${requests.length}`,type:'message',role:'assistant',model:body.model,content,stop_reason:toolResults?'end_turn':'tool_use',stop_sequence:null,usage:{input_tokens:100,output_tokens:30}};
 if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(msg));return}
 res.writeHead(200,{'content-type':'text/event-stream'});const emit=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
 emit('message_start',{type:'message_start',message:{...msg,content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0}}});
 content.forEach((c,index)=>{emit('content_block_start',{type:'content_block_start',index,content_block:c.type==='text'?{type:'text',text:''}:{...c,input:{}}});emit('content_block_delta',{type:'content_block_delta',index,delta:c.type==='text'?{type:'text_delta',text:c.text}:{type:'input_json_delta',partial_json:JSON.stringify(c.input)}});emit('content_block_stop',{type:'content_block_stop',index})});
 emit('message_delta',{type:'message_delta',delta:{stop_reason:msg.stop_reason,stop_sequence:null},usage:{output_tokens:30}});emit('message_stop',{type:'message_stop'});res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const globalConfig=JSON.stringify({theme:'dark-ansi',hasCompletedOnboarding:true,lastOnboardingVersion:'99.0.0',customApiKeyResponses:{approved:['sk-noa-e2e'],rejected:[]},projects:{[realpathSync(cwd)]:{hasTrustDialogAccepted:true,allowedTools:[],mcpContextUris:[]}}});
writeFileSync(config+'/.config.json',globalConfig);writeFileSync(config+'/.claude.json',globalConfig);
writeFileSync(config+'/settings.json',JSON.stringify({permissions:{ask:['Bash']},autoUpdatesChannel:'latest'}));
const env={PATH:process.env.PATH,HOME:dir+'/home',TERM:'xterm-256color',CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_PRODUCT_DIR:config,ANTHROPIC_API_KEY:'sk-noa-e2e',ANTHROPIC_BASE_URL:`http://127.0.0.1:${port}`,NOA_CLAUDE_NO_FLICKER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',NOA_CLAUDE_NO_THINKING:'1'};
const quote=s=>`'${s.replaceAll("'","'\\''")}'`;
let exit=0;
try{
 const invocation=entry.endsWith('.js')?`bun ${quote(entry)}`:quote(entry);
 const cliArgs=skillsOnly?'--strict-mcp-config --permission-mode default --model claude-sonnet-4-5':`--bare --add-dir ${quote(cwd)} --mcp-config ${quote(mcpConfig)} --allowedTools mcp__fixture__form --permission-mode default --model claude-sonnet-4-5`;
 const cmd='env -i '+Object.entries(env).map(([k,v])=>`${k}=${quote(v)}`).join(' ')+` ${invocation} ${cliArgs}`;
 tmux('new-session','-d','-s','ui','-x','100','-y','30','-c',cwd,cmd);
 await wait('startup',s=>s.includes('manual mode on')||s.includes('shift+tab to cycle'));await sleep(800);
 let s,line,x,y;
 if(!skillsOnly) {
 type('/config');await sleep(300);save('settings-input');keys('Enter');await wait('settings-top',s=>/↓ \d+ more/.test(s));
 s=screen();line=s.split('\n').findIndex(l=>/↓ \d+ more/.test(l));x=s.split('\n')[line].indexOf('↓')+1;y=line+1;
 sgr(35,x,y);await sleep(100);save('settings-hover');assert(/\x1b\[7m↓/.test(screen(true)),'hover inverse missing');
 click(x,y);await sleep(60);save('settings-pressed');assert(/\x1b\[7m ↓ \d+ more/.test(screen(true)),'pressed state missing');await wait('settings-bottom',s=>/↑ \d+ more/.test(s)&&!/↓ \d+ more/.test(s));
 s=screen();line=s.split('\n').findIndex(l=>/↑ \d+ more/.test(l));x=s.split('\n')[line].indexOf('↑')+1;y=line+1;
 click(x,y);await wait('settings-return-top',s=>s.includes('Auto-compact')&&!/↑ \d+ more/.test(s));
 click(50,y);await sleep(100);save('settings-stray-click');assert(/Auto-compact +true/.test(screen()),'jump follow-up click toggled a setting');
 await sleep(1100);click(50,y);await wait('settings-normal-click',s=>/Auto-compact +false/.test(s));
 await sleep(600);click(50,y);await wait('settings-restored',s=>/Auto-compact +true/.test(s));
 keys('Escape');await sleep(200);keys('Escape');await sleep(200);keys('Escape');await sleep(200);
 }
 // --bare (the default run) loads only --add-dir skills, never the user fixtures
 // this block asserts on; run it with --skills-only.
 if(skillsOnly) {
 type('/skills');await sleep(200);keys('Enter');await wait('skills-top',s=>s.includes('e2e-skill-01')&&s.includes('Search skills'));
 assert(!/^\s*Project\s+User\s*$/m.test(screen()),'skills still split sources into Project/User tabs');
 assert(screen().includes('enter/space to cycle'),'skills still invoke on Enter');
 assert(/↓ \d+ more/.test(screen()),'skills overflow control is not visible');
 s=screen();line=s.split('\n').findIndex(l=>/↓ \d+ more/.test(l));x=s.split('\n')[line].indexOf('↓')+1;y=line+1;
 if(upstream)keys(...Array(27).fill('Down'));else click(x,y);await wait('skills-bottom',s=>s.includes('e2e-skill-24')&&s.includes('a-user')&&/↑ \d+ more/.test(s)&&!/↓ \d+ more/.test(s));
 s=screen();line=s.split('\n').findIndex(l=>/↑ \d+ more/.test(l));x=s.split('\n')[line].indexOf('↑')+1;y=line+1;
 if(upstream)keys(...Array(27).fill('Up'));else click(x,y);await wait('skills-return-top',s=>s.includes('e2e-skill-01')&&!/↑ \d+ more/.test(s));
 tmux('resize-window','-t','ui','-x','120','-y','46');
 await wait('skills-all-sources',s=>s.includes('a-user')&&s.includes('locked-author')&&s.includes('e2e-skill-01'));
 const row=name=>screen().split('\n').find(l=>l.includes(name)&&/[✔◯○✓]/.test(l))??'';
 assert(row('e2e-skill-01').indexOf('project ·')===row('a-user').indexOf('user ·'),'skill detail columns are not aligned');
 assert(row('locked-author').includes('locked by author'),'author lock missing');
 assert(/✔|✓/.test(row('model-only-author')),'model-only skill incorrectly shown as off');
 keys('t');await wait('skills-token-sort',s=>s.includes('sorted by tokens')&&/❯.*zz-heavy-project/.test(s));
 keys('t');await wait('skills-source-sort',s=>/❯.*e2e-skill-01/.test(s)&&!s.includes('sorted by tokens'));
 keys('Enter');await wait('skills-name-only',()=>row('e2e-skill-01').includes('name-only'));
 keys('Space');await wait('skills-user-only',()=>row('e2e-skill-01').includes('user-only'));
 keys('Enter');await wait('skills-off',()=>/◯|○/.test(row('e2e-skill-01')));
 keys('Space');await wait('skills-on',()=>/✔|✓/.test(row('e2e-skill-01'))&&!/name-only|user-only/.test(row('e2e-skill-01')));
 keys('Enter');await wait('skills-pending-mode',()=>row('e2e-skill-01').includes('name-only'));
 keys('/');type('locked-author');await wait('skills-filter',s=>s.includes('1/28 skills')&&s.includes('type to filter'));
 keys('Enter');await wait('skills-search-select',s=>s.includes('enter/space to cycle')&&row('locked-author').includes('user-only'));
 keys('Enter');keys('Space');await sleep(200);save('skills-author-locked');
 assert(row('locked-author').includes('locked by author')&&row('locked-author').includes('user-only'),'author restriction was changed');
 keys('/');keys('Escape');await wait('skills-search-clear',s=>s.includes('Search skills')&&s.includes('type to filter'));
 keys('Escape');await wait('skills-search-exit',s=>s.includes('enter/space to cycle')&&s.includes('a-user'));
 type('i');await wait('skills-type-search',s=>/⌕ i\s/.test(s)&&s.includes('type to filter'));
 keys('Escape');keys('Escape');await wait('skills-browse-again',s=>s.includes('enter/space to cycle'));
 tmux('resize-window','-t','ui','-x','70','-y','46');await wait('skills-medium',()=>row('locked-author').includes('user-only'));
 assert(!row('locked-author').includes('tok')&&!row('locked-author').includes('…')&&row('a-user').includes('tok'),'narrow details are cut mid-item instead of dropping trailing items');
 tmux('resize-window','-t','ui','-x','40','-y','22');await wait('skills-narrow',s=>s.includes('Search skills')&&s.includes('e2e-skill'));
 tmux('resize-window','-t','ui','-x','100','-y','30');await wait('skills-restored',s=>s.includes('enter/space to cycle'));
 keys('Escape');await wait('skills-saved',s=>s.includes('Updated 1 skill override')&&!s.includes('Search skills'));
 const modes=()=>JSON.parse(readFileSync(join(cwd,projectDirName,'settings.local.json'),'utf8'))[upstream?'skillOverrides':'skillModes']??{};
 assert(modes()['e2e-skill-01']==='name-only'&&modes()['locked-author']===undefined,'skill changes were not persisted correctly');
 type('/skills');await sleep(200);keys('Enter');await wait('skills-reopened',()=>row('e2e-skill-01').includes('name-only'));
 keys('Enter');await wait('skills-reopen-user-only',()=>row('e2e-skill-01').includes('user-only'));
 keys('Space');await wait('skills-reopen-off',()=>/◯|○/.test(row('e2e-skill-01')));
 keys('Enter');await wait('skills-revert',()=>/✔|✓/.test(row('e2e-skill-01'))&&!/name-only|user-only/.test(row('e2e-skill-01')));
 keys('Escape');await wait('skills-revert-saved',s=>!s.includes('Search skills')&&s.includes('Updated 1 skill override'));
 assert(modes()['e2e-skill-01']===undefined,'reverting left an unnecessary override');
 }
 if(!skillsOnly) {
 type('test permission batch');await sleep(200);keys('Enter');await wait('permission-1',s=>s.includes('1 of 5'));
 tmux('resize-window','-t','ui','-x','18');await wait('permission-narrow',s=>s.includes('Bash')&&!s.includes('of 5'));
 tmux('resize-window','-t','ui','-x','100');await wait('permission-wide',s=>s.includes('1 of 5'));
 keys('Enter');await wait('permission-2',s=>s.includes('2 of 5'));
 for(let i=2;i<5;i++){keys('Enter');await wait(`permission-${i+1}`,s=>s.includes(`${i+1} of 5`))}
 keys('Enter');await wait('batch-complete',s=>s.includes('Verification batch complete.')&&!s.includes('of 5'));
 type('test reset');await sleep(200);keys('Enter');await wait('reset-1',s=>s.includes('1 of 5'));
 keys('Escape');await sleep(300);save('cancelled');assert(!screen().includes('of 5'),'cancel did not clear counter');
 type('single permission');await sleep(200);keys('Enter');await wait('single-permission',s=>s.includes('Do you want to proceed?'));assert(!/\d+ of \d+/.test(screen()),'single request should hide counter');
 keys('Enter');await wait('single-complete',s=>s.includes('Verification batch complete.')&&!s.includes('Do you want to proceed?'));
 type('mcp form');await sleep(200);keys('Enter');await wait('mcp-first-field',s=>s.includes('Alice')&&/↓ \d+ more/.test(s));
 s=screen();line=s.split('\n').findIndex(l=>/↓ \d+ more/.test(l));x=s.split('\n')[line].indexOf('↓')+1;y=line+1;
 click(x,y);await wait('mcp-last-field',s=>s.includes('Field 9')&&s.includes('Bob')&&/↑ \d+ more/.test(s));
 type('X');await wait('mcp-edited-last-field',s=>s.includes('BobX'));
 keys('Down');await sleep(200);keys('Enter');
 await wait('mcp-complete',s=>s.includes('Verification batch complete.')&&!s.includes('Verify field navigation'));
 const values=JSON.parse(readFileSync(mcpValuesFile,'utf8'));steps.push({name:'mcp-values',values});
 assert(values.action==='accept'&&values.content.field0==='Alice'&&values.content.field9==='BobX','MCP jump changed the wrong field');
 type('/exit');await sleep(100);keys('Enter');await sleep(500);
 const hookFile=join(dir,'deny-hook.mjs');
 writeFileSync(hookFile,`console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'deny',message:'blocked by parity hook',interrupt:true}}}));`);
 writeFileSync(config+'/settings.json',JSON.stringify({permissions:{ask:['Bash']},hooks:{PermissionRequest:[{matcher:'Bash',hooks:[{type:'command',command:`${quote(process.execPath)} ${quote(hookFile)}`}]}]}}));
 const hookDebug=join(dir,'hook-debug.log');
 const hookCmd='env '+Object.entries(env).map(([k,v])=>`${k}=${quote(v)}`).join(' ')+` bun ${quote(entry)} --debug-file ${quote(hookDebug)} --permission-mode default --model claude-sonnet-4-5`;
 tmux('new-session','-d','-s','ui','-x','100','-y','30','-c',cwd,hookCmd);
 await wait('hook-startup',s=>s.includes('manual mode on'));await sleep(800);
 type('hook interrupt');await sleep(200);keys('Enter');
 await wait('hook-finished',s=>s.includes('Ran 1 bash command')&&!s.includes('Do you want to proceed?'));
 const hookLog=readFileSync(hookDebug,'utf8');assert(hookLog.includes('Hook interrupt: tool=Bash hookMessage=blocked by parity hook'),'interrupt hook did not run');
 steps.push({name:'hook-interrupt',debugFile:hookDebug});
 assert(!screen().includes('non-interactive'),'hook deny was converted to generic cancellation');
 type('/exit');await sleep(100);keys('Enter');await sleep(500);
 }
}catch(e){exit=1;steps.push({error:String(e),screen:screen()});console.error(String(e));}
finally{try{execFileSync('tmux',['-L',socket,'kill-server'],{stdio:'ignore'})}catch{}server.close();const bundleFile=entry===join(root,'bin','noa.js')?join(root,'dist','main.js'):entry;const bundle=readFileSync(bundleFile);const artifact={command:['bun',...process.argv.slice(1)].join(' '),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()+(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()?'-dirty':''),entry,bundleFile,bundleSha256:createHash('sha256').update(bundle).digest('hex'),inputs:{env,args:`--bare --add-dir ${cwd} --mcp-config ${mcpConfig} --allowedTools mcp__fixture__form --permission-mode default --model claude-sonnet-4-5`,terminal:{columns:100,rows:30}},requests,steps,exit};writeFileSync(dir+'/manifest.json',JSON.stringify(artifact,null,2));console.log(JSON.stringify({artifact:dir+'/manifest.json',exit,steps:steps.map(s=>s.name??s.error)}));}
process.exit(exit);
