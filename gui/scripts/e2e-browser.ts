// Real Electron views, PTY output, and the production preview IPC/preload, with disposable local servers.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import electron from 'electron'
import { attachTerminal, detachTerminal, terminalMessage, type TerminalSocketData } from '../server/terminal'

const gui = resolve(import.meta.dir, '..')
const temporary = mkdtempSync(join(tmpdir(), 'noa-browser-e2e-'))
const output = resolve(process.argv[2] ?? join(tmpdir(), 'noa-browser-checks'))
mkdirSync(output, { recursive: true })
const cookies: string[] = []
const website = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  cookies.push(request.headers.get('cookie') ?? '')
  const url = new URL(request.url)
  if (url.pathname === '/redirect' || url.pathname === '/frame-redirect') return Response.redirect('https://example.com/')
  return new Response(`<!doctype html><title>Local studio</title><style>body{font:16px system-ui;margin:36px;color:#292927;background:#f8f7f4}h1{font-size:36px}button,a{display:inline-block;padding:12px;border-radius:10px;border:1px solid #ddd;background:white;color:inherit}header{color:#777;font-size:13px}.card{margin-top:30px;border:1px solid #ddd;border-radius:18px;padding:24px;background:white}</style><header>LOCAL PREVIEW · DEVELOPMENT</header><h1>Your app, beside your code.</h1><p>This page runs in an isolated native browser view.</p><div class="card"><button id="counter" onclick="this.textContent=Number(this.textContent)+1">0</button> <a id="next" href="/next">Next page</a></div><input id="field" aria-label="Preview input"><a id="offline" href="http://127.0.0.1:1/">Offline service</a>${url.pathname === '/with-frame' ? '<iframe src="/frame-redirect"></iframe>' : ''}<script>window.loadedAt=Date.now()</script>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" } })
} })
const target = website.url.href
const originalShell = process.env.SHELL
process.env.SHELL = '/bin/sh'
const host = Bun.serve<TerminalSocketData>({ hostname: '127.0.0.1', port: 0,
  fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === '/terminal') {
      if (server.upgrade(request, { data: { kind: 'terminal', cwd: temporary, id: url.searchParams.get('id')!, cols: 80, rows: 20 } })) return
      return new Response('Upgrade failed', { status: 400 })
    }
    if (url.pathname.startsWith('/api/')) return Response.json({ entries: [], files: [], isGit: false, additions: 0, deletions: 0 })
    const base = url.pathname.startsWith('/assets/') ? join(gui, 'dist/assets') : temporary
    const path = resolve(base, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/assets\//, '').replace(/^\//, ''))
    return path.startsWith(base + sep) ? new Response(Bun.file(path)) : new Response('Not found', { status: 404 })
  }, websocket: { open: attachTerminal, message: terminalMessage, close: detachTerminal },
})
const source = (path: string) => JSON.stringify(join(gui, path))
try {
  symlinkSync(join(gui, 'node_modules'), join(temporary, 'node_modules'))
  writeFileSync(join(temporary, 'renderer.tsx'), `
import React,{useState,useEffect} from ${source('node_modules/react/index.js')};
import {createRoot} from ${source('node_modules/react-dom/client.js')};
import {RightPanel} from ${source('src/components/RightPanel.tsx')};
import {TerminalPanel} from ${source('src/components/TerminalPanel.tsx')};
import {PopupMenu} from ${source('src/components/PopupMenu.tsx')};
import {Markdown,OutputContext} from ${source('src/components/Markdown.tsx')};
import {initialState} from ${source('src/agent/reducer.ts')};
import ThemeInjector from ${source('src/theme/ThemeInjector.tsx')};
import {defaultSettings} from ${source('src/theme/settings.ts')};
import {loadBrowser,openBrowser,projectBrowser} from ${source('src/lib/browserTabs.ts')};
import {terminalTabs,terminalSession,closeTerminal} from ${source('src/lib/terminalSessions.ts')};
const cwd=${JSON.stringify(temporary)},target=${JSON.stringify(target)};
const forwardedKeys=[];
function Fixture(){const [folder,setFolder]=useState(cwd),[tab,setTab]=useState('new'),[tabs,setTabs]=useState([]),[newTab,setNewTab]=useState(true),[open,setOpen]=useState(true),[menu,setMenu]=useState(false),[theme,setTheme]=useState('light'),[width,setWidth]=useState(480),[state,setState]=useState(initialState);
 window.fixture={load:raw=>loadBrowser(folder,projectBrowser(folder).tabs[0],raw),keys:forwardedKeys,newTab:()=>{setNewTab(true);setTab('new')},open:()=>openBrowser(folder,target),folder:other=>setFolder(other?cwd+'/other':cwd),hide:()=>setOpen(false),show:()=>setOpen(true),menu:setMenu,theme:setTheme,width:setWidth,reply:()=>setState({...initialState,turns:[{role:'assistant',id:'reply',streaming:false,blocks:[{kind:'text',text:'Preview '+target+'reply'}]}]}),tabs:()=>projectBrowser(folder).tabs,terminal:()=>{const id=terminalTabs(cwd).ids[0];return id?terminalSession(cwd,id):null},closeTerminal:()=>{for(const id of terminalTabs(cwd).ids)closeTerminal(cwd,id)}};
 useEffect(()=>{const key=event=>{forwardedKeys.push({key:event.key,ctrl:event.ctrlKey,meta:event.metaKey});event.preventDefault()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[]);
 useEffect(()=>{const open=event=>{if(event.detail.cwd===folder){setOpen(true);setNewTab(false);setTab('browser')}};window.addEventListener('noa:open-browser',open);return()=>window.removeEventListener('noa:open-browser',open)},[folder]);
 return <><ThemeInjector settings={{...defaultSettings,appearance:{...defaultSettings.appearance,theme}}}/><div style={{display:'flex',height:'100vh',background:'var(--surface-page)',color:'var(--text-primary)'}}><main style={{flex:1,minWidth:0,padding:32,position:'relative'}}><h2>Build a local preview</h2><p>Run your app in the terminal. Open its address beside this conversation.</p><OutputContext.Provider value={{cwd:folder}}><Markdown text={'[Open local studio]('+target+')'}/></OutputContext.Provider><TerminalPanel cwd={cwd} open height={240} available={700} styleKey={theme} focusKey={0} onHeight={()=>{}} onHide={()=>{}} onDraggingChange={()=>{}} onMovedToRight={()=>{}}/></main><aside style={{width,display:open?'flex':'none',flexDirection:'column',borderLeft:'1px solid var(--border-default)'}}><RightPanel state={state} cwd={folder} open={open} tabs={tabs} onTabs={setTabs} newTab={newTab} onNewTab={setNewTab} tab={tab} onTab={value=>{if(['files','changes','activity','subagents'].includes(value))setTabs(t=>t.includes(value)?t:[...t,value]);setTab(value)}} onStopTask={()=>{}} onBottomTerminal={()=>{}} onReference={()=>{}} workspaceRefreshKey={0}/></aside></div>{menu&&<PopupMenu anchor={{left:innerWidth-240,top:130,bottom:100}} label="Preview test menu" onClose={()=>setMenu(false)} entries={[{label:'Menu stays above the preview',onSelect:()=>{}}]}/>}</>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`)
  const build = await Bun.build({ entrypoints: [join(temporary, 'renderer.tsx')], outdir: temporary, target: 'browser', splitting: true, define: { 'process.env.NODE_ENV': '"production"' } })
  assert.ok(build.success, build.logs.join('\n'))
  const css = readdirSync(join(gui, 'dist/assets')).find(name => name.endsWith('.css'))!
  writeFileSync(join(temporary, 'index.html'), `<link rel="stylesheet" href="/assets/${css}"><style>body{margin:0}</style><div id="root"></div><script type="module" src="renderer.js"></script>`)
  const terminalInput = `printf 'http://127.0.'; sleep 0.1; printf '0.1:${website.port}/\\n'\n`
  writeFileSync(join(temporary, 'main.cjs'), `
const {app,BrowserWindow,ipcMain,session,shell}=require('electron'),fs=require('fs'),assert=require('node:assert/strict');
const {registerPreview}=require(${source('electron/preview.cjs')});
app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))});let win;const close=registerPreview({ipcMain,getWindow:()=>win,blockedOrigins:()=>[${JSON.stringify(host.url.origin)}]});
ipcMain.handle('noa:set-sidebar-translucency',()=>{});const external=[];shell.openExternal=async url=>{external.push(url)};
app.whenReady().then(async()=>{win=new BrowserWindow({width:1200,height:800,show:true,webPreferences:{sandbox:true,contextIsolation:true,preload:${source('electron/preload.cjs')},backgroundThrottling:false}});
 win.webContents.on('did-navigate',close);
 win.webContents.setWindowOpenHandler(({url})=>{external.push(url);return {action:'deny'}});
 const evaluate=async code=>{try{return await win.webContents.executeJavaScript(code)}catch(error){console.error('Failed renderer expression:',code);throw error}},checks={},check=name=>{checks[name]=true;console.log('PASS '+name)};
 const wait=async(fn,label)=>{const deadline=Date.now()+12000;while(!await fn()){if(Date.now()>deadline)throw Error('Timed out: '+label);await new Promise(r=>setTimeout(r,40))}};
 const pages=()=>win.contentView.children.filter(view=>view.webContents&&view.webContents!==win.webContents),guest=()=>pages()[0]?.webContents;
 const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').click()')};
 const screenshot=async name=>fs.writeFileSync(${JSON.stringify(output)}+'/'+name+'.png',(await win.capturePage()).toPNG());
 try{
 await session.defaultSession.cookies.set({url:'http://127.0.0.1',name:'noa_token',value:'fixture-secret',httpOnly:true});
 await win.loadURL(${JSON.stringify(host.url.href)});await wait(()=>evaluate('!!window.fixture?.terminal()'), 'terminal mount');
 await wait(()=>evaluate('window.fixture.terminal().status==="ready"'), 'PTY connection');
 await evaluate(${JSON.stringify(`window.fixture.terminal().term.input(${JSON.stringify(terminalInput)},true)`)});
 await wait(()=>evaluate('document.querySelectorAll(".noa-suggested-site").length===1'), 'terminal suggestion');
 check('PTY output discovers a URL split between chunks');await screenshot('suggested-light');
 await evaluate('window.fixture.theme("dark")');await new Promise(r=>setTimeout(r,100));await screenshot('suggested-dark');await evaluate('window.fixture.theme("light")');
 await click('.noa-suggested-site > button');await wait(()=>pages().length===1&&guest().getTitle()==='Local studio','native page');
 await wait(()=>pages()[0].getVisible(),'visible native page');
 assert.equal(await guest().executeJavaScript('typeof window.noaDesktop'), 'undefined');assert.equal(await guest().executeJavaScript('typeof require'), 'undefined');
 assert.notEqual(guest().session,session.defaultSession);assert.equal((await guest().session.cookies.get({name:'noa_token'})).length,0);
 check('isolated native page loads despite frame-ancestors and has no app cookie or preload');
 const loaded=await guest().executeJavaScript('loadedAt');
 win.focus();guest().focus();
 const counter=await guest().executeJavaScript('(()=>{const r=document.getElementById("counter").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
 guest().sendInputEvent({type:'mouseDown',...counter,button:'left',clickCount:1});guest().sendInputEvent({type:'mouseUp',...counter,button:'left',clickCount:1});
 await wait(()=>guest().executeJavaScript('document.getElementById("counter").textContent==="1"'),'native click');check('native page accepts mouse input');
 await screenshot('preview-light');
 if(process.env.NOA_PREVIEW_CAPTURE){require('child_process').execFileSync('python3',[process.env.NOA_PREVIEW_CAPTURE,'--window-id',win.getMediaSourceId().split(':')[1],'--path',${JSON.stringify(join(output, 'preview-native.png'))}],{stdio:'inherit'})}

 await evaluate('window.fixture.open()');await new Promise(r=>setTimeout(r,100));assert.equal(pages().length,1);assert.equal(await guest().executeJavaScript('loadedAt'),loaded);check('reopening an address focuses its existing page');
 await evaluate('window.fixture.newTab()');await wait(()=>!pages()[0].getVisible(),'hidden tab');await evaluate('window.fixture.open()');await wait(()=>pages()[0].getVisible(),'restored tab');assert.equal(await guest().executeJavaScript('loadedAt'),loaded);check('switching tabs preserves the live page');
 await evaluate('window.fixture.folder(true)');await wait(()=>!pages()[0].getVisible(),'other project');await evaluate('window.fixture.folder(false)');await wait(()=>pages()[0].getVisible(),'original project');assert.equal(await guest().executeJavaScript('loadedAt'),loaded);check('project switch isolates tabs and preserves the original page');
 await evaluate('window.fixture.menu(true)');await wait(()=>!pages()[0].getVisible(),'menu overlay');await screenshot('menu');await evaluate('window.fixture.menu(false)');await wait(()=>pages()[0].getVisible(),'menu closed');
 await evaluate('document.documentElement.dataset.settingsOpen="true"');await wait(()=>!pages()[0].getVisible(),'settings overlay');await evaluate('delete document.documentElement.dataset.settingsOpen');await wait(()=>pages()[0].getVisible(),'settings closed');check('menus and settings stay above native content');
 for(const zoom of [0.8,1.25]){win.webContents.setZoomFactor(zoom);await evaluate('window.fixture.width(430)');await new Promise(r=>setTimeout(r,150));const rect=await evaluate('(()=>{const r=document.querySelector("[data-browser-panel] > div:last-child").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');const actual=pages()[0].getBounds();for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-Math.round(rect[key]*zoom))<=1,JSON.stringify({zoom,rect,actual}));}win.webContents.setZoomFactor(1);check('native bounds follow resizing and app zoom');
 await guest().executeJavaScript('document.getElementById("next").click()',true);await wait(()=>guest().getURL().endsWith('/next'),'navigation');await wait(()=>evaluate('!document.querySelector(".noa-browser-toolbar button").disabled'),'back enabled');await click('[aria-label="Go back"]');await wait(()=>guest().getURL()===${JSON.stringify(target)},'back');await click('[aria-label="Go forward"]');await wait(()=>guest().getURL().endsWith('/next'),'forward');check('back and forward track native history');
 const id=await evaluate('window.fixture.tabs()[0].id');

 const failures=[];
 const regression=async(name,run)=>{await evaluate('window.noaDesktop.preview.command('+JSON.stringify({action:'navigate',id,url:${JSON.stringify(target)}})+')');await wait(async()=>!guest().isLoading()&&await evaluate('!window.fixture.tabs()[0].error'),'regression reset');try{await run();check(name)}catch(error){failures.push(name+': '+error.message);console.error('FAIL '+name,error.message)}};
 await regression('subframe redirects do not fail the main preview',async()=>{
   await evaluate('window.noaDesktop.preview.command('+JSON.stringify({action:'navigate',id,url:${JSON.stringify(target)}+'with-frame'})+')');await new Promise(r=>setTimeout(r,400));
   assert.equal(await evaluate('window.fixture.tabs()[0].error??null'),null);assert.equal(pages()[0].getVisible(),true);
 });
 await regression('invalid address errors survive view visibility updates',async()=>{
   await evaluate('window.fixture.load("https://example.com/")');await new Promise(r=>setTimeout(r,150));assert.match(await evaluate('document.querySelector("[role=alert]")?.textContent??""'),/Enter a local/);
 });
 await regression('failed links retain their destination when retrying',async()=>{
   await guest().executeJavaScript('document.getElementById("offline").click()',true);await wait(()=>evaluate('!!window.fixture.tabs()[0].error'),'failed link');assert.equal(await evaluate('window.fixture.tabs()[0].url'),'http://127.0.0.1:1/');
   await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="Retry").click()');await wait(()=>evaluate('!!window.fixture.tabs()[0].error'),'retry failed destination');assert.equal(guest().getURL(),'http://127.0.0.1:1/');
 });
 await regression('focused previews forward app shortcuts and keep ordinary typing',async()=>{
   win.focus();guest().focus();await guest().executeJavaScript('document.getElementById("field").focus()');await evaluate('window.fixture.keys.length=0');
   for(const modifier of ['control','meta'])for(const keyCode of ['K','J','N',',']){guest().sendInputEvent({type:'keyDown',keyCode,modifiers:[modifier]});guest().sendInputEvent({type:'keyUp',keyCode,modifiers:[modifier]})}
   await new Promise(r=>setTimeout(r,150));assert.deepEqual(await evaluate('window.fixture.keys.map(event=>event.key.toLowerCase())'),['k','j','n',',','k','j','n',',']);assert.equal(await evaluate('window.fixture.keys.slice(0,4).every(event=>event.ctrl)&&window.fixture.keys.slice(4).every(event=>event.meta)'),true);
   guest().sendInputEvent({type:'keyDown',keyCode:'A'});guest().sendInputEvent({type:'char',keyCode:'a'});guest().sendInputEvent({type:'keyUp',keyCode:'A'});await wait(()=>guest().executeJavaScript('document.getElementById("field").value.includes("a")'),'ordinary typing');assert.equal(await evaluate('window.fixture.keys.length'),8);
 });
 await regression('modified terminal links keep the external browser path',async()=>{
   const before=external.length;for(const modifier of ['metaKey','ctrlKey'])await evaluate('window.fixture.terminal().term.options.linkHandler.activate(new MouseEvent("click",{'+modifier+':true}),'+JSON.stringify(${JSON.stringify(target)})+')');await new Promise(r=>setTimeout(r,100));assert.equal(external.length,before+2);await evaluate('window.fixture.terminal().term.options.linkHandler.activate(new MouseEvent("click"),'+JSON.stringify(${JSON.stringify(target)})+')');assert.equal(external.length,before+2);assert.equal(pages().length,1);
 });
 assert.deepEqual(failures,[],failures.join('; '));
 external.length=0;

 for(const url of ['file:///etc/passwd','javascript:alert(1)','http://user:pass@localhost:3000',${JSON.stringify(host.url.href)},'https://example.com/']){const result=await evaluate('window.noaDesktop.preview.command('+JSON.stringify({action:'navigate',id,url})+')');assert.ok(result.error,url)}check('IPC rejects external schemes, credentials, and the app server');await guest().executeJavaScript('for(let i=0;i<5;i++)window.open("https://example.com/popup")');assert.equal(external.length,0);await click('[aria-label="Open in browser"]');assert.equal(external.length,1);check('page scripts cannot launch external browsers; the toolbar remains user controlled');
 await evaluate('window.noaDesktop.preview.command('+JSON.stringify({action:'navigate',id,url:${JSON.stringify(target)}+'redirect'})+')');await wait(()=>evaluate('document.querySelector("[role=alert]")?.textContent.includes("only opens local")'),'blocked redirect');assert.ok(!guest().getURL().startsWith('https://example.com'));check('external redirects cannot leave the local preview');
 const offline='http://127.0.0.1:1/';await evaluate('window.noaDesktop.preview.command('+JSON.stringify({action:'navigate',id,url:offline})+')');await wait(()=>evaluate('!!document.querySelector("[role=alert]")'),'load error');assert.equal(await evaluate('window.fixture.tabs()[0].url'),offline);check('failed loads retain their attempted address and show a retry action');await click('[aria-label="Go back"]');await wait(async()=>await evaluate('!window.fixture.tabs()[0].error')&&pages()[0].getVisible(),'back recovers from failure');check('history navigation recovers from a load error');
 await evaluate('window.fixture.newTab()');await wait(()=>evaluate('!!document.querySelector(".noa-suggested-site")'),'suggestions again');await click('.noa-suggested-site > button:last-child');await wait(()=>evaluate('!document.querySelector(".noa-suggested-site")'),'dismissed');assert.equal(pages().length,1);check('dismissing a suggestion keeps its page and server');
 await evaluate('window.fixture.reply()');await wait(()=>evaluate('!!document.querySelector(".noa-suggested-site")'),'reply suggestion');check('completed assistant replies also suggest local URLs');
 const browserSelector='[data-tab="browser:'+id+'"]';await evaluate('document.querySelector('+JSON.stringify(browserSelector)+').click()');await evaluate('document.querySelector('+JSON.stringify(browserSelector)+').parentElement.querySelector(".noa-tab-close").click()');await wait(()=>pages().length===0,'closed native page');assert.equal((await fetch(${JSON.stringify(target)})).status,200);check('closing a browser tab destroys its view without stopping the server');
 await evaluate('document.querySelector("main a").click()');await wait(()=>pages().length===1&&guest().getTitle()==='Local studio','markdown link');check('conversation local links open a sidebar page');
 await evaluate('window.fixture.theme("dark")');await new Promise(r=>setTimeout(r,150));await screenshot('preview-dark');
 const beforeReload=guest();win.focus();win.webContents.focus();win.webContents.sendInputEvent({type:'mouseDown',x:80,y:80,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:80,y:80,button:'left',clickCount:1});await wait(()=>evaluate('navigator.userActivation.hasBeenActive'),'main user activation');let cancelled=false;win.webContents.once('will-prevent-unload',()=>{cancelled=true});await evaluate('void(window.onbeforeunload=event=>{event.returnValue=false})');win.reload();await wait(()=>cancelled,'cancelled reload');assert.equal(guest(),beforeReload);assert.equal(beforeReload.isDestroyed(),false);await evaluate('window.onbeforeunload=null');win.reload();await wait(()=>pages().length===0,'committed reload cleans views');await wait(()=>evaluate('!!window.fixture?.terminal()'),'reloaded fixture');check('cancelled reload preserves pages and committed reload destroys them');
 await evaluate('window.fixture.closeTerminal()');close();fs.writeFileSync(${JSON.stringify(join(output, 'checks.json'))},JSON.stringify(checks,null,2));app.quit();
 }catch(error){console.error(error);await screenshot('failure');close();app.exit(1)}});
`)
  const child = Bun.spawn([electron, join(temporary, 'main.cjs')], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, SHELL: '/bin/sh' } })
  const timeout = setTimeout(() => child.kill(), 90_000)
  const exit = await child.exited
  clearTimeout(timeout)
  assert.equal(exit, 0, `Electron preview fixture exited ${exit}; screenshots: ${output}`)
  assert.ok(cookies.length > 0)
  assert.ok(cookies.every(cookie => !cookie.includes('fixture-secret')), 'app cookie leaked to preview server')
  console.log(`PASS preview requests never carry the app cookie; artifacts: ${output}`)
} finally {
  process.env.SHELL = originalShell
  await host.stop(true)
  await website.stop(true)
  rmSync(temporary, { recursive: true, force: true })
}

// The terminal module’s exit handler closes any PTY still waiting in its reload grace period.
process.exit(0)
