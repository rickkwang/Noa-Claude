// Compiled CLI + real tmux/PTY: permission dialog, durable literal replies, Fleet peek and draft send.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,existsSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');const option=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined;
const entry=resolve(option('--entry')||join(repo,'dist/cli'));const caseName=option('--case')||'all';const root=resolve(option('--artifacts')||mkdtempSync(join(tmpdir(),'noa-bg-e2e-')));mkdirSync(root,{recursive:true});
const config=join(root,'config');mkdirSync(config,{recursive:true});writeFileSync(config+'/.config.json',JSON.stringify({theme:'dark',hasCompletedOnboarding:true,lastOnboardingVersion:'1.17.0',customApiKeyResponses:{approved:['isolated-dummy'],rejected:[]},projects:{[realpathSync(root)]:{hasTrustDialogAccepted:true,allowedTools:[]}}}));const socket='noa-reply-e2e-'+process.pid;const requests=[];const steps=[];let short;let passed=false;let failure;
const text=c=>typeof c==='string'?c:(c||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');if(!req.url.includes('/messages')||req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end('{"input_tokens":100}');return;}
 const main=body.tools?.some(t=>t.name==='Bash');requests.push({main,body});const n=requests.filter(x=>x.main).length;let content,stop='end_turn';
 if(main&&n===1){content=[{type:'tool_use',id:'ask_bash',name:'Bash',input:{command:'touch forbidden.txt',description:'Permission fixture'}}];stop='tool_use';}
 else content=[{type:'text',text:main?'REPLY_RECEIVED':'META'}];
 const msg={id:'msg_'+requests.length,type:'message',role:'assistant',model:body.model,content,stop_reason:stop,stop_sequence:null,usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0}};
 if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(msg));return;}
 res.writeHead(200,{'content-type':'text/event-stream'});const emit=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
 emit('message_start',{message:{...msg,content:[],stop_reason:null,usage:{...msg.usage,output_tokens:0}}});for(let i=0;i<content.length;i++){const b=content[i];emit('content_block_start',{index:i,content_block:b.type==='tool_use'?{...b,input:{}}:{type:'text',text:''}});emit('content_block_delta',{index:i,delta:b.type==='tool_use'?{type:'input_json_delta',partial_json:JSON.stringify(b.input)}:{type:'text_delta',text:b.text}});emit('content_block_stop',{index:i});}emit('message_delta',{delta:{stop_reason:stop},usage:{output_tokens:10}});emit('message_stop',{});res.end();});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','HOME','USER','TMPDIR','LANG','SHELL'].includes(k))),CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:base,ANTHROPIC_API_KEY:'isolated-dummy',ANTHROPIC_MODEL:'claude-sonnet-4-6',CLAUDE_CODE_SIMPLE:'1',NOA_CLAUDE_BG_ISOLATION:'none',DISABLE_AUTOUPDATER:'1'};
