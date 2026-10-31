import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const temporary = mkdtempSync(join(tmpdir(), "noa-sidebar-e2e-"))
const output = resolve(process.argv[2] ?? join(temporary, "screenshots"))
const source = (path: string) => JSON.stringify(join(gui, path))
try {
  symlinkSync(join(gui, "node_modules"), join(temporary, "node_modules"))
  writeFileSync(join(temporary, "renderer.tsx"), `
import React from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {Sidebar} from ${source("src/components/Sidebar.tsx")};
import ThemeInjector from ${source("src/theme/ThemeInjector.tsx")};
import {defaultSettings} from ${source("src/theme/settings.ts")};
const root=createRoot(document.getElementById('root'));
const projects=[{path:'/alpha',name:'Alpha',sources:['/alpha']},{path:'/beta',name:'Beta',sources:['/beta']}];
let sessions={'/alpha':[{id:'a',title:'Older task',createdAt:1,updatedAt:1},{id:'b',title:'Latest task',createdAt:10,updatedAt:10}],'/beta':[{id:'c',title:'Other project task',createdAt:5,updatedAt:5}]};
let selected,theme='light',searches=0;
const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const wait=async check=>{const deadline=performance.now()+3000;while(!check()&&performance.now()<deadline)await frames();return !!check()};
const row=(title,scope=document)=>[...scope.querySelectorAll('.noa-sidebar-tree-row')].find(row=>row.querySelector('.noa-marquee-content')?.textContent===title);
const render=async()=>{root.render(<><ThemeInjector settings={{...defaultSettings,appearance:{...defaultSettings.appearance,theme}}}/><div style={{width:340,height:680}}><Sidebar projects={projects} sessions={sessions} loadedProjects={new Set(['/alpha','/beta'])} active={{cwd:'/alpha'}} onSelect={(cwd,id)=>selected={cwd,id}} onNewSession={()=>{}} onAddProject={()=>{}} onEditProject={()=>{}} onRemoveProject={()=>{}} onRevealProject={()=>{}} onDeleteSession={(cwd,id)=>{sessions={...sessions,[cwd]:sessions[cwd].filter(task=>task.id!==id)};void render()}} onSearch={()=>{searches++}} onSettings={()=>{}}/></div><div style={{position:'absolute',left:350,top:0,fontSize:28,width:400}}>Background conversation text behind the menu. This must not show through its surface.</div></>);await frames()};
const menu=async title=>{row(title).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:300,clientY:160}));if(!await wait(()=>document.querySelector('[role="menu"][aria-label="Task options"]')))throw Error('Task menu did not open');const panel=document.querySelector('[role="menu"][aria-label="Task options"]');await wait(()=>panel.getAnimations().every(animation=>animation.playState==='finished'));return panel};
const select=label=>{const items=[...document.querySelectorAll('[role="menuitem"]')];const button=items.find(button=>button.textContent.trim()===label);if(!button)throw Error('Missing menu action '+label+': '+items.map(item=>item.textContent).join('|'));button.click()};
const pin=async title=>{await menu(title);select('Pin');await frames()};
const pins=()=>document.querySelector('[aria-label="Pinned"]');
const titles=()=>pins()?[...pins().querySelectorAll('.noa-marquee-content')].map(node=>node.textContent):[];
window.run=async()=>{
 await render();await wait(()=>row('Older task'));
 const searchAction=document.querySelector('[aria-label="Search"]');const newAction=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='New task');
 if(searchAction.offsetHeight!==newAction.offsetHeight||getComputedStyle(searchAction).fontSize!==getComputedStyle(newAction).fontSize)throw Error('Search does not match New task');searchAction.click();if(searches!==1)throw Error('Search action did not run');
 const panel=await menu('Older task');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d');context.fillStyle=getComputedStyle(panel).backgroundColor;context.fillRect(0,0,1,1);const alpha=context.getImageData(0,0,1,1).data[3];
 select('Pin');
 const found=await wait(()=>pins()&&row('Older task',pins()));
 if(!found||alpha!==255)throw Error('Pin/menu regression: '+JSON.stringify({pinnedSection:found,menuAlpha:alpha}));
 if(row('Older task',document.querySelector('[aria-label="Recents"]')))throw Error('Pinned task remains in Recents');
 if(selected)throw Error('Pin selected the task');
 pins().querySelector('button').click();await frames();
 await pin('Other project task');
 if(titles().join('|')!=='Other project task|Older task')throw Error('Newest pin did not join the top');
 row('Other project task',pins()).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}));await frames();
 if(titles().join('|')!=='Older task|Other project task')throw Error('Pinned order cannot cross project boundaries');
 const from=row('Other project task',pins()).getBoundingClientRect(),to=row('Older task',pins()).getBoundingClientRect();
 await window.dragSidebar({x:Math.round(from.left+100),y:Math.round(from.top+from.height/2)},{x:Math.round(to.left+100),y:Math.round(to.top+2)});
 if(!await wait(()=>titles().join('|')==='Other project task|Older task'))throw Error('Native pinned drag did not reorder across projects');
 row('Older task',pins()).dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}));await frames();
 row('Older task',pins()).click();await frames();
 if(selected?.cwd!=='/alpha'||selected?.id!=='a')throw Error('Pinned task did not open its original workspace');
 root.render(null);await frames();await render();
 if(titles().join('|')!=='Older task|Other project task')throw Error('Pins or their order did not persist');
 const legacy=JSON.parse(localStorage.getItem('noa-agent.sessionPrefs'));delete legacy.pinnedOrder;root.render(null);await frames();localStorage.setItem('noa-agent.sessionPrefs',JSON.stringify(legacy));await render();
 if(titles().join('|')!=='Older task|Other project task')throw Error('Legacy pins were lost');
 document.querySelector('[data-project-group="/alpha"] [role="button"][title="/alpha"]').click();if(!await wait(()=>row('Latest task',document.querySelector('[data-project-group="/alpha"]'))))throw Error('Project did not expand');
 if(row('Older task',document.querySelector('[data-project-group="/alpha"]')))throw Error('Pinned task remains in project list');
 await menu('Older task');select('Unpin');await frames();
 if(!row('Older task',document.querySelector('[aria-label="Recents"]')))throw Error('Unpin did not restore Recents');
 if(!await wait(()=>titles().join('|')==='Other project task'))throw Error('Unpin did not remove pinned row');
 for(const nextTheme of ['light','dark']){theme=nextTheme;await render();if(!await wait(()=>(document.documentElement.dataset.theme??'light')===nextTheme))throw Error('Theme did not apply');await menu('Other project task');const panel=document.querySelector('[role="menu"]');context.clearRect(0,0,1,1);context.fillStyle=getComputedStyle(panel).backgroundColor;context.fillRect(0,0,1,1);if(context.getImageData(0,0,1,1).data[3]!==255)throw Error(nextTheme+' menu is transparent');await window.captureSidebar(nextTheme);window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await frames()}
 await menu('Other project task');select('Delete');await frames();
 if(!await wait(()=>!pins()))throw Error('Deleted task remains pinned');
 const prefs=JSON.parse(localStorage.getItem('noa-agent.sessionPrefs'));
 if(prefs.pinned['/beta']?.c||prefs.pinnedOrder?.includes('c'))throw Error('Deleted pin preference was not cleaned');
 return {opaqueMenus:true,pinMovesTask:true,unpinRestoresTask:true,persisted:true,legacyPins:true,searchAction:true,crossProjectOrder:true,nativeDrag:true,opensOriginalWorkspace:true,deletionCleanup:true};
};
`)
  const build = await Bun.build({ entrypoints: [join(temporary, "renderer.tsx")], outdir: temporary, target: "browser", define: { "process.env.NODE_ENV": '"production"' } })
  assert.ok(build.success, build.logs.join("\n"))
  const css = readdirSync(join(gui, "dist/assets")).find(name => name.endsWith(".css"))!
  writeFileSync(join(temporary, "index.html"), `<link rel="stylesheet" href="file://${join(gui, "dist/assets", css)}"><style>body{margin:0;background:var(--surface-page);color:var(--text-primary)}</style><div id="root"></div><script type="module" src="renderer.js"></script>`)
  writeFileSync(join(temporary, "main.cjs"), `
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs');
app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:800,height:700,show:false,webPreferences:{sandbox:false,contextIsolation:false,nodeIntegration:true}});
 try{
  fs.mkdirSync(${JSON.stringify(output)},{recursive:true});
  ipcMain.handle('capture-sidebar',async(_event,theme)=>{fs.writeFileSync(${JSON.stringify(output)}+'/'+theme+'.png',(await win.webContents.capturePage()).toPNG())});
  ipcMain.handle('drag-sidebar',async(_event,from,to)=>{
   win.webContents.sendInputEvent({type:'mouseMove',...from});
   win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...from});
   win.webContents.sendInputEvent({type:'mouseMove',...to});
   await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...to});
  });
  await win.loadFile(${JSON.stringify(join(temporary, "index.html"))});
  await win.webContents.executeJavaScript("window.captureSidebar=theme=>require('electron').ipcRenderer.invoke('capture-sidebar',theme);window.dragSidebar=(from,to)=>require('electron').ipcRenderer.invoke('drag-sidebar',from,to);void 0");
  const result=await win.webContents.executeJavaScript('window.run()');console.log(JSON.stringify(result));app.quit();
 }catch(error){console.error(error);app.exit(1)}
});
`)
  const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "inherit", stderr: "inherit" })
  const timer = setTimeout(() => child.kill(), 30_000)
  const code = await child.exited
  clearTimeout(timer)
  assert.equal(code, 0, "Sidebar fixture failed")
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
