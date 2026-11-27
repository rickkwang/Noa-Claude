// Mounts the full App in Electron with a mocked bridge and drives split view: pane focus, the split shortcuts,
// pane drag, closing the main pane, parking columns the window can't fit, deleting or opening tasks while panes are
// parked, and closing panes whose task no longer exists.
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const output = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "noa-split-view-")))
mkdirSync(output, { recursive: true })
const temporary = mkdtempSync(join(tmpdir(), "noa-split-view-renderer-"))
const source = (name: string) => JSON.stringify(join(gui, name))
const renderer = `
import {createElement as h} from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {App} from ${source("src/App.tsx")};
const {ipcRenderer}=require('electron');
const root=createRoot(document.getElementById('root'));
const frames=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const pause=(n=100)=>new Promise(r=>setTimeout(r,n));
const wait=async(check,ms=3000)=>{const end=performance.now()+ms;while(!check()&&performance.now()<end)await frames();return !!check()};
const ids={A:'10000000-0000-4000-8000-00000000000a',B:'10000000-0000-4000-8000-00000000000b',C:'10000000-0000-4000-8000-00000000000c',D:'10000000-0000-4000-8000-00000000000d',E:'10000000-0000-4000-8000-00000000000e'};
const nameOf=Object.fromEntries(Object.entries(ids).map(([k,v])=>[v,k]));
let deleted=new Set();const unhandled=new Set();
window.fetch=async(input,init)=>{const url=new URL(String(input),location.href);const p=url.pathname;let body={};
 if(p==='/api/info')body={cwd:'/fixture'};
 else if(p==='/api/projects')body=[{path:'/fixture',name:'Fixture',sources:['/fixture'],missing:false}];
 else if(p==='/api/sessions')body=Object.entries(ids).filter(([,id])=>!deleted.has(id)).map(([k,id],i)=>({id,title:'Task '+k,createdAt:i+1,updatedAt:i+1}));
 else if(p.startsWith('/api/sessions/')&&init?.method==='DELETE'){deleted.add(decodeURIComponent(p.slice(14)));body={ok:true}}
 else if(p==='/api/session-history')body={items:[]};
 else if(p==='/api/runs')body=[];
 else if(p==='/api/files')body={entries:[]};
 else if(p==='/api/changes')body={files:[],additions:0,deletions:0,branch:'main',isGit:true};
 else if(p==='/api/worktree')body={origin:null};
 else if(p==='/api/editors')body={editors:[]};
 else unhandled.add(p);
 return Response.json(body)};
class FakeSocket{static OPEN=1;readyState=1;constructor(url){this.session=new URL(url).searchParams.get('resume');queueMicrotask(()=>this.onopen?.())}
 emit(e){this.onmessage?.({data:JSON.stringify(e)})}
 send(raw){const m=JSON.parse(raw);if(m.type!=='control_request')return;queueMicrotask(()=>{if(m.request.subtype==='initialize'){this.emit({kind:'agent',message:{type:'system',subtype:'init',session_id:this.session,model:'fixture',permissionMode:'default'}});this.emit({kind:'history',items:[]})}this.emit({kind:'agent',message:{type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{models:[],commands:[],effective:{},sources:[],hooks:{items:[],restricted:false},totalTokens:0,maxTokens:200000,percentage:0,model:'fixture'}}}})})}
 close(){this.readyState=3}}
window.WebSocket=FakeSocket;
const resize=w=>ipcRenderer.invoke('resize',w);
const pane=k=>document.querySelector('[data-pane][aria-label="Task '+k+'"]');
const shown=()=>[...document.querySelectorAll('[data-pane]')].filter(el=>el.dataset.paneIndex!=='0').map(el=>el.getAttribute('aria-label').slice(5)).sort().join('');
const focused=()=>document.querySelector('[data-pane][data-focused]')?.getAttribute('aria-label')?.slice(5);
const main=()=>nameOf[JSON.parse(localStorage.getItem('noa-agent.current')||'null')?.resume];
const press=(code,mods={})=>document.body.dispatchEvent(new KeyboardEvent('keydown',{code,key:code,bubbles:true,cancelable:true,...mods}));
const splitMod={metaKey:true,ctrlKey:true};
const point=el=>{const r=el.getBoundingClientRect();return{clientX:r.left+r.width/2,clientY:r.top+r.height/2}};
const focusPane=async k=>{pane(k).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,...point(pane(k))}));await frames()};
const row=title=>[...document.querySelectorAll('.noa-sidebar-tree-row')].find(r=>r.querySelector('.noa-marquee-content')?.textContent===title);
// Mounts App with the given main task and extra panes ([task, col, row]) stored as the previous session left them.
const mount=async(current,panes,shortcuts)=>{root.render(null);await frames();localStorage.clear();
 localStorage.setItem('noa-agent.current',JSON.stringify({cwd:'/fixture',resume:ids[current],runtimeId:'20000000-0000-4000-8000-000000000001'}));
 localStorage.setItem('noa-agent.splitView',JSON.stringify({panes:panes.map(([k,col,row])=>({cwd:'/fixture',id:ids[k],pos:{col,row}})),weights:[],rowSplit:0.5}));
 if(shortcuts)localStorage.setItem('noa-agent.shortcuts',JSON.stringify(shortcuts));
 await remount();await wait(()=>pane(current)&&panes.every(([k])=>k===current||pane(k)))};
// Renders App again from what is in storage, as a reload would.
const remount=async()=>{root.render(null);await frames();root.render(h(App));await wait(()=>document.querySelector('[data-pane-host]'));await pause(200)};
const menuItem=label=>[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.trim()===label);
const openTaskMenu=async title=>{document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await frames();row(title).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));await wait(()=>menuItem('Pin'))};
const mainToggle=()=>[...document.querySelectorAll('[data-right-panel-toggle]')].find(el=>!el.closest('[data-split-pane]'));
const results={};
const check=async(name,fn)=>{try{results[name]=await fn()}catch(error){results[name]=String(error)}};
window.runChecks=async()=>{
 await resize(1800);
 // Runs first: a task once shown in a split pane remembers its own panel state for the rest of the app run.
 await check('rightPanelStaysOpenAcrossTaskSwitch',async()=>{await mount('A',[]);mainToggle().click();await wait(()=>mainToggle().getAttribute('aria-pressed')==='true');row('Task B').click();await wait(()=>main()==='B');await pause(200);const afterB=mainToggle().getAttribute('aria-pressed');row('Task A').click();await wait(()=>main()==='A');await pause(200);const afterA=mainToggle().getAttribute('aria-pressed');return (afterB==='true'&&afterA==='true')||'after B '+afterB+' after A '+afterA});
 // The stored layout still lists B, which is now the main task: B steps aside and C, D are the visible panes.
 await check('hiddenMain_clickFocusesClickedPane',async()=>{await mount('B',[['B',1,0],['C',1,1],['D',2,0]]);if(shown()!=='CD')return 'shown '+shown();await focusPane('D');return focused()==='D'||'focused '+focused()});
 await check('hiddenMain_closeShortcutClosesFocusedPane',async()=>{await mount('B',[['B',1,0],['C',1,1],['D',2,0]]);await focusPane('C');if(focused()!=='C')return 'focused '+focused();press('KeyW',splitMod);await frames();return shown()==='D'||'shown '+shown()});
 await check('hiddenMain_arrowShortcutMovesFocus',async()=>{await mount('B',[['B',1,0],['C',1,0],['D',2,0]]);await focusPane('C');press('ArrowRight',splitMod);await frames();return focused()==='D'||'focused '+focused()});
 await check('cycleShortcutVisitsEveryPane',async()=>{await mount('A',[['B',1,0],['C',2,0]]);const seen=[];for(let i=0;i<3;i++){press('Tab',{ctrlKey:true,key:'Tab'});await frames();seen.push(focused())}return seen.join('')==='BCA'||'cycle '+seen.join('')});
 await check('closeShortcutClosesFocusedPane',async()=>{await mount('A',[['B',1,0],['C',2,0]]);await focusPane('C');press('KeyW',splitMod);await frames();return shown()==='B'||'shown '+shown()});
 await check('closingMainPromotesFirstPane',async()=>{await mount('A',[['B',1,0],['C',2,0]]);await focusPane('A');press('KeyW',splitMod);await wait(()=>main()==='B');await frames();return (main()==='B'&&shown()==='C')||'main '+main()+' shown '+shown()});
 await check('gripDragSwapsPanes',async()=>{await mount('A',[['B',1,0],['C',2,0]]);const grip=pane('B').querySelector('.noa-pane-grip');const from=point(grip),box=pane('C').getBoundingClientRect(),to={clientX:box.left+box.width/2,clientY:box.top+box.height/4};grip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,...from}));window.dispatchEvent(new PointerEvent('pointermove',{...to}));await frames();window.dispatchEvent(new PointerEvent('pointerup',{...to}));await frames();return (pane('B').style.gridColumn==='3'&&pane('C').style.gridColumn==='2')||'B col '+pane('B').style.gridColumn+' C col '+pane('C').style.gridColumn});
 await check('narrowWindowParksAndRestoresPanes',async()=>{await mount('A',[['B',1,0],['C',2,0]]);await resize(900);const parked=await wait(()=>shown()==='');await resize(1800);const restored=await wait(()=>shown()==='BC');return (parked&&restored)||'parked '+parked+' restored '+restored+' shown '+shown()});
 await check('taskDeletedWhileParkedStaysClosed',async()=>{deleted=new Set();await mount('A',[['B',1,0],['C',2,0]]);await resize(900);await wait(()=>shown()==='');
  row('Task C').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200}));await wait(()=>document.querySelector('[role="menu"]'));
  [...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.trim().startsWith('Delete')).click();
  await wait(()=>[...document.querySelectorAll('[role="dialog"] button, dialog button')].some(b=>b.textContent.trim()==='Delete'));
  [...document.querySelectorAll('[role="dialog"] button, dialog button')].find(b=>b.textContent.trim()==='Delete').click();
  await wait(()=>deleted.has(ids.C)&&!row('Task C'));await resize(1800);await wait(()=>shown()==='B');await pause(200);deleted=new Set();return shown()==='B'||'shown '+shown()});
 await check('taskOpenedWhileParkedSurvivesRestore',async()=>{await mount('A',[['B',1,0]]);await resize(900);await wait(()=>shown()==='');row('Task E').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}));await frames();const whileNarrow=shown();await resize(1800);await wait(()=>shown().length>=2);await pause(200);return shown()==='BE'||'narrow '+whileNarrow+' wide '+shown()});
 await check('closeShortcutFollowsSettings',async()=>{await mount('A',[['B',1,0],['C',2,0]],{closePane:'mod+shift+KeyX'});await focusPane('C');press('KeyW',splitMod);await frames();const oldKeyIgnored=shown()==='BC';press('KeyX',{metaKey:true,shiftKey:true});await frames();return (oldKeyIgnored&&shown()==='B')||'old ignored '+oldKeyIgnored+' shown '+shown()});
 await check('taskOpenedWhileParkedSurvivesReload',async()=>{await mount('A',[['B',1,0]]);await resize(900);await wait(()=>shown()==='');row('Task E').dispatchEvent(new MouseEvent('click',{bubbles:true,altKey:true}));await frames();await remount();await resize(1800);await wait(()=>shown().length>=2);await pause(200);return shown()==='BE'||'after reload '+shown()});
 await check('sidebarMoveMenuFollowsLayout',async()=>{await mount('A',[['B',1,0],['C',2,0]]);await openTaskMenu('Task B');menuItem('Move').click();await wait(()=>menuItem('Move right'));menuItem('Move right').click();await wait(()=>pane('B').style.gridColumn==='3');
  await openTaskMenu('Task B');menuItem('Move').click();await wait(()=>menuItem('Move left'));const labels=['Move left','Move right'].filter(menuItem).join(',');document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return labels==='Move left'||'moves '+labels});
 await check('customBindingKeepsKeysFromNewDefault',async()=>{await mount('A',[['B',1,0]],{findTasks:'ctrl+Tab'});await focusPane('A');press('Tab',{ctrlKey:true,key:'Tab'});await frames();const stillA=focused()==='A';const searchOpened=await wait(()=>document.querySelector('dialog[aria-label="Search Noa"][open]'),1000);press('Escape',{key:'Escape'});return (stillA&&searchOpened)||'focused '+focused()+' search '+searchOpened});
 // Columns the window can't fit at their minimum width are parked, and come back as it widens.
 await check('columnsFitWindowWidth',async()=>{await resize(1800);await mount('A',[['B',1,0],['C',2,0],['D',3,0],['E',4,0]]);
  const narrowest=()=>Math.min(...[...document.querySelectorAll('[data-pane]')].map(el=>el.getBoundingClientRect().width));
  const steps=[];for(const w of [1800,1300,1800]){await resize(w);await pause(300);steps.push(w+':'+shown()+'@'+Math.round(narrowest()))}
  const stored=JSON.parse(localStorage.getItem('noa-agent.splitView')).panes.length;
  return (steps.every(step=>+step.split('@')[1]>=359)&&steps[0].split('@')[0]===steps[2].split('@')[0]&&stored===4)||steps.join(' ')+' stored '+stored});
 // Parking a column and bringing it back keeps the column widths the user set.
 await check('columnWidthsSurviveParking',async()=>{await resize(1800);await mount('A',[['B',1,0],['C',2,0],['D',3,0]]);
  const saved=JSON.parse(localStorage.getItem('noa-agent.splitView'));localStorage.setItem('noa-agent.splitView',JSON.stringify({...saved,weights:[1,2,1,1]}));await remount();
  const ratio=()=>Math.round(pane('B').getBoundingClientRect().width/pane('C').getBoundingClientRect().width*10)/10;const before=ratio();
  await resize(1300);await pause(300);const narrow=shown();await resize(1800);await pause(300);
  return (before===2&&narrow!=='BCD'&&shown()==='BCD'&&ratio()===2&&JSON.stringify(JSON.parse(localStorage.getItem('noa-agent.splitView')).weights)==='[1,2,1,1]')||'before '+before+' narrow '+narrow+' after '+shown()+' ratio '+ratio()+' weights '+JSON.stringify(JSON.parse(localStorage.getItem('noa-agent.splitView')).weights)});
 // Closing a pane frees room for a parked column, which comes back without a resize.
 await check('closingPaneUnparksColumn',async()=>{await resize(1800);await mount('A',[['B',1,0],['C',2,0],['D',3,0],['E',4,0]]);const before=shown();await focusPane('B');press('KeyW',splitMod);await pause(300);return (before==='BCD'&&shown()==='CDE')||'before '+before+' after '+shown()});
 // A stored pane whose task is gone (deleted outside this window) closes once the task list has loaded.
 await check('missingTaskPaneCloses',async()=>{await mount('A',[['B',1,0]]);const gone='10000000-0000-4000-8000-0000000000ff';
  localStorage.setItem('noa-agent.splitView',JSON.stringify({panes:[{cwd:'/fixture',id:ids.B,pos:{col:1,row:0}},{cwd:'/fixture',id:gone,pos:{col:2,row:0}}],weights:[],rowSplit:0.5}));
  await remount();await wait(()=>row('Task B'));await pause(300);const stored=localStorage.getItem('noa-agent.splitView');
  return (shown()==='B'&&!stored.includes(gone))||'shown '+shown()+' stored '+stored});
 await check('settingsListSplitShortcuts',async()=>{await mount('A',[['B',1,0]]);press('Comma',{metaKey:true});await wait(()=>document.querySelector('[role="dialog"] nav button'));
  [...document.querySelectorAll('[role="dialog"] nav button')].find(b=>b.innerText.trim()==='Keyboard shortcuts').click();
  const keys=label=>[...document.querySelectorAll('[data-settings-label="'+label+'"] kbd')].map(k=>k.textContent).join('');
  await wait(()=>keys('Close split pane'));return (keys('Close split pane')==='⌃⌘W'&&keys('Focus pane on the left')==='⌃⌘←'&&keys('Focus previous pane')==='⌃⇧Tab')||'close '+keys('Close split pane')+' left '+keys('Focus pane on the left')+' previous '+keys('Focus previous pane')});
 root.render(null);
 if(unhandled.size)results.unhandledRoutes=[...unhandled].join(',');
 return results;
};
`
writeFileSync(join(temporary, "renderer.ts"), renderer)
const build = await Bun.build({ entrypoints: [join(temporary, "renderer.ts")], outdir: temporary, target: "browser", format: "esm", splitting: true, external: ["electron"], define: { "process.env.NODE_ENV": '"production"' } })
if (!build.success) throw new Error(build.logs.join("\n"))
const cssFile = readdirSync(join(gui, "dist/assets")).find(name => name.endsWith(".css"))!
writeFileSync(join(temporary, "index.html"), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${join(gui, "dist/assets", cssFile)}"><style>html,body,#root{margin:0;height:100%}</style><div id="root"></div><script type="module" src="renderer.js"></script>`)
const resultPath = join(output, "checks.json")
const screenshotPath = join(output, "split-view.png")
rmSync(resultPath, { force: true })
writeFileSync(join(temporary, "main.cjs"), `
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs');
app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1800,height:1000,show:false,webPreferences:{sandbox:false,contextIsolation:false,nodeIntegration:true}});
 ipcMain.handle('resize',(_e,width)=>{win.setContentSize(width,1000)});
 const finish=async(result,code)=>{fs.writeFileSync(${JSON.stringify(screenshotPath)},(await win.webContents.capturePage()).toPNG());fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result,null,2));app.exit(code)};
 try{await win.loadFile(${JSON.stringify(join(temporary, "index.html"))});await finish(await win.webContents.executeJavaScript('window.runChecks()'),0)}
 catch(error){await finish({error:String(error)},1)}
});
`)
const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "ignore", stderr: "inherit" })
const timer = setTimeout(() => child.kill(), 120_000)
await child.exited
clearTimeout(timer)
rmSync(temporary, { recursive: true, force: true })
if (!(await Bun.file(resultPath).exists())) throw new Error("Electron split view checks did not finish")
const results = await Bun.file(resultPath).json()
console.log(JSON.stringify({ output, results }, null, 2))
if (Object.values(results).some(value => value !== true)) process.exitCode = 1