const cli=(args)=>{const r=spawnSync(entry,args,{env,cwd:root,encoding:'utf8',timeout:12000});steps.push({args,exit:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0,r.stderr);return r.stdout;};
const inheritedProduct=join(root,'inherited-product');mkdirSync(inheritedProduct,{recursive:true});
// Exercise a launch from an agent whose product directory differs from this fixture.
const tmux=(...args)=>execFileSync('tmux',['-L',socket,...args],{encoding:'utf8',env:{...process.env,CLAUDE_CODE_PRODUCT_DIR:inheritedProduct}});const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn)=>{for(let i=0;i<120;i++){if(fn())return;await sleep(100);}throw Error('condition timed out');};
const sh=s=>"'"+s.replaceAll("'","'\\''")+"'";
const isolatedCli=args=>['env','-i','TERM=xterm-256color',...Object.entries(env).map(([k,v])=>k+'='+v),entry,...args].map(sh).join(' ');
const readReadyJob=()=>{
 if(!existsSync(join(config,'jobs')))return;
 for(const id of readdirSync(join(config,'jobs')).filter(x=>/^[a-f0-9]{8}$/.test(x))){
  let record;try{record=JSON.parse(readFileSync(join(config,'jobs',id,'state.json'),'utf8'));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)continue;throw e;}
  if(record.short===id&&['working','blocked','done','failed'].includes(record.state))return record;
 }
};
try{
 cli(['--bg','PUBLIC_REPLY_FIXTURE','--model','claude-sonnet-4-6','--permission-mode','default','--tools','Bash,Read','--setting-sources','','--strict-mcp-config']);
 await wait(()=>{const record=readReadyJob();if(!record)return false;short=record.short;return true;});
 const listed=JSON.parse(cli(['agents','--json','--all']));assert.ok(listed.some(row=>row.kind==='background'&&row.id===short),'compiled CLI cannot list the persisted background job before attach');
 const cmd=isolatedCli(['attach',short])+' 2>'+sh(join(root,'attach-stderr.txt'));
 tmux('new-session','-d','-s','view','-x','100','-y','35',cmd);
 await wait(()=>{const screen=tmux('capture-pane','-p','-t','view');if(screen.includes('trust')&&screen.includes('folder'))tmux('send-keys','-t','view','Enter');return requests.some(x=>x.main)});await sleep(400);assert.equal(requests.filter(x=>x.main).length,1);assert.ok(!existsSync(root+'/forbidden.txt'));
 cli(['reply',short,'/stop']);await sleep(1800);assert.equal(requests.filter(x=>x.main).length,1,'reply answered permission dialog');assert.ok(!existsSync(root+'/forbidden.txt'));
 writeFileSync(root+'/permission-screen.txt',tmux('capture-pane','-p','-t','view'));
 tmux('send-keys','-t','view','Escape');await wait(()=>requests.filter(x=>x.main).some(x=>text(x.body.messages.at(-1).content).includes('/stop')));
 cli(['reply',short,'!rm forbidden.txt']);await wait(()=>requests.filter(x=>x.main).some(x=>text(x.body.messages.at(-1).content).includes('!rm forbidden.txt')));
 if(caseName!=='fleet')await wait(()=>readdirSync(join(config,'jobs',short,'inbox')).filter(x=>x.endsWith('.json')).length===0);
 const fleetCmd=isolatedCli(['agents']);
 tmux('new-window','-t','view','-n','fleet',fleetCmd);
 await wait(()=>tmux('capture-pane','-p','-t','view:fleet').includes('PUBLIC_REPLY_FIXTURE'));
 tmux('send-keys','-t','view:fleet','Space');
 await wait(()=>tmux('capture-pane','-p','-t','view:fleet').includes('write a reply'));
 writeFileSync(root+'/fleet-peek-screen.txt',tmux('capture-pane','-p','-t','view:fleet'));
 tmux('send-keys','-t','view:fleet','-l','FLEET_SPACE_REPLY_42');tmux('send-keys','-t','view:fleet','Enter');
 await wait(()=>requests.filter(x=>x.main).some(x=>text(x.body.messages.at(-1).content).includes('FLEET_SPACE_REPLY_42')));
 await wait(()=>!tmux('capture-pane','-p','-t','view:fleet').includes('enter sends a reply'));
 tmux('send-keys','-t','view:fleet','-l','FLEET_CTRL_REPLY_42');tmux('send-keys','-t','view:fleet','C-s');
 await wait(()=>requests.filter(x=>x.main).some(x=>text(x.body.messages.at(-1).content).includes('FLEET_CTRL_REPLY_42')));
 writeFileSync(root+'/fleet-after-screen.txt',tmux('capture-pane','-p','-t','view:fleet'));
 assert.ok(!existsSync(root+'/forbidden.txt'));steps.push({literal_replies:true,permission_not_answered:true,file_not_created:true,fleet_space:true,fleet_ctrl_s:true});
 const malformedId='88888888-8888-4888-8888-888888888888';const protectedDir=join(root,'protected');mkdirSync(protectedDir,{recursive:true});writeFileSync(join(protectedDir,'keep.txt'),'keep');
 const malformedDir=join(config,'jobs','88888888');mkdirSync(malformedDir,{recursive:true});writeFileSync(join(malformedDir,'state.json'),JSON.stringify({short:'../../protected',sessionId:malformedId,cwd:root,state:'done',tempo:'idle',detail:'malformed fixture',respawnFlags:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
 const remove=spawnSync(entry,['rm',malformedId],{env,cwd:root,encoding:'utf8',timeout:12000});steps.push({args:['rm',malformedId],exit:remove.status,stdout:remove.stdout,stderr:remove.stderr,protectedFileExists:existsSync(join(protectedDir,'keep.txt'))});
 assert.equal(remove.status,1,'malformed record was accepted');assert.ok(existsSync(join(protectedDir,'keep.txt')),'malformed record redirected removal');assert.ok(existsSync(malformedDir));
 if(caseName!=='inbox') {
  const guardDir=join(root,'guard');mkdirSync(guardDir,{recursive:true});const guardJob=join(config,'jobs','f00d0001');mkdirSync(guardJob,{recursive:true});
  const guardRecord={short:'f00d0001',sessionId:'99999999-9999-4999-8999-999999999999',cwd:guardDir,name:'PID_GUARD_FIXTURE',state:'working',tempo:'active',detail:'guard fixture',respawnFlags:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  writeFileSync(join(guardJob,'state.json'),JSON.stringify(guardRecord));writeFileSync(join(guardJob,'host.json'),JSON.stringify({pid:9999999,sessionPid:process.pid}));
  tmux('new-window','-t','view','-n','guard',fleetCmd+' --cwd '+sh(guardDir));await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('PID_GUARD_FIXTURE'));
  tmux('send-keys','-t','view:guard','C-x');await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes("Couldn't stop session"));
  assert.ok(!tmux('capture-pane','-p','-t','view:guard').includes('stopped · ctrl+x'));writeFileSync(root+'/fleet-stop-refused-screen.txt',tmux('capture-pane','-p','-t','view:guard'));
  // A session starts after deletion was armed: the primitive must refuse, and the UI must report it.
  writeFileSync(join(guardJob,'host.json'),JSON.stringify({pid:9999999}));writeFileSync(join(guardJob,'state.json'),JSON.stringify({...guardRecord,name:'DELETE_GUARD_FIXTURE',state:'done',tempo:'idle',exitCode:0,updatedAt:new Date().toISOString()}));
  await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('DELETE_GUARD_FIXTURE'));tmux('send-keys','-t','view:guard','C-x');await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('ctrl+x again to delete'));
  writeFileSync(join(guardJob,'host.json'),JSON.stringify({pid:9999999,sessionPid:process.pid}));writeFileSync(join(guardJob,'state.json'),JSON.stringify({...guardRecord,name:'DELETE_GUARD_RUNNING',updatedAt:new Date().toISOString()}));
  await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('DELETE_GUARD_RUNNING'));tmux('send-keys','-t','view:guard','C-x');await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes("Couldn't remove session"));assert.ok(existsSync(guardJob));
  writeFileSync(root+'/fleet-delete-refused-screen.txt',tmux('capture-pane','-p','-t','view:guard'));steps.push({stop_refusal_visible:true,delete_refusal_visible:true,live_record_retained:true});
  writeFileSync(join(guardJob,'inbox'),'block inbox directory creation');
  tmux('send-keys','-t','view:guard','-l','CTRL_DRAFT_MUST_SURVIVE_42');tmux('send-keys','-t','view:guard','C-s');await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('EEXIST'));
  assert.ok(tmux('capture-pane','-p','-t','view:guard').includes('CTRL_DRAFT_MUST_SURVIVE_42'),'failed send erased the unsaved draft');writeFileSync(root+'/fleet-ctrl-draft-screen.txt',tmux('capture-pane','-p','-t','view:guard'));
  tmux('send-keys','-t','view:guard','Escape');await wait(()=>!tmux('capture-pane','-p','-t','view:guard').includes('CTRL_DRAFT_MUST_SURVIVE_42'));
  tmux('send-keys','-t','view:guard','Space');await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('write a reply'));
  tmux('send-keys','-t','view:guard','-l','PEEK_DRAFT_MUST_SURVIVE_42');tmux('send-keys','-t','view:guard','Enter');await wait(()=>tmux('capture-pane','-p','-t','view:guard').includes('EEXIST'));
  assert.ok(tmux('capture-pane','-p','-t','view:guard').includes('PEEK_DRAFT_MUST_SURVIVE_42'),'failed peek send erased the unsaved draft');writeFileSync(root+'/fleet-peek-draft-screen.txt',tmux('capture-pane','-p','-t','view:guard'));steps.push({unsaved_drafts_preserved:true});
 }
 passed=true;console.log('PASS compiled PTY permission dialog, literal background replies and Fleet controls');
}catch(e){failure={message:e.message,stack:e.stack};throw e;}finally{
 if(caseName!=='inbox')try{writeFileSync(root+'/guard-final-screen.txt',tmux('capture-pane','-p','-t','view:guard'));}catch{}
 try{writeFileSync(root+'/final-screen.txt',tmux('capture-pane','-p','-t','view'));}catch{}
 // Preserve the evidence before stop changes working/failed into done/stopped.
 const beforeCleanup=[];if(existsSync(join(config,'jobs')))for(const id of readdirSync(join(config,'jobs')).filter(x=>/^[a-f0-9]{8}$/.test(x))){
  const files={};for(const name of ['state.json','host.json'])try{files[name]=readFileSync(join(config,'jobs',id,name),'utf8');}catch(e){files[name]={error:e.message,code:e.code};}
  beforeCleanup.push({id,...files});
 }
 writeFileSync(root+'/jobs-before-cleanup.json',JSON.stringify(beforeCleanup,null,2));
 if(short){try{cli(['stop',short]);}catch{} }try{tmux('kill-server');}catch{}
 server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(root+'/requests.json',JSON.stringify(requests,null,2));writeFileSync(root+'/steps.json',JSON.stringify(steps,null,2));
 let revision;try{revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()}catch{revision='unavailable'};writeFileSync(root+'/verification.manifest.json',JSON.stringify({command:process.argv,revision,entry,entry_sha256:createHash('sha256').update(readFileSync(entry)).digest('hex'),script_sha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),transport:'Local scripted API, real compiled CLI/tmux/Bun.Terminal, isolated config and fixture-only permissions',passed,exit_code:passed?0:1,failure,steps},null,2));
}
