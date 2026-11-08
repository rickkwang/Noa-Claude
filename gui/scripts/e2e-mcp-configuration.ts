import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root=resolve(import.meta.dir, '../..')
const dir=mkdtempSync(join(tmpdir(),'noa-security-mcp-race-'))
const cwd=join(dir,'workspace'), config=join(dir,'config')
mkdirSync(join(cwd,'.noa'),{recursive:true});mkdirSync(config)
writeFileSync(join(cwd,'.noa','mcp.json'),JSON.stringify({mcpServers:{}}))
writeFileSync(join(config,'settings.json'),JSON.stringify({model:'claude-sonnet-4-6',env:{ANTHROPIC_API_KEY:'local-fixture',ANTHROPIC_BASE_URL:'http://127.0.0.1:1'}}))
function diskServers(scope:string){
 if(scope==='project')return JSON.parse(readFileSync(join(cwd,'.noa','mcp.json'),'utf8')).mcpServers
 const global=JSON.parse(readFileSync(join(config,'.config.json'),'utf8'))
 return scope==='user'?global.mcpServers??{}:global.projects?.[realpathSync(cwd)]?.mcpServers??{}
}
function cli(){
 const proc=Bun.spawn([process.execPath,join(root,'run-noa.js'),'-p','--input-format','stream-json','--output-format','stream-json','--verbose','--permission-prompt-tool','stdio'],{cwd,env:{...process.env,CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_PRODUCT_DIR:config,CLAUDE_CODE_CACHE_DIR:join(dir,'cache'),CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',ANTHROPIC_AUTH_TOKEN:'',ANTHROPIC_API_KEY:'local-fixture',ANTHROPIC_BASE_URL:'http://127.0.0.1:1',OPENAI_API_KEY:'',OPENAI_BASE_URL:'',CLAUDE_CODE_USE_OPENAI:'',CLAUDE_CODE_USE_BEDROCK:'',CLAUDE_CODE_USE_VERTEX:'',CLAUDE_CODE_USE_FOUNDRY:'',ENABLE_TOOL_SEARCH:'false'},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
 const pending=new Map<string,(x:any)=>void>();let errors='';
 void(async()=>{for await(const b of proc.stderr)errors+=new TextDecoder().decode(b)})()
 void(async()=>{let buffer='';for await(const b of proc.stdout){buffer+=new TextDecoder().decode(b);let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line)}catch{continue}if(m.type==='control_response'){pending.get(m.response.request_id)?.(m.response);pending.delete(m.response.request_id)}}}})()
 const request=(request:any)=>new Promise<any>((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>reject(new Error('timeout '+request.subtype+' '+errors.slice(-300))),15000);pending.set(id,x=>{clearTimeout(timer);resolve(x)});proc.stdin.write(JSON.stringify({type:'control_request',request_id:id,request})+'\n')})
 return{proc,request}
}
const a=cli(),b=cli()
try{
 console.log('FIXTURE',dir)
 const init=await Promise.all([a.request({subtype:'initialize'}),b.request({subtype:'initialize'})]);console.log('INIT',init.map(x=>x.subtype))
 for (const scope of ['project', 'user', 'local']) {
  for(let trial=0;trial<5;trial++){
   const get={subtype:'configuration',kind:'mcp',scope,action:'get'}
   let ga:any,gb:any
   const freshDeadline=Date.now()+5000
   for(;;){
    [ga,gb]=await Promise.all([a.request(get),b.request(get)])
    if(ga.subtype==='success'&&gb.subtype==='success'&&ga.response.revision===gb.response.revision&&Object.keys(ga.response.value).length===Object.keys(diskServers(scope)).length)break
    if(Date.now()>freshDeadline)throw new Error('configuration caches did not refresh')
    await Bun.sleep(25)
   }
   assert.equal(ga.subtype,'success');assert.equal(gb.subtype,'success')
   assert.equal(ga.response.revision,gb.response.revision)
   const before=Object.keys(ga.response.value)
   const save=(name:string,revision:string)=>({subtype:'configuration',kind:'mcp',scope,action:'save',name,revision,value:{type:'stdio',command:'/usr/bin/true',args:[],env:{PRESERVED:'${PATH}'}}})
   const nameA=`${scope}_server_a_${trial}`, nameB=`${scope}_server_b_${trial}`
   const [sa,sb]=await Promise.all([a.request(save(nameA,ga.response.revision)),b.request(save(nameB,gb.response.revision))])
   const current={response:{value:diskServers(scope)}}, names=Object.keys(current.response.value)
   const successes=[sa,sb].filter(x=>x.subtype==='success').length
   console.log('SAVE',scope,trial,sa.subtype,sb.subtype,'COUNT',before.length,'->',names.length)
   assert.equal(successes,1,'Only one edit based on the same revision may succeed')
   const rejection=sa.subtype==='error'?sa:sb
   assert.match(rejection.error,/changed outside/)
   assert.equal(names.length,before.length+1,'Exactly one new server should survive')
   for(const name of names) assert.equal(current.response.value[name].env.PRESERVED,'${PATH}')
   assert.ok(before.every(name=>names.includes(name)),'Existing servers must remain intact')
  }
 }
 console.log('PASS all 15 two-process MCP races reject stale edits and preserve existing servers and environment references')
 const globalFile=join(config,'.config.json')
 const currentConfig=JSON.parse(readFileSync(globalFile,'utf8'))
 writeFileSync(globalFile,JSON.stringify({...currentConfig,hasCompletedOnboarding:true}))
 const guarded=cli()
 try {
  await guarded.request({subtype:'initialize'})
  const before=await guarded.request({subtype:'configuration',kind:'mcp',scope:'user',action:'get'})
  writeFileSync(globalFile,JSON.stringify({...JSON.parse(readFileSync(globalFile,'utf8')),hasCompletedOnboarding:false}))
  const result=await guarded.request({subtype:'configuration',kind:'mcp',scope:'user',action:'save',name:'skip_probe',revision:before.response.revision,value:{type:'stdio',command:'/usr/bin/true',args:[]}})
  assert.equal(result.subtype,'error','A refused write must not report success')
  assert.match(result.error,/not saved/)
  assert.ok(!JSON.parse(readFileSync(globalFile,'utf8')).mcpServers.skip_probe)
  console.log('PASS a configuration write refused by storage protection reports an error instead of Saved')
 } finally { guarded.proc.kill();await guarded.proc.exited }


}finally{a.proc.kill();b.proc.kill();await Promise.all([a.proc.exited,b.proc.exited]);rmSync(dir,{recursive:true,force:true})}
