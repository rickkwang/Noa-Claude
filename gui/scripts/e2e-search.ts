import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import electron from "electron"
import { workspaceRequest } from "../server/workspace"

const gui = resolve(import.meta.dir, "..")
const temporary = mkdtempSync(join(tmpdir(), "noa-search-e2e-"))
const output = resolve(process.argv[2] ?? join(tmpdir(), "noa-search-checks"))
const cwd = join(temporary, "alpha"), other = join(temporary, "beta")
mkdirSync(join(cwd, "src"), { recursive: true })
mkdirSync(other)
mkdirSync(output, { recursive: true })
writeFileSync(join(cwd, "src/Sidebar.tsx"), "export const sidebar = true\n// SEARCH_TEXT_NEEDLE\n" + "// Background file content for the search overlay preview\n".repeat(40))
writeFileSync(join(cwd, "notes.md"), "Recent notes\n")
writeFileSync(join(other, "other.md"), "SEARCH_TEXT_NEEDLE\n")
let releaseSlow: (() => void) | undefined
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === "/fixture/slow-ready") return Response.json(!!releaseSlow)
  if (url.pathname === "/fixture/release-slow") { releaseSlow?.(); return new Response("ok") }
  if (url.pathname === "/api/editors") return Response.json({ editors: [] })
  if (url.pathname.startsWith("/api/")) {
    if (url.searchParams.get("cwd") !== cwd) return Response.json({ error: "Wrong search workspace" }, { status: 403 })
    if (url.searchParams.get("search") === "delayed") {
      await new Promise<void>(resolve => { releaseSlow = resolve })
      return Response.json({ entries: [{ path: "stale.ts", directory: false }] })
    }
    if (url.searchParams.get("search") === "failure") return Response.json({ error: "Fixture failure" }, { status: 500 })
    try { return Response.json(await workspaceRequest(url, cwd, undefined, request.signal)) }
    catch (error) { return Response.json({ error: String(error) }, { status: 400 }) }
  }
  const base = url.pathname.startsWith("/assets/") ? join(gui, "dist/assets") : temporary
  const path = resolve(base, url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/assets\//, "").replace(/^\//, ""))
  return path.startsWith(base + sep) ? new Response(Bun.file(path)) : new Response("Not found", { status: 404 })
} })
const source = (path: string) => JSON.stringify(join(gui, path))
try {
  symlinkSync(join(gui, "node_modules"), join(temporary, "node_modules"))
  writeFileSync(join(temporary, "renderer.tsx"), `
import React,{useState} from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {Sidebar} from ${source("src/components/Sidebar.tsx")};
import {SearchDialog} from ${source("src/components/SearchDialog.tsx")};
import {WorkspaceFiles} from ${source("src/components/WorkspaceFiles.tsx")};
import ThemeInjector from ${source("src/theme/ThemeInjector.tsx")};
import {defaultSettings} from ${source("src/theme/settings.ts")};
import {rememberFile} from ${source("src/lib/recentFiles.ts")};
const cwd=${JSON.stringify(cwd)},other=${JSON.stringify(other)};
const projects=[{path:cwd,name:'Alpha',sources:[cwd],missing:false},{path:other,name:'Beta',sources:[other],missing:false}];
const sessions={[cwd]:[{id:'a',title:'Inspect renderer',updatedAt:20,createdAt:1}],[other]:[{id:'b',title:'Review beta',updatedAt:10,createdAt:2}]};
window.actions=[];
function Fixture(){const [open,setOpen]=useState(false),[theme,setTheme]=useState('light'),[focus,setFocus]=useState(),[revision,setRevision]=useState(0);window.refreshTasks=()=>{sessions[other][0].updatedAt=30;setRevision(value=>value+1)};window.closeSearch=()=>setOpen(false);window.applyTheme=setTheme;return <><ThemeInjector settings={{...defaultSettings,appearance:{...defaultSettings.appearance,theme}}}/><div style={{display:'flex',height:'100vh'}}><div style={{width:300}}><Sidebar projects={projects} sessions={sessions} loadedProjects={new Set([cwd,other])} active={{cwd}} onNewSession={()=>{}} onSelect={()=>{}} onSearch={()=>setOpen(true)} onAddProject={()=>{}} onEditProject={()=>{}} onRemoveProject={()=>{}} onRevealProject={()=>{}} onDeleteSession={()=>{}} onSettings={()=>{}}/></div><div style={{flex:1,minWidth:0}}><WorkspaceFiles cwd={cwd} active refreshKey={0} focus={focus} onReference={()=>{}}/></div></div>{open&&<SearchDialog cwd={cwd} projects={projects} sessions={sessions} onNewSession={()=>window.actions.push('new')} onOpenFolder={()=>window.actions.push('folder')} onSelectSession={(path,id)=>window.selectedTask={path,id}} onOpenFile={(path,line)=>{window.selectedFile={path,line};setFocus({path,line,at:Date.now()})}} onClose={()=>setOpen(false)}/>}</>}
const root=createRoot(document.getElementById('root'));root.render(<Fixture/>);
const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const wait=async check=>{const deadline=performance.now()+5000;while(!await check()&&performance.now()<deadline)await frames();if(!await check())throw Error('Search check timed out: '+JSON.stringify({actions:window.actions,task:window.selectedTask,file:window.selectedFile})+' '+document.body.innerText)};
const input=()=>document.querySelector('.noa-search-dialog input');
const options=()=>[...document.querySelectorAll('.noa-search-dialog [role="option"]')];
const option=label=>options().find(row=>row.querySelector('.noa-search-label')?.textContent===label);
const type=async value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}));await frames()};
const open=async()=>{document.querySelector('[aria-label="Search"]').focus();document.querySelector('[aria-label="Search"]').click();await wait(()=>document.querySelector('dialog[open]')&&document.activeElement===input())};
const close=async()=>{window.closeSearch();await frames()};
const tab=async label=>{[...document.querySelectorAll('[role="tab"]')].find(button=>button.textContent===label).click();await frames()};
const key=key=>input().dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
window.preview=async theme=>{await close();window.applyTheme(theme);await frames();await open();await wait(()=>(document.documentElement.dataset.theme??'light')===theme);return true};
window.runChecks=async()=>{
 await wait(()=>document.querySelector('[aria-label="Search"]'));
 const search=document.querySelector('[aria-label="Search"]'),newTask=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='New task');
 if(search.offsetHeight!==newTask.offsetHeight||getComputedStyle(search).fontSize!==getComputedStyle(newTask).fontSize||getComputedStyle(search).backgroundColor!==getComputedStyle(newTask).backgroundColor)throw Error('Sidebar Search does not match New task');
 rememberFile(other,'other.md');rememberFile(cwd,'notes.md');
 await open();
 if(!option('notes.md')||option('other.md'))throw Error('Recent files use the wrong workspace');
 if(document.querySelector('.noa-search-dialog').getBoundingClientRect().width!==768)throw Error('Command menu width does not match the reference');
 key('Enter');await wait(()=>window.actions.includes('new')&&!document.querySelector('dialog[open]'));
 await open();key('ArrowDown');await frames();key('Enter');await wait(()=>window.actions.includes('folder'));
 await open();await type('Review beta');await wait(()=>option('Review beta'));key('Enter');await wait(()=>window.selectedTask?.id==='b');
 if(window.selectedTask.path!==other)throw Error('Task search lost its original workspace');
 await open();await tab('Tasks');key('ArrowDown');await frames();if(option('Review beta')?.getAttribute('aria-selected')!=='true')throw Error('Could not select task before refresh');window.refreshTasks();await frames();if(option('Review beta')?.getAttribute('aria-selected')!=='true')throw Error('Live refresh moved the selected task');await close();
 await open();for(const expected of ['Actions','Tasks','Files','Text','All']){key('Tab');await wait(()=>document.querySelector('[role="tab"][aria-selected="true"]')?.textContent===expected)}
 await tab('Files');await type('Sidebar');await wait(()=>option('Sidebar.tsx'));option('Sidebar.tsx').click();
 await wait(()=>document.querySelector('.noa-code-view')?.textContent.includes('SEARCH_TEXT_NEEDLE'));
 await wait(()=>JSON.parse(localStorage.getItem('noa-agent.recentFiles')||'[]')[0]?.path==='src/Sidebar.tsx');
 await open();if(!option('Sidebar.tsx'))throw Error('Opened file did not appear in recents');
 await tab('Text');await type('SEARCH_TEXT_NEEDLE');await wait(()=>option('Sidebar.tsx:2'));key('Enter');await wait(()=>window.selectedFile?.line===2);
 if(window.selectedFile.path!=='src/Sidebar.tsx')throw Error('Text search opened the wrong file');
 await open();await tab('Files');await type('delayed');await wait(async()=>await(await fetch('/fixture/slow-ready')).json());
 await type('Sidebar');await wait(()=>option('Sidebar.tsx'));await fetch('/fixture/release-slow');await frames();if(option('stale.ts')||!option('Sidebar.tsx'))throw Error('Stale file search replaced the current query');
 await type('failure');await wait(()=>document.querySelector('.noa-search-dialog [role="alert"]'));await close();
 await open();
 return {sidebarAction:true,referenceWidth:true,quickActions:true,taskNavigation:true,stableSelection:true,keyboardTabs:true,fileSearch:true,recentFiles:true,textSearchLine:true,staleRequestsIgnored:true,searchErrorsVisible:true};
};
window.afterEscape=async()=>{await wait(()=>!document.querySelector('dialog[open]'));return document.activeElement===document.querySelector('[aria-label="Search"]')};
window.narrowCheck=()=>{const dialog=document.querySelector('dialog[open]'),rect=dialog.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight&&dialog.scrollWidth<=dialog.clientWidth+1};
`)
  const build = await Bun.build({ entrypoints: [join(temporary, "renderer.tsx")], outdir: temporary, target: "browser", splitting: true, define: { "process.env.NODE_ENV": '"production"' } })
  assert.ok(build.success, build.logs.join("\n"))
  const css = readdirSync(join(gui, "dist/assets")).find(name => name.endsWith(".css"))!
  writeFileSync(join(temporary, "index.html"), `<link rel="stylesheet" href="/assets/${css}"><style>body{margin:0;background:var(--surface-page);color:var(--text-primary)}</style><div id="root"></div><script type="module" src="renderer.js"></script>`)
  const result = join(output, "checks.json")
  writeFileSync(join(temporary, "main.cjs"), `
const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});
app.whenReady().then(async()=>{const win=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});try{
 await win.loadURL(${JSON.stringify(server.url.href)});const result=await win.webContents.executeJavaScript('window.runChecks()');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});result.escapeRestoresFocus=await win.webContents.executeJavaScript('window.afterEscape()');
 for(const theme of ['light','dark']){await win.webContents.executeJavaScript('window.preview('+JSON.stringify(theme)+')');fs.writeFileSync(${JSON.stringify(output)}+'/'+theme+'.png',(await win.webContents.capturePage()).toPNG())}
 win.setContentSize(420,600);await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');result.narrowLayout=await win.webContents.executeJavaScript('window.narrowCheck()');fs.writeFileSync(${JSON.stringify(result)},JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.quit();
}catch(error){console.error(error);app.exit(1)}});
`)
  const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "inherit", stderr: "inherit" })
  const timer = setTimeout(() => child.kill(), 45_000)
  const code = await child.exited
  clearTimeout(timer)
  assert.equal(code, 0, "Search fixture failed")
  assert.ok(Object.values(await Bun.file(result).json()).every(value => value === true))
} finally {
  server.stop(true)
  rmSync(temporary, { recursive: true, force: true })
}
