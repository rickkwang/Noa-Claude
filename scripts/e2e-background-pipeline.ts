// Real query/Read/queue/transcript pipeline; only model transport is scripted.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const option=(name:string)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:undefined
const root=resolve(option('--artifacts')??mkdtempSync(join(tmpdir(),'noa-reply-pipeline-')))
mkdirSync(root,{recursive:true})
for(const name of Object.keys(process.env)) if(/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
assert.notEqual(process.env.NODE_ENV,'test')
process.env.CLAUDE_CONFIG_DIR=join(root,'config');process.env.CLAUDE_CODE_PRODUCT_DIR=process.env.CLAUDE_CONFIG_DIR
process.env.NOA_CLAUDE_BG_JOB='abcdef01';process.env.CLAUDE_CODE_SIMPLE='1';process.env.ANTHROPIC_API_KEY='isolated-dummy';process.env.ANTHROPIC_BASE_URL='http://127.0.0.1:1'
;(globalThis as any).MACRO={VERSION:'1.17.0',DISPLAY_VERSION:'1.17.0',BUILD_TIME:''}
process.chdir(root)
const {enableConfigs}=await import('../src/utils/config.js');enableConfigs()
const {captureBgJobEnv}=await import('../src/utils/background/bgJob.js');captureBgJobEnv()
const {writeJob,getJobDir}=await import('../src/utils/background/jobs.js')
const {queueJobReply,watchJobReplies}=await import('../src/utils/background/replies.js')
const {getCommandQueue,clearCommandQueue,enqueue,dequeue}=await import('../src/utils/messageQueueManager.js')
const {recordTranscript,flushSessionStorage,setSessionFileForTesting,reAppendSessionMetadata,loadTranscriptFile}=await import('../src/utils/sessionStorage.js')
const {switchSession}=await import('../src/bootstrap/state.js')
const {createUserMessage,createAssistantMessage,handleMessageFromStream}=await import('../src/utils/messages.js')
const {processQueuedCommandsForTurn}=await import('../src/utils/queuedCommandTurnProcessor.js')
const {query}=await import('../src/query.js')
const {FileReadTool}=await import('../src/tools/FileReadTool/FileReadTool.js')
const {FileStateCache}=await import('../src/utils/fileStateCache.js')
const {getEmptyToolPermissionContext}=await import('../src/Tool.js')
const {asSystemPrompt}=await import('../src/utils/systemPromptType.js')
switchSession('11111111-1111-4111-8111-111111111111' as any)
const transcript=join(root,'transcript.jsonl');setSessionFileForTesting(transcript)
await writeJob({short:'abcdef01',sessionId:'11111111-1111-4111-8111-111111111111',cwd:root,state:'working',tempo:'active',detail:'fixture',respawnFlags:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
const messages:any[]=[];const observed:any={};const passed:string[]=[]
const state:any={tasks:{},toolPermissionContext:getEmptyToolPermissionContext(),agentNameRegistry:new Map(),agentDefinitions:{activeAgents:[],allAgents:[],allowedAgentTypes:[]},sessionHooks:new Map(),mcp:{tools:[],clients:[]}}
const context:any={options:{commands:[],debug:false,mainLoopModel:'claude-sonnet-4-6',tools:[FileReadTool],verbose:false,thinkingConfig:{type:'disabled'},mcpClients:[],mcpResources:{},isNonInteractiveSession:false,agentDefinitions:state.agentDefinitions},abortController:new AbortController(),readFileState:new FileStateCache(100,100000),getAppState:()=>state,setAppState:(f:any)=>Object.assign(state,f(state)),setInProgressToolUseIDs:()=>{},setResponseLength:()=>{},updateFileHistoryState:()=>{},updateAttributionState:()=>{},messages}
const inbox=(id:string)=>join(getJobDir('abcdef01'),'inbox',id+'.json')
const wait=async(fn:()=>boolean)=>{for(let i=0;i<100;i++){if(fn())return;await Bun.sleep(30)}throw Error('condition timed out')}
const append=(event:any)=>handleMessageFromStream(event,m=>messages.push(m),()=>{},()=>{},()=>{})
let watcher=watchJobReplies(()=>messages);let exit=1
try {
  if(!['inline','write-failure'].includes(option('--case')!)) {
    const id=await queueJobReply('abcdef01','CANCEL_KEEP_REPLY_42');await wait(()=>getCommandQueue().some(c=>c.uuid===id))
    enqueue({mode:'task-notification',value:'discard this notification'})
    clearCommandQueue();watcher.sync();observed.afterClear=getCommandQueue().map(c=>({uuid:c.uuid,mode:c.mode}))
    assert.deepEqual(getCommandQueue().map(c=>c.uuid),[id]);assert.ok(existsSync(inbox(id)))
    const command=dequeue()!;watcher.sync();await Bun.sleep(60);assert.equal(getCommandQueue().length,0,'reply duplicated between dequeue and materialization')
    const result=await processQueuedCommandsForTurn({commands:[command],messages:[],setToolJSX:()=>{},makeContext:()=>context,setUserInputOnProcessing:()=>{},querySource:'repl_main_thread',ideSelection:undefined})
    assert.equal(result.shouldQuery,true);assert.ok(result.newMessages.some(m=>m.type==='user'&&m.uuid===id))
    result.newMessages.forEach(append);await recordTranscript(messages);await flushSessionStorage();watcher.sync();await wait(()=>!existsSync(inbox(id)))
    passed.push('cancel-preserves-durable-reply','dequeue-does-not-duplicate');console.log('PASS durable reply survives notification cancellation and dequeue')
  }
  if(!['clear','write-failure'].includes(option('--case')!)) {
    const id=await queueJobReply('abcdef01','INLINE_REPLY_ONCE_42');await wait(()=>getCommandQueue().some(c=>c.uuid===id))
    const file=join(root,'fixture.txt');writeFileSync(file,'READ_OK\n');let calls=0
    const deps:any={uuid:()=>crypto.randomUUID(),microcompact:async(m:any[])=>({messages:m}),autocompact:async()=>({wasCompacted:false}),stopHooks:async function*(){return {blockingErrors:[],preventContinuation:false}},callModel:async function*(params:any){
      calls++
      if(calls===1)yield createAssistantMessage({content:[{type:'tool_use',id:'read_fixture',name:'Read',input:{file_path:file}}]})
      else {assert.ok(JSON.stringify(params.messages).includes('INLINE_REPLY_ONCE_42'));yield createAssistantMessage({content:'DONE'})}
    }}
    for await(const event of query({messages:[createUserMessage({content:'Read the fixture and process any followup.'})],systemPrompt:asSystemPrompt([]),userContext:{},systemContext:{},canUseTool:async(_tool:any,input:any)=>({behavior:'allow',updatedInput:input}),toolUseContext:context,querySource:'repl_main_thread',deps,maxTurns:3}))append(event)
    assert.equal(calls,2);assert.equal(messages.filter(m=>m.type==='attachment'&&m.attachment.type==='queued_command'&&m.attachment.source_uuid===id).length,1)
    await recordTranscript(messages);await flushSessionStorage();observed.inlineRecorded=readFileSync(transcript,'utf8').includes(id);watcher.sync()
    try {await wait(()=>!existsSync(inbox(id)))} finally {observed.inlineInboxExists=existsSync(inbox(id))}
    watcher.close()
    const restored=readFileSync(transcript,'utf8').trim().split('\n').map(s=>JSON.parse(s)).filter(m=>['user','assistant','attachment','system'].includes(m.type))
    // Crash after transcript flush but before inbox acknowledgment.
    writeFileSync(inbox(id),JSON.stringify({uuid:id,text:'INLINE_REPLY_ONCE_42',createdAt:new Date().toISOString()}))
    watcher=watchJobReplies(()=>restored);await wait(()=>!existsSync(inbox(id)));assert.equal(getCommandQueue().length,0)
    passed.push('inline-and-resume-exactly-once');console.log('PASS inline reply acknowledged and not replayed after restart')
  }
  if(!option('--case')||option('--case')==='write-failure') {
    watcher.close();await flushSessionStorage()
    const fault=join(root,'failed-transcript.jsonl');mkdirSync(fault);setSessionFileForTesting(fault)
    const id=await queueJobReply('abcdef01','WRITE_FAILURE_REPLY_42')
    enqueue({uuid:id,value:'WRITE_FAILURE_REPLY_42',mode:'prompt',backgroundReply:true,skipSlashCommands:true})
    const result=await processQueuedCommandsForTurn({commands:[dequeue()!],messages:[],setToolJSX:()=>{},makeContext:()=>context,setUserInputOnProcessing:()=>{},querySource:'repl_main_thread',ideSelection:undefined})
    result.newMessages.forEach(append);await recordTranscript(messages)
    await assert.rejects(flushSessionStorage(),(e:any)=>e.code==='EISDIR')
    watcher=watchJobReplies(()=>messages)
    await assert.rejects(flushSessionStorage(),(e:any)=>e.code==='EISDIR')
    assert.throws(()=>reAppendSessionMetadata(),(e:any)=>e.code==='EISDIR')
    observed.failedWriteKeepsInbox=existsSync(inbox(id));assert.ok(observed.failedWriteKeepsInbox)
    await assert.rejects(flushSessionStorage(),(e:any)=>e.code==='EISDIR')
    rmdirSync(fault);writeFileSync(fault,'{"type":"user","uuid":"partial',{mode:0o600});reAppendSessionMetadata();await flushSessionStorage();watcher.sync();await wait(()=>!existsSync(inbox(id)))
    assert.ok((await loadTranscriptFile(fault)).messages.has(id))
    const recorded=readFileSync(fault,'utf8').split('\n').flatMap(s=>{try {return [JSON.parse(s)]} catch {return []}})
    assert.equal(recorded.filter(m=>m.type==='user'&&m.uuid===id).length,1)
    passed.push('failed-transcript-retained-and-retried');console.log('PASS failed transcript remains pending and is acknowledged only after retry')
  }
  exit=0
} catch(e) {console.error(e)} finally {
  watcher.close();try {await flushSessionStorage()} catch(e) {console.error(e);exit=1}
  writeFileSync(join(root,'observed.json'),JSON.stringify(observed,null,2))
  let revision='unavailable';try {revision=execFileSync('git',['-C',resolve(import.meta.dir,'..'),'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()} catch {}
  writeFileSync(join(root,'verification.manifest.json'),JSON.stringify({command:process.argv,revision,script_sha256:createHash('sha256').update(readFileSync(import.meta.path)).digest('hex'),transport:'Real query/Read/queue/transcript pipeline; scripted model, isolated configuration, no live API',passed,exit_code:exit},null,2))
}
process.exit(exit)
