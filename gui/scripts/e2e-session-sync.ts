import assert from "node:assert/strict"
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"
import { historyPage, listSessions, loadHistory, projectDir } from "../server/sessions"

const gui = resolve(import.meta.dir, "..")
const build = Bun.spawn([process.execPath, "run", "build"], { cwd: gui, stdout: "ignore", stderr: "inherit" })
assert.equal(await build.exited, 0, "GUI build failed")
const temporary = mkdtempSync(join(tmpdir(), "noa-session-sync-e2e-"))
const cwd = join(temporary, "workspace")
const otherCwd = join(temporary, "other-workspace")
const missingCwd = join(temporary, "missing-workspace")
const originalConfig = process.env.CLAUDE_CONFIG_DIR
process.env.CLAUDE_CONFIG_DIR = join(temporary, "config")
mkdirSync(cwd)
mkdirSync(otherCwd)
mkdirSync(projectDir(cwd), { recursive: true })
mkdirSync(projectDir(otherCwd), { recursive: true })
const id = crypto.randomUUID()
const file = join(projectDir(cwd), `${id}.jsonl`)
const otherId = crypto.randomUUID()
const otherFile = join(projectDir(otherCwd), `${otherId}.jsonl`)
writeFileSync(otherFile, JSON.stringify({ type: "user", uuid: crypto.randomUUID(), cwd: otherCwd, timestamp: new Date().toISOString(), message: { content: "SYNC_OTHER_SAVED" } }) + "\n")
let unavailable = false
let requests = 0
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/api/info") return Response.json({ cwd })
    if (url.pathname === "/api/projects") return Response.json([
      { path: cwd, name: "Sync fixture", sources: [cwd], missing: false },
      { path: otherCwd, name: "Other fixture", sources: [otherCwd], missing: false },
      { path: missingCwd, name: "Missing fixture", sources: [missingCwd], missing: true },
    ])
    if (url.pathname === "/api/runs") return Response.json(unavailable ? [{ runtimeId: id, cwd, sessionId: id, busy: true, waiting: false, queued: 0 }] : [])
    if (url.pathname === "/api/sessions") {
      requests++
      if (url.searchParams.get("cwd") === missingCwd) return Response.json({ error: "cwd is not a directory" }, { status: 400 })
      if (url.searchParams.get("cwd") === otherCwd) return Response.json(listSessions(otherCwd))
      return unavailable ? Response.json({ error: "Temporarily unavailable" }, { status: 503 }) : Response.json(listSessions(cwd))
    }
    if (url.pathname === "/ws") {
      const resume = url.searchParams.get("resume")
      if (!resume) return new Response("missing resume", { status: 400 })
      return server.upgrade(request, { data: { resume } }) ? undefined : new Response("upgrade failed", { status: 426 })
    }
    if (url.pathname === "/fixture/create") {
      writeFileSync(file, [
        { type: "user", uuid: crypto.randomUUID(), cwd, timestamp: new Date().toISOString(), message: { content: "SYNC_ORIGINAL" } },
        { type: "ai-title", sessionId: id, aiTitle: "SYNC_CREATED" },
      ].map((entry) => JSON.stringify(entry)).join("\n") + "\n")
      return new Response("ok")
    }
    if (url.pathname === "/fixture/append") {
      appendFileSync(file, JSON.stringify({ type: "user", uuid: crypto.randomUUID(), cwd, timestamp: new Date().toISOString(), message: { content: "SYNC_HISTORY" } }) + "\n")
      return new Response("ok")
    }
    if (url.pathname === "/fixture/rename") {
      appendFileSync(file, JSON.stringify({ type: "custom-title", sessionId: id, customTitle: "SYNC_RENAMED" }) + "\n")
      return new Response("ok")
    }
    if (url.pathname === "/fixture/unavailable") {
      unavailable = true
      appendFileSync(otherFile, JSON.stringify({ type: "custom-title", sessionId: otherId, customTitle: "SYNC_OTHER_UPDATED" }) + "\n")
      return new Response("ok")
    }
    if (url.pathname === "/fixture/delete") { unavailable = false; rmSync(file); return new Response("ok") }
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") return new Response("Not used by fixture", { status: 404 })
    const path = resolve(gui, "dist", url.pathname === "/" ? "index.html" : `.${url.pathname}`)
    return path.startsWith(join(gui, "dist") + "/") ? new Response(Bun.file(path)) : new Response("Not found", { status: 404 })
  },
  websocket: {
    open(ws) {
      const resume = (ws.data as { resume?: string }).resume
      if (!resume) return
      void loadHistory(cwd, resume).then((items) => {
        if (items) ws.send(JSON.stringify({ kind: "history", ...historyPage(items) }))
      })
    },
    message(ws, raw) {
      let message: any
      try { message = JSON.parse(String(raw)) } catch { return }
      if (message.type !== "control_request") return
      const subtype = message.request?.subtype
      const response =
        subtype === "initialize"
          ? { models: [], commands: [], account: undefined }
          : subtype === "get_settings"
            ? { applied: { model: "fixture", effort: null }, effective: { permissions: { defaultMode: "default" } } }
            : {}
      ws.send(JSON.stringify({
        kind: "agent",
        message: { type: "control_response", response: { subtype: "success", request_id: message.request_id, response } },
      }))
    },
  },
})
try {
  const result = join(temporary, "result.json")
  writeFileSync(join(temporary, "main.cjs"), `
const {app,BrowserWindow,nativeTheme}=require('electron'),assert=require('node:assert/strict'),fs=require('fs');
nativeTheme.themeSource='light';
app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1280,height:820,show:true,webPreferences:{sandbox:true,backgroundThrottling:false}});
 try {
  await win.loadURL(${JSON.stringify(server.url.href)});
  const checks=await win.webContents.executeJavaScript(\`(async()=>{
   const pause=ms=>new Promise(r=>setTimeout(r,ms));
   const text=()=>document.body.innerText;
   const wait=async check=>{for(let i=0;i<80;i++){if(check())return;await pause(100)}throw new Error('Sidebar did not synchronize: '+text())};
   await wait(()=>text().includes('Sync fixture'));
   await wait(()=>text().includes('SYNC_OTHER_SAVED'));
   await pause(300);
   await fetch('/fixture/create');
   await wait(()=>text().includes('SYNC_CREATED'));
   document.querySelector('[title="SYNC_CREATED"]').click();
   await wait(()=>text().includes('SYNC_ORIGINAL'));
   await fetch('/fixture/append');
   await wait(()=>text().includes('SYNC_HISTORY'));
   await fetch('/fixture/rename');
   window.dispatchEvent(new Event('focus'));
   await wait(()=>text().includes('SYNC_RENAMED')&&!text().includes('SYNC_CREATED'));
   await fetch('/fixture/unavailable');
   await wait(()=>text().includes('SYNC_OTHER_UPDATED'));
   if(!text().includes('SYNC_RENAMED'))throw new Error('Transient failure cleared the sidebar');
   if(document.querySelector('[title="SYNC_RENAMED"] [role="status"]')?.getAttribute('aria-label')!=='Running')throw new Error('Failed project list blocked live run status');
   const draftKey='noa-agent.draft:'+${JSON.stringify(cwd)}+':'+${JSON.stringify(id)};
   const bookmarkKey='noa-agent.bookmarks.v2.'+${JSON.stringify(id)};
   localStorage.setItem(draftKey,'stale draft');
   localStorage.setItem(bookmarkKey,'["message"]');
   await fetch('/fixture/delete');
   await wait(()=>!text().includes('SYNC_RENAMED'));
   await wait(()=>!localStorage.getItem(draftKey)&&!localStorage.getItem(bookmarkKey));
   const current=JSON.parse(localStorage.getItem('noa-agent.current')||'null');
   if(current?.resume===${JSON.stringify(id)})throw new Error('Deleted session remained current');
   window.readSidebarColors=()=>{
    const sidebar=document.querySelector('.noa-sidebar-surface');
    const action=[...sidebar.querySelectorAll('button')].find(button=>button.innerText.trim()==='New task');
    const heading=sidebar.querySelector('.noa-sidebar-toolbar-mask button');
    const project=sidebar.querySelector('.noa-agent-sidebar-row');
    const searchIcon=sidebar.querySelector('.noa-sidebar-search svg');
    const iconInk=document.querySelector('[aria-label="Right panel"]');
    return {
     surface:getComputedStyle(sidebar).backgroundColor,
     searchSurface:getComputedStyle(sidebar.querySelector('.noa-sidebar-search')).backgroundColor,
     action:getComputedStyle(action).color,
     actionIcon:getComputedStyle(action.querySelector('svg')).color,
     fontSize:getComputedStyle(action).fontSize,
     fontWeight:getComputedStyle(action).fontWeight,
     lineHeight:getComputedStyle(action).lineHeight,
     project:getComputedStyle(project).color,
     projectIcon:getComputedStyle(project.querySelector('svg')).color,
     heading:getComputedStyle(heading).color,
     searchIcon:getComputedStyle(searchIcon).color,
     iconInk:getComputedStyle(iconInk).color,
    };
   };
   window.verifyFontSmoothing=async()=>{
    [...document.querySelectorAll('.noa-sidebar-surface button')].find(button=>button.innerText.startsWith('Settings')).click();
    await wait(()=>document.querySelector('[role="dialog"]'));
    [...document.querySelectorAll('[role="dialog"] nav button')].find(button=>button.innerText==='Appearance').click();
    await wait(()=>[...document.querySelectorAll('[role="dialog"] span')].some(span=>span.textContent==='Font smoothing'));
    const label=[...document.querySelectorAll('[role="dialog"] span')].find(span=>span.textContent==='Font smoothing');
    const toggle=label.parentElement.parentElement.querySelector('[role="switch"]');
    const samples=[];
    for(const enabled of [true,false,true]){
     if((toggle.getAttribute('aria-checked')==='true')!==enabled)toggle.click();
     const expected=enabled?'antialiased':'auto';
     await wait(()=>getComputedStyle(document.body).webkitFontSmoothing===expected);
     const elements=[...document.querySelectorAll('body,body *')];
     const mismatches=elements.filter(element=>getComputedStyle(element).webkitFontSmoothing!==expected);
     if(elements.length<100||mismatches.length)throw new Error('Font smoothing did not apply globally: '+mismatches.map(element=>element.tagName+'.'+element.className).join(','));
     samples.push({enabled,elements:elements.length});
    }
    document.querySelector('[aria-label="Back to app"]').click();
    return samples;
   };
   return {created:true,renamed:true,historyReloaded:true,temporaryFailureRetainedList:true,otherProjectUpdated:true,runStatusUpdated:true,deleted:true,browserStateCleared:true};
  })()\`);
  const light=await win.webContents.executeJavaScript('window.readSidebarColors()');
  assert.deepEqual(light,{
    surface:'rgb(247, 247, 245)',
    searchSurface:'rgba(250, 250, 248, 0.96)',
    action:'rgba(45, 45, 43, 0.85)',
    actionIcon:'rgba(45, 45, 43, 0.85)',
    fontSize:'14px',
    fontWeight:'430',
    lineHeight:'21px',
    project:'rgba(45, 45, 43, 0.85)',
    projectIcon:'rgba(45, 45, 43, 0.85)',
    heading:'rgba(45, 45, 43, 0.494)',
    searchIcon:'rgba(45, 45, 43, 0.65)',
    iconInk:'rgba(45, 45, 43, 0.65)',
  });
  fs.writeFileSync('/private/tmp/noa-session-sync-light.png',(await win.webContents.capturePage({x:0,y:0,width:340,height:820})).toPNG());
  nativeTheme.themeSource='dark';
  await win.webContents.executeJavaScript(\`new Promise((resolve,reject)=>{let tries=0;const check=()=>{if(document.documentElement.dataset.theme==='dark')resolve();else if(++tries>50)reject(new Error('Dark theme did not apply'));else setTimeout(check,50)};check()})\`);
  await new Promise(resolve=>setTimeout(resolve,250));
  const dark=await win.webContents.executeJavaScript('window.readSidebarColors()');
  assert.deepEqual(dark,{
    surface:'rgb(48, 48, 47)',
    searchSurface:'rgba(63, 63, 61, 0.96)',
    action:'rgba(249, 249, 247, 0.85)',
    actionIcon:'rgba(249, 249, 247, 0.85)',
    fontSize:'14px',
    fontWeight:'430',
    lineHeight:'21px',
    project:'rgba(249, 249, 247, 0.85)',
    projectIcon:'rgba(249, 249, 247, 0.85)',
    heading:'rgba(249, 249, 247, 0.498)',
    searchIcon:'rgba(249, 249, 247, 0.65)',
    iconInk:'rgba(249, 249, 247, 0.65)',
  });
  fs.writeFileSync('/private/tmp/noa-session-sync-dark.png',(await win.webContents.capturePage({x:0,y:0,width:340,height:820})).toPNG());
  checks.sidebarColors={light,dark};
  checks.fontSmoothing=await win.webContents.executeJavaScript('window.verifyFontSmoothing()');
  fs.writeFileSync(${JSON.stringify(result)},JSON.stringify(checks));app.quit();
 } catch(error){console.error(error);fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({error:String(error)}));app.exit(1)}
});`)
  const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "ignore", stderr: "inherit" })
  const timer = setTimeout(() => child.kill(), 45000)
  const exit = await child.exited
  clearTimeout(timer)
  assert.equal(exit, 0, "Electron fixture failed")
  const checks = JSON.parse(readFileSync(result, "utf8"))
  assert.ok(requests >= 4, `Only ${requests} session reads ran`)
  assert.deepEqual(checks.fontSmoothing.map((sample: { enabled: boolean }) => sample.enabled), [true, false, true])
  assert.ok(checks.fontSmoothing.every((sample: { elements: number }) => sample.elements >= 100))
  delete checks.fontSmoothing
  assert.deepEqual(checks, {
    created: true, renamed: true, historyReloaded: true, temporaryFailureRetainedList: true, otherProjectUpdated: true, runStatusUpdated: true, deleted: true, browserStateCleared: true,
    sidebarColors: {
      light: { surface: 'rgb(247, 247, 245)', searchSurface: 'rgba(250, 250, 248, 0.96)', action: 'rgba(45, 45, 43, 0.85)', actionIcon: 'rgba(45, 45, 43, 0.85)', fontSize: '14px', fontWeight: '430', lineHeight: '21px', project: 'rgba(45, 45, 43, 0.85)', projectIcon: 'rgba(45, 45, 43, 0.85)', heading: 'rgba(45, 45, 43, 0.494)', searchIcon: 'rgba(45, 45, 43, 0.65)', iconInk: 'rgba(45, 45, 43, 0.65)' },
      dark: { surface: 'rgb(48, 48, 47)', searchSurface: 'rgba(63, 63, 61, 0.96)', action: 'rgba(249, 249, 247, 0.85)', actionIcon: 'rgba(249, 249, 247, 0.85)', fontSize: '14px', fontWeight: '430', lineHeight: '21px', project: 'rgba(249, 249, 247, 0.85)', projectIcon: 'rgba(249, 249, 247, 0.85)', heading: 'rgba(249, 249, 247, 0.498)', searchIcon: 'rgba(249, 249, 247, 0.65)', iconInk: 'rgba(249, 249, 247, 0.65)' },
    },
  })
  console.log(`PASS Electron session sync with live history reload, missing/failed projects, run status, browser-state cleanup, Codex colors, and global font smoothing (${requests} reads)`)
} finally {
  server.stop(true)
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfig
  rmSync(temporary, { recursive: true, force: true })
}
