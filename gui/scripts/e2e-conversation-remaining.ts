import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import electron from "electron"

const gui = resolve(process.argv[2] ?? join(import.meta.dir, ".."))
const output = resolve(process.argv[3] ?? mkdtempSync(join(tmpdir(), "noa-remaining-checks-")))
const theme = process.argv[4] === "dark" ? "dark" : "light"
const temporary = mkdtempSync(join(tmpdir(), "noa-remaining-runtime-"))
const cwd = join(temporary, "workspace"), config = join(temporary, "config")
for (const folder of [cwd, config, output]) mkdirSync(folder, { recursive: true })
process.env.CLAUDE_CONFIG_DIR = config
const { initialState, reducer } = await import(join(gui, "src/agent/reducer.ts"))
const agents = await import(join(gui, "server/agents.ts"))
let emit = agents.emit
if (!emit) {
  const source = readFileSync(join(gui, "server/agents.ts"), "utf8")
  const start = source.indexOf("function emit("), end = source.indexOf("\nfunction write(", start)
  emit = new Function(new Bun.Transpiler({ loader: "ts" }).transformSync(source.slice(start, end)) + ";return emit")()
}
const run = { journal: [], clients: new Set() } as any
const stream = (event: any) => ({ kind: "agent", message: { type: "stream_event", parent_tool_use_id: null, event } })
const events = [
  { kind: "user", id: "u", content: "Read both files" },
  stream({ type: "message_start", message: { id: "m" } }),
  stream({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t0", name: "Read" } }),
  stream({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "Read" } }),
  { kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { id: "m", content: [{ type: "tool_use", id: "t0", name: "Read", input: { file_path: "a.ts" } }] } } },
  stream({ type: "content_block_stop", index: 0 }),
  stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"file_path":"b.ts"}' } }),
]
for (const event of events) emit(run, event)
let replay = initialState
for (const entry of run.journal) replay = reducer(replay, entry.kind === "user" ? { type: "user-sent", id: entry.id, content: entry.content } : { type: "agent", message: entry.message })
const sessions = await import(join(gui, "server/sessions.ts"))
const id = crypto.randomUUID(), project = sessions.projectDir(cwd)
mkdirSync(project, { recursive: true })
writeFileSync(join(project, `${id}.jsonl`), [
  { type: "user", uuid: "u", parentUuid: null, message: { content: "Inspect project" } },
  { type: "assistant", uuid: "a", parentUuid: "u", message: { content: [{ type: "tool_use", id: "agent", name: "Agent", input: { description: "Inspect project" } }] } },
  { type: "user", uuid: "r", parentUuid: "a", message: { content: [{ type: "tool_result", tool_use_id: "agent", content: "Launched" }] }, toolUseResult: { agentId: "child", status: "async_launched" } },
].map(entry => JSON.stringify({ cwd, ...entry })).join("\n"))
sessions.appendTimelineEvent(cwd, id, { turn: 1, afterUuid: "a", message: { type: "system", subtype: "task_notification", task_id: "child", tool_use_id: "agent", status: "completed", summary: "Project inspection finished." } })
const task = reducer(initialState, { type: "history", items: await sessions.loadHistory(cwd, id) })
const history: any[] = []
for (let i = 0; i < 41; i++) {
  history.push({ kind: "user", id: `u${i}`, text: `Turn ${i}` })
  if (!i) history.push({ kind: "agent", message: { type: "system", subtype: "hook_started", hook_id: "h", hook_name: "Background validation", hook_event: "PostToolUse" } })
  history.push({ kind: "agent", message: { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: `Reply ${i}` }] } } })
}
const page = sessions.historyPage(history)
let hooks = reducer(initialState, { type: "history", ...page })
hooks = reducer(hooks, { type: "agent", message: { type: "system", subtype: "hook_response", hook_id: "h", hook_name: "Background validation", hook_event: "PostToolUse", outcome: "success", output: "Validation completed." } })
hooks = reducer(hooks, { type: "history", ...sessions.historyPage(history, page.before), prepend: true })
writeFileSync(join(temporary, "scenarios.json"), JSON.stringify({ replay, task, hooks, cwd }))
const wave = Buffer.alloc(44 + 1600)
wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVE", 8); wave.write("fmt ", 12)
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(1600, 40)
writeFileSync(join(cwd, "tone.wav"), wave)
const fixture = readFileSync(join(import.meta.dir, "../tests/fixtures/conversation-remaining.tsx"), "utf8").replace(/from "\.\.\/\.\.\/src\/([^"]+)"/g, (_, path) => `from ${JSON.stringify(join(gui, "src", path))}`)
writeFileSync(join(temporary, "renderer.tsx"), fixture)
const require = createRequire(join(gui, "package.json"))
const built = await Bun.build({ entrypoints: [join(temporary, "renderer.tsx")], outdir: temporary, target: "browser", format: "esm", splitting: true, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "fixture-react", setup(build) { build.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path) })) } }] })
if (!built.success) throw new Error(built.logs.join("\n"))
const csp = readFileSync(join(gui, "index.html"), "utf8").match(/content="(default-src[^"]+)"/)![1]!
const css = readdirSync(join(gui, "dist/assets")).find(name => name.startsWith("index-") && name.endsWith(".css"))!
writeFileSync(join(temporary, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="/assets/${css}"><style>html,body{overflow-anchor:none;scroll-behavior:auto}body{margin:0;padding:24px;background:var(--bg-primary,#f9f9f7);color:var(--text-primary,#2d2d2b);font:var(--text-body,13px) system-ui}h2{font-size:15px;margin:0 0 16px}.grid:has(>section[data-case]){display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid>section[data-case]{min-height:190px;border:1px solid var(--divider-subtle,#dfdfda);border-radius:14px;background:var(--bg-card,#fff);padding:20px}p{margin:12px 0}@media(max-width:720px){.grid:has(>section[data-case]){grid-template-columns:minmax(0,1fr)}}</style><button id="background">Background control</button><div id="root"></div><script type="module" src="/renderer.js"></script>`)
const { mediaResponse } = await import(join(gui, "server/workspace.ts"))
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url)
  if (url.hostname !== "127.0.0.1" || request.headers.get("origin") && request.headers.get("origin") !== url.origin) return new Response("Forbidden", { status: 403 })
  if (url.pathname === "/api/media") {
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 })
    try { return await mediaResponse(cwd, url.searchParams.get("path") ?? "", request) } catch (error) { return new Response(String(error), { status: 400 }) }
  }
  const base = url.pathname.startsWith("/assets/") ? join(gui, "dist/assets") : temporary
  const path = resolve(base, url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/assets\//, "").replace(/^\//, ""))
  if (!path.startsWith(base + sep) || !existsSync(path)) return new Response(null, { status: 404 })
  return new Response(Bun.file(path))
} })
const resultPath = join(output, "checks.json")
rmSync(resultPath, { force: true })
const main = `const{app,BrowserWindow}=require('electron'),fs=require('fs');app.setPath('userData',${JSON.stringify(join(temporary, "profile"))});app.whenReady().then(async()=>{const win=new BrowserWindow({width:1440,height:1200,webPreferences:{sandbox:true,contextIsolation:true}});win.webContents.on('console-message',(...args)=>console.error('renderer:',args[0]?.message||args[2]||args));try{await win.loadURL('http://127.0.0.1:${server.port}/?theme=${theme}');await win.webContents.executeJavaScript('new Promise((resolve,reject)=>{const end=performance.now()+10000;function check(){if(typeof window.runChecks==="function")resolve(true);else if(performance.now()>end)reject(Error("Renderer did not initialize"));else requestAnimationFrame(check)}check()})');const result=await win.webContents.executeJavaScript('window.runChecks()');await win.webContents.executeJavaScript('window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(${JSON.stringify(join(output, "comparison.png"))},(await win.webContents.capturePage()).toPNG());Object.assign(result,await win.webContents.executeJavaScript('window.runLifecycleChecks()'));fs.writeFileSync(${JSON.stringify(join(output, "lifecycle.png"))},(await win.webContents.capturePage()).toPNG());Object.assign(result,await win.webContents.executeJavaScript('window.runVisualChecks()'));fs.writeFileSync(${JSON.stringify(join(output, "visual.png"))},(await win.webContents.capturePage()).toPNG());fs.writeFileSync(${JSON.stringify(join(output, "visual-metrics.json"))},JSON.stringify(await win.webContents.executeJavaScript('window.visualMetrics'),null,2));fs.writeFileSync(${JSON.stringify(join(output, "approval-card.png"))},(await win.webContents.capturePage(await win.webContents.executeJavaScript('window.approvalCardRect()'))).toPNG());const approvalPoint=await win.webContents.executeJavaScript('window.prepareApprovalPreview()');win.webContents.sendInputEvent({type:'mouseMove',...approvalPoint});Object.assign(result,await win.webContents.executeJavaScript('window.runApprovalPreviewChecks()'));fs.writeFileSync(${JSON.stringify(join(output, "approval-preview.png"))},(await win.webContents.capturePage()).toPNG());result.previewEscapeDoesNotApproveOrDeny=await win.webContents.executeJavaScript('window.closeApprovalPreview()');result.approvalResizeDismissal=await win.webContents.executeJavaScript('window.checkApprovalResizeDismissal()');win.webContents.sendInputEvent({type:'mouseMove',x:0,y:0});await win.webContents.executeJavaScript('window.scrollTo(0,0)');win.setContentSize(420,1100);result.narrowLayout=await win.webContents.executeJavaScript('window.checkNarrowVisual()');fs.writeFileSync(${JSON.stringify(join(output, "narrow-metrics.json"))},JSON.stringify(await win.webContents.executeJavaScript('window.narrowMetrics'),null,2));fs.writeFileSync(${JSON.stringify(join(output, "visual-narrow.png"))},(await win.webContents.capturePage()).toPNG());win.setContentSize(1440,1200);await win.webContents.executeJavaScript('window.mountLightbox()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});result.lightboxFocus=await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>resolve(!!document.activeElement.closest("[role=dialog]"))))');fs.writeFileSync(${JSON.stringify(join(output, "lightbox.png"))},(await win.webContents.capturePage()).toPNG());const save=await win.webContents.executeJavaScript(${JSON.stringify("!!document.querySelector('[aria-label=\"Save copy\"]')")});if(save){const saved=new Promise(resolve=>{win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(${JSON.stringify(join(output, "saved-image.png"))});item.once('done',(_event,state)=>resolve(state==='completed'))})});await win.webContents.executeJavaScript(${JSON.stringify("document.querySelector('[aria-label=\"Save copy\"]').click()")});result.imageSave=await Promise.race([saved,new Promise(resolve=>setTimeout(()=>resolve(false),3000))])}else result.imageSave=false;await win.webContents.executeJavaScript('window.mountNavigation()');const before=await win.webContents.executeJavaScript('window.navigationState()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Up',modifiers:['alt']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Up',modifiers:['alt']});const previous=await win.webContents.executeJavaScript('new Promise(resolve=>{const end=performance.now()+1200;function check(){const state=window.navigationState();if(state.id!=='+JSON.stringify(before.id)+'||performance.now()>end)resolve(state);else requestAnimationFrame(check)}check()})');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down',modifiers:['alt']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down',modifiers:['alt']});const next=await win.webContents.executeJavaScript('new Promise(resolve=>{const end=performance.now()+1200;function check(){const state=window.navigationState();if(state.id==='+JSON.stringify(before.id)+'||performance.now()>end)resolve(state);else requestAnimationFrame(check)}check()})');result.keyboardNavigation=before.id!==previous.id&&next.id===before.id;await win.webContents.executeJavaScript('window.mountBoundaryApp()');const boundaries=[];for(const width of [1440,1100,960]){win.setContentSize(width,900);const boundary=await win.webContents.executeJavaScript('window.inspectAppBoundary()');boundaries.push(boundary);fs.writeFileSync(${JSON.stringify(join(output, "app-"))}+width+'.png',(await win.webContents.capturePage()).toPNG())}result.appBoundaries=boundaries.every(check=>check.pass);win.setContentSize(960,600);const pending=await win.webContents.executeJavaScript('window.inspectPendingBoundary()');result.pendingBoundary=pending.pass;fs.writeFileSync(${JSON.stringify(join(output, "pending-boundary.json"))},JSON.stringify(pending,null,2));fs.writeFileSync(${JSON.stringify(join(output, "pending-boundary.png"))},(await win.webContents.capturePage()).toPNG());fs.writeFileSync(${JSON.stringify(join(output, "app-boundaries.json"))},JSON.stringify(boundaries,null,2));fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify(result,null,2));app.quit()}catch(error){fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({error:String(error)}));app.exit(1)}})`
new Bun.Transpiler({ loader: "js" }).transformSync(main)
writeFileSync(join(temporary, "main.cjs"), main)
const child = Bun.spawn([electron, join(temporary, "main.cjs")], { stdout: "ignore", stderr: "inherit" })
const deadline = setTimeout(() => child.kill(), 45000)
await child.exited
clearTimeout(deadline); server.stop(true)
const result = await Bun.file(resultPath).json()
console.log(JSON.stringify({ gui, output, theme, result }, null, 2))
if (Object.values(result).some(value => value !== true)) process.exitCode = 1
