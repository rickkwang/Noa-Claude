// Renders the Files pane at a wide and a narrow width in Electron and checks the split layout:
// the tree stays beside the open file when wide, nothing overflows, and the tree resizes and hides.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const output = resolve(process.argv[2] ?? mkdtempSync(join(tmpdir(), "noa-files-split-")))
const temporary = mkdtempSync(join(tmpdir(), "noa-files-split-renderer-"))
mkdirSync(output, { recursive: true })
const source = (name: string) => JSON.stringify(join(gui, name))
writeFileSync(join(temporary, "renderer.ts"), `
import {createElement as h} from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {WorkspaceFiles} from ${source("src/components/WorkspaceFiles.tsx")};
import ThemeInjector from ${source("src/theme/ThemeInjector.tsx")};
import {defaultSettings} from ${source("src/theme/settings.ts")};
const longName='a-very-long-generated-file-name-that-must-truncate-inside-the-tree.ts';
const entries={'':[{name:'src',path:'src',directory:true},{name:longName,path:longName,directory:false},{name:'README.md',path:'README.md',directory:false}],src:[{name:'index.ts',path:'src/index.ts',directory:false}]};
const longLine='const value = '+JSON.stringify('x'.repeat(600))+';';
let fileLoads=0,referenced,copied,downloaded;const opened=[];
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text}}});
HTMLAnchorElement.prototype.click=function(){downloaded=this.download};
window.fetch=async (input,init)=>{const url=new URL(String(input),'http://fixture');const route=url.pathname.slice(5);
 if(route==='files')return Response.json({entries:entries[url.searchParams.get('path')??'']??[],truncated:false});
 if(route==='changes')return Response.json({isGit:false,branch:'',files:[],additions:0,deletions:0});
 if(route==='file')fileLoads++;
 if(route==='open-in'){opened.push(JSON.parse(init?.body??'{}').target);return Response.json({ok:true})}
 if(route==='file')return Response.json({kind:'text',content:[longLine,...Array.from({length:40},(_,i)=>'line '+i)].join('\\n'),revision:'1'});
 if(route==='editors')return Response.json({editors:[{type:'cursor',name:'Cursor'}]});
 return Response.json({})};
const root=createRoot(document.getElementById('root')),pause=(ms=200)=>new Promise(r=>setTimeout(r,ms));
const click=el=>el?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
const rowFor=name=>[...document.querySelectorAll('.noa-file-row')].find(row=>row.textContent.includes(name));
const noOverflow=()=>{const panel=document.querySelector('.noa-workspace-panel');const box=panel.getBoundingClientRect();return [...panel.querySelectorAll('*')].every(el=>{const r=el.getBoundingClientRect();return r.width===0||r.right<=box.right+0.5&&r.left>=box.left-0.5||el.closest('.noa-panel-body')})&&document.documentElement.scrollWidth<=innerWidth};
window.renderAt=async width=>{localStorage.clear();root.render(h('div',{style:{width,height:'100vh',display:'flex',flexDirection:'column',background:'var(--surface-page)',color:'var(--text-primary)'}},h(ThemeInjector,{settings:defaultSettings}),h('div',{id:'panel-files',style:{display:'flex',flex:1,minHeight:0,flexDirection:'column'}},h(WorkspaceFiles,{key:width,cwd:'/fixture',onReference(path){referenced=path},onOpenChanges(){}}))));await pause(400)};
window.wideChecks=async()=>{
 await window.renderAt(640);const checks={};
 const tree=()=>document.querySelector('.noa-files-tree');
 checks.wideSplits=!!document.querySelector('.noa-files-split')&&Math.round(tree()?.getBoundingClientRect().width)===250;
 checks.placeholder=document.querySelector('.noa-files-main')?.textContent.includes('Open files appear here');
 click(rowFor(longName));await pause(600);
 checks.fileBesideTree=!!tree()&&!!document.querySelector('.noa-files-main .noa-panel-body.is-code')&&!document.querySelector('[aria-label="Back to files"]');
 checks.activeRow=rowFor(longName)?.classList.contains('is-active');
 const main=document.querySelector('.noa-files-main').getBoundingClientRect(),side=tree().getBoundingClientRect();
 checks.columnsDoNotOverlap=main.right<=side.left+0.5&&side.right<=640.5;
 checks.longNameTruncates=rowFor(longName).scrollWidth<=rowFor(longName).clientWidth+1||getComputedStyle(rowFor(longName).querySelector('.noa-file-name')).textOverflow==='ellipsis';
 checks.wideNoOverflow=noOverflow();
 {const code=document.querySelector('.noa-files-main .noa-panel-body.is-code');checks.splitLinesWrap=!!code&&code.scrollWidth<=code.clientWidth+1;}
 const handle=document.querySelector('.noa-files-resize'),x=side.left;
 handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:x}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:x-200}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:x-200}));await pause();
 checks.resizeStopsAt60Percent=Math.round(tree().getBoundingClientRect().width)===384&&Math.round(document.querySelector('.noa-files-main').getBoundingClientRect().width)===256;
 await window.capture?.('wide-open');
 const now=tree().getBoundingClientRect().left;
 document.querySelector('.noa-files-resize').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:now}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:now+300}));window.dispatchEvent(new PointerEvent('pointerup',{clientX:now+300}));await pause();
 checks.dragHides=!tree()&&!!document.querySelector('[aria-label="Back to files"]');
 click(document.querySelector('[aria-label="Toggle file tree"]'));await pause();
 checks.toggleShows=!!tree();
 return checks};
window.compactChecks=async()=>{
 await window.renderAt(435);const checks={};
 const tree=document.querySelector('.noa-files-tree');
 checks.compactSplits=!!tree&&Math.round(tree.getBoundingClientRect().width)===215&&Math.round(document.querySelector('.noa-files-main').getBoundingClientRect().width)===220;
 checks.compactNoOverflow=noOverflow();
 return checks};
// Every entry of the open file's More actions menu does what it says.
window.menuChecks=async()=>{
 await window.renderAt(640);const checks={};
 click(rowFor('README.md'));await pause(600);
 const menu=()=>document.querySelector('.noa-files-head details.noa-review-menu');
 const item=async label=>{menu().open=true;await pause(50);const el=[...menu().querySelectorAll('[role^=menuitem]')].find(b=>b.textContent.startsWith(label));click(el);await pause(250);return el};
 menu().open=true;await pause(50);
 const labels=[...menu().querySelectorAll('[role^=menuitem]')].map(b=>b.textContent);
 checks.menuItems=['Find in file⌘F','Go to line⌃G','Word wrap','Attach as context','Copy path','Copy file contents','Download file','Cursor','Show in Finder','Reload file'].every(label=>labels.includes(label));
 checks.noNativeCheckbox=!menu().querySelector('input[type=checkbox]');
 const box=menu().querySelector('.noa-review-menu-content').getBoundingClientRect();checks.menuInsidePane=box.left>=0&&box.right<=640.5;
 menu().querySelector('summary').focus();menu().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));checks.menuArrowKeys=document.activeElement?.textContent.startsWith('Find in file');
 menu().open=false;
 await item('Find in file');checks.findOpens=!!document.querySelector('input[aria-label="Find in file"]');
 await item('Go to line');checks.gotoOpens=!!document.querySelector('input[aria-label="Go to line"]')&&!document.querySelector('input[aria-label="Find in file"]');
 await item('Find in file');checks.findReplacesGoto=!!document.querySelector('input[aria-label="Find in file"]')&&!document.querySelector('input[aria-label="Go to line"]');
 const wrap=await item('Word wrap');const code=document.querySelector('.noa-files-main .noa-panel-body.is-code');checks.wrapToggles=wrap.getAttribute('aria-checked')==='false'&&code.scrollWidth>code.clientWidth;await item('Word wrap');
 await item('Attach as context');checks.attach=referenced==='README.md';
 await item('Copy path');checks.copyPath=copied==='README.md';
 await item('Copy file contents');checks.copyContents=copied?.startsWith('const value');
 await item('Download file');checks.download=downloaded==='README.md';
 await item('Cursor');await item('Show in Finder');checks.openIn=opened.join(',')==='cursor,finder';
 const before=fileLoads;await item('Reload file');await pause(300);checks.reload=fileLoads>before;
 return checks};
window.narrowChecks=async()=>{
 await window.renderAt(400);const checks={};
 checks.narrowSingle=!document.querySelector('.noa-files-split')&&!document.querySelector('[aria-label="Toggle file tree"]');
 click(rowFor('README.md'));await pause(600);
 checks.narrowSwaps=!rowFor('README.md')&&!!document.querySelector('[aria-label="Back to files"]');
 checks.narrowNoOverflow=noOverflow();
 const code=document.querySelector('.noa-panel-body.is-code');checks.longLinesWrap=!!code&&code.scrollWidth<=code.clientWidth+1;
 return checks};
`)
const built = await Bun.build({ entrypoints: [join(temporary, "renderer.ts")], outdir: temporary, target: "browser", format: "esm", splitting: true, define: { "process.env.NODE_ENV": '"production"' } })
assert.ok(built.success, built.logs.join("\n"))
const css = readdirSync(join(gui, "dist/assets")).find(name => name.endsWith(".css"))!
writeFileSync(join(temporary, "index.html"), `<link rel="stylesheet" href="file://${join(gui, "dist/assets", css)}"><style>html,body{margin:0;height:100%;overflow:hidden}</style><div id="root"></div><script type="module" src="renderer.js"></script>`)
writeFileSync(join(temporary, "main.cjs"), `const {app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});app.whenReady().then(async()=>{const win=new BrowserWindow({width:900,height:700,show:true,webPreferences:{sandbox:true,backgroundThrottling:false}});const shot=async name=>fs.writeFileSync(${JSON.stringify(output)}+'/'+name+'.png',(await win.webContents.capturePage()).toPNG());try{await win.loadFile(${JSON.stringify(join(temporary, "index.html"))});await new Promise(r=>setTimeout(r,300));const wide=await win.webContents.executeJavaScript('window.wideChecks()');await shot('wide-tree-restored');const compact=await win.webContents.executeJavaScript('window.compactChecks()');await shot('compact-435');const menu=await win.webContents.executeJavaScript('window.menuChecks()');await win.webContents.executeJavaScript("document.querySelector('.noa-files-head details.noa-review-menu').open=true;new Promise(r=>setTimeout(r,200))");await shot('menu');const narrow=await win.webContents.executeJavaScript('window.narrowChecks()');await shot('narrow-file');fs.writeFileSync(${JSON.stringify(join(output, "checks.json"))},JSON.stringify({...wide,...compact,...menu,...narrow}));app.exit(0)}catch(error){console.error(error);app.exit(1)}})`)
const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "ignore", stderr: "inherit" })
const timer = setTimeout(() => child.kill(), 45_000)
const exit = await child.exited
clearTimeout(timer)
assert.equal(exit, 0, "Electron fixture failed")
const checks = await Bun.file(join(output, "checks.json")).json()
console.log(JSON.stringify({ output, checks }, null, 2))
assert.ok(Object.values(checks).every(value => value === true), "Files split checks failed")
