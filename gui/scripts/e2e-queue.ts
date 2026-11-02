import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const output = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "noa-queue-checks-")))
const temporary = mkdtempSync(join(tmpdir(), "noa-queue-renderer-"))
mkdirSync(output, { recursive: true })
const source = (path: string) => JSON.stringify(join(gui, path))
writeFileSync(join(temporary, "renderer.ts"), `
import {createElement as h,useState} from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {QueuedMessages} from ${source("src/components/QueuedMessages.tsx")};
import {Composer} from ${source("src/components/Composer.tsx")};
import ThemeInjector from ${source("src/theme/ThemeInjector.tsx")};
import {defaultSettings} from ${source("src/theme/settings.ts")};
const root=createRoot(document.getElementById('root')),pause=(ms=150)=>new Promise(r=>setTimeout(r,ms)),noop=()=>{};
const messages=[{id:'one',content:'现在 GUI 和 CLI 的适配程度如何？',at:1},{id:'two',content:'继续检查消息发送、排队和中断后的恢复。',at:2}];
let actions={},sequence=0;
function Scene({mode,busy,paused,editing,theme}){
 const [rows,setRows]=useState(messages),[stopped,setStopped]=useState(paused);
 return h('div',{style:{width:'100%',maxWidth:840,margin:'0 auto',display:'flex',flexDirection:'column',gap:8}},h(ThemeInjector,{settings:{...defaultSettings,appearance:{...defaultSettings.appearance,theme}}}),rows.length?h(QueuedMessages,{messages:rows,busy,paused:stopped,editing,onMove:(id,index)=>{actions.move=[id,index];setRows(current=>{const next=current.filter(item=>item.id!==id);next.splice(index,0,current.find(item=>item.id===id));return next})},onRemove:id=>{actions.remove=id;setRows(current=>current.filter(item=>item.id!==id))},onEdit:message=>{actions.edit=message.id},onSteer:id=>{actions.steer=id;setRows(current=>current.filter(item=>item.id!==id))},onRetry:id=>{actions.retry=id},onRun:()=>{actions.run=true},onPaused:value=>{actions.paused=value;setStopped(value)}}):null,h(Composer,{connection:'ready',busy,followUpMode:mode,models:[{value:'fixture',displayName:'Noa model',description:''}],model:'fixture',commands:[],onSend:content=>{actions.sent=content;return true},onCommand:noop,onInterrupt:noop,onModel:noop,onMode:noop,draftKey:'queue-preview-'+mode,onEffort:noop,cwd:'/fixture/Claude',projects:[],onProject:noop,onBranchChange:noop,onWorktree:async()=>{},onFiles:noop,newTask:false}));
}
window.renderQueue=async(mode='queue',paused=false,editing=false,busy=true,theme='dark')=>{actions={};localStorage.setItem('queue-preview-'+mode,'继续核对实现与验证结果');root.render(h(Scene,{key:++sequence,mode,paused,editing,busy,theme}));await pause(250);await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)};
window.runChecks=async()=>{
 const checks={};await window.renderQueue();let section=document.querySelector('[aria-label="Queued messages"]');
 checks.compactQueue=section.querySelectorAll('[draggable]').length===2&&!section.querySelector('.border-b');
 checks.steerVisible=[...section.querySelectorAll('button')].filter(button=>button.textContent==='Steer').length===2;
 checks.singleLinePreview=getComputedStyle(section.querySelector('p')).whiteSpace==='nowrap';
 checks.queueComposer=document.querySelector('[data-action="queue"]')?.getAttribute('aria-label')==='Queue message';
 checks.attachedTray=getComputedStyle(section).borderBottomWidth==='0px'&&Math.abs(section.getBoundingClientRect().bottom-document.querySelector('.noa-agent-composer').getBoundingClientRect().top-16)<1;
 section.querySelector('[draggable]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}));await pause();checks.keyboardReorder=actions.move?.join(',')==='one,1'&&section.querySelector('p').textContent===messages[1].content;
 section.querySelector('[aria-label="Steer current turn with queued message"]').click();await pause();checks.steerAction=actions.steer==='two'&&section.querySelectorAll('[draggable]').length===1;
 await window.renderQueue('steer');checks.steerComposer=document.querySelector('[data-action="steer"]')?.getAttribute('aria-label')==='Steer'&&!document.querySelector('textarea').placeholder.includes('queue');
 section=document.querySelector('[aria-label="Queued messages"]');section.querySelector('[aria-label="More queued message actions"]').click();await pause();[...document.querySelectorAll('[role="menuitem"]')].find(button=>button.textContent==='Edit').click();await pause();checks.editAction=actions.edit==='one';
 section.querySelector('[aria-label="More queued message actions"]').click();await pause();[...document.querySelectorAll('[role="menuitem"]')].find(button=>button.textContent==='Pause queue').click();await pause();checks.pauseAction=actions.paused===true&&section.textContent.includes('Queue paused');
 [...section.querySelectorAll('button')].find(button=>button.textContent==='Resume').click();await pause();checks.resumeAction=actions.paused===false&&!section.textContent.includes('Queue paused');
 await window.renderQueue('queue',true,true);section=document.querySelector('[aria-label="Queued messages"]');checks.editingGuards=[...section.querySelectorAll('button')].filter(button=>button.textContent==='Steer'||button.textContent==='Resume').every(button=>button.disabled);
 section.querySelector('[aria-label="More queued message actions"]').click();await pause();checks.editingMenuGuards=[...document.querySelectorAll('[role="menuitem"]')].filter(button=>['Send next','Resume queue'].includes(button.textContent)).every(button=>button.disabled);
 await window.renderQueue('queue',true,false,false);section=document.querySelector('[aria-label="Queued messages"]');[...section.querySelectorAll('button')].find(button=>button.textContent==='Resume').click();await pause();checks.idleResume=actions.run===true&&actions.paused===false;
 section.querySelector('[aria-label="Send queued message now"]').click();checks.idleSendNow=actions.retry==='one';
 section.querySelector('[aria-label="Delete queued message"]').click();await pause(250);checks.deleteAction=actions.remove==='one'&&section.querySelectorAll('[draggable]').length===1&&section.textContent.includes(messages[1].content);
 return checks;
};
`)
const built = await Bun.build({ entrypoints: [join(temporary, "renderer.ts")], outdir: temporary, target: "browser", format: "esm", splitting: true, define: { "process.env.NODE_ENV": '"production"' } })
assert.ok(built.success, built.logs.join("\n"))
const css = readdirSync(join(gui, "dist/assets")).find(name => name.startsWith("index-") && name.endsWith(".css"))!
writeFileSync(join(temporary, "index.html"), `<link rel="stylesheet" href="file://${join(gui, "dist/assets", css)}"><style>html,body{margin:0;min-height:100%;background:var(--surface-page);color:var(--text-primary)}body{padding:24px}</style><div id="root"></div><script type="module" src="renderer.js"></script>`)
writeFileSync(join(temporary, "main.cjs"), `const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});app.whenReady().then(async()=>{const win=new BrowserWindow({width:940,height:420,useContentSize:true,show:true,webPreferences:{sandbox:true,backgroundThrottling:false}});try{await win.loadFile(${JSON.stringify(join(temporary, "index.html"))});const checks=await win.webContents.executeJavaScript('window.runChecks()');fs.writeFileSync(${JSON.stringify(join(output, "checks.json"))},JSON.stringify(checks,null,2));for(const [name,mode,paused,theme] of [['queue-dark','queue',false,'dark'],['steer-dark','steer',false,'dark'],['paused-dark','queue',true,'dark'],['queue-light','queue',false,'light']]){await win.webContents.executeJavaScript('window.renderQueue('+JSON.stringify(mode)+','+paused+',false,true,'+JSON.stringify(theme)+')');win.webContents.invalidate();await win.webContents.capturePage();await new Promise(r=>setTimeout(r,200));fs.writeFileSync(${JSON.stringify(output)}+'/'+name+'.png',(await win.webContents.capturePage()).toPNG())}app.quit()}catch(error){console.error(error);app.exit(1)}})`)
const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "inherit", stderr: "inherit" })
const timer = setTimeout(() => child.kill(), 30000)
const code = await child.exited
clearTimeout(timer)
assert.equal(code, 0, "Queue Electron fixture failed")
const checks = await Bun.file(join(output, "checks.json")).json()
console.log(JSON.stringify({ output, checks }, null, 2))
assert.ok(Object.values(checks).every(value => value === true), "Queue interaction checks failed")
