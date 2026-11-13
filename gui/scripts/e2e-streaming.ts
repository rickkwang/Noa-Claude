import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

// Feeds seeded delta traces into a streaming assistant turn in a real Electron renderer and samples,
// every frame, how much text has started to fade in. Smoothness = even onset rate, no long gaps,
// no large clumps appearing at once; responsiveness = arrival-to-onset lag.

const gui = resolve(process.argv[2] ?? join(import.meta.dir, ".."))
const temp = mkdtempSync(join(tmpdir(), "noa-streaming-check-"))
const source = (path: string) => JSON.stringify(join(gui, path))

type Chunk = { t: number; text: string }
function seeded(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
function trace(kind: "steady" | "bursty" | "fast", text: string, length: number): Chunk[] {
  const random = seeded(7), chunks: Chunk[] = []
  let t = 200, i = 0, stalled = false
  while (i < length) {
    const [n, gap] = kind === "steady" ? [3 + Math.floor(random() * 6), 60 + random() * 40]
      : kind === "bursty" ? [30 + Math.floor(random() * 50), 250 + random() * 600]
        : [8 + Math.floor(random() * 10), 40 + random() * 30]
    t += gap
    // One 1.5s upstream stall a third of the way in.
    if (!stalled && i > length / 3) { t += 1500; stalled = true }
    chunks.push({ t: Math.round(t), text: text.slice(i, i + n) })
    i += n
  }
  return chunks
}
const EN = "The quick brown fox jumps over the lazy dog while the renderer keeps pace with the network. ".repeat(20)
const ZH = "流式输出的平滑程度取决于节拍器如何把网络到达的文本均匀地放到屏幕上，同时还要避免停顿和突然的大段跳出。".repeat(20)
// Delta timing recorded from a real provider, merged per millisecond: [ms after the first text, chars].
// Text arrives as bursts of small deltas a few ms apart, with the bursts seconds apart.
const RECORDED = [[0, 6], [1, 75], [3978, 19], [3979, 9], [3980, 7], [3981, 53], [3982, 15], [3983, 12], [4142, 8], [4143, 16], [4144, 23], [4145, 10], [4146, 21], [4147, 46], [4148, 15], [7284, 14], [7288, 3], [7289, 23], [7290, 32], [7291, 22], [7292, 12], [7450, 12], [7451, 16], [7452, 35], [7456, 32], [7457, 9]]
let offset = 0
const recorded = RECORDED.map(([t, n]) => ({ t: 200 + t!, text: ZH.slice(offset, offset += n!) }))
const scenarios = [
  { name: "zh-recorded", chunks: recorded },
  { name: "en-steady", chunks: trace("steady", EN, 900) },
  { name: "en-bursty", chunks: trace("bursty", EN, 900) },
  { name: "zh-steady", chunks: trace("steady", ZH, 600) },
  { name: "zh-bursty", chunks: trace("bursty", ZH, 600) },
  { name: "zh-fast", chunks: trace("fast", ZH, 900) },
]

try {
  writeFileSync(join(temp, "renderer.ts"), `
import React from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {MessageList} from ${source("src/components/MessageList.tsx")};
const root=createRoot(document.getElementById('root'));
const frame=()=>new Promise(r=>requestAnimationFrame(r));
// Characters whose fade has started: text in the DOM minus segments still waiting out their delay.
function started(){
  const box=[...document.querySelectorAll('.noa-output-markdown')].pop();
  if(!box)return 0;
  // One document-wide query per frame; per-element getAnimations() costs ~0.4ms each and skews frames.
  let pending=0;
  for(const a of document.getAnimations()){const el=a.effect.target;if(el&&el.classList.contains('noa-stream-seg')&&box.contains(el)&&a.currentTime!==null&&a.currentTime<Number(a.effect.getTiming().delay||0))pending+=el.textContent.length}
  return box.textContent.length-pending;
}
async function run(sc,index){
  let text='',streaming=true;const id='a'+index,startedAt=Date.now();
  // A thinking block ahead of the answer makes the finished turn fold into the worked-for layout,
  // which remounts the answer; the reveal must carry on across that remount.
  // StrictMode as in App: its unmount/remount replay must not strand the reveal loop.
  const render=()=>root.render(React.createElement(React.StrictMode,null,React.createElement('div',{style:{height:700,display:'flex'}},React.createElement(MessageList,{turns:[{role:'assistant',id,streaming,blocks:[{kind:'thinking',text:'Plan the answer.',done:true,startedAt},{kind:'text',text,startedAt,done:!streaming}]}],busy:streaming,readingWidth:700}))));
  render();await frame();
  const t0=performance.now(),arrivals=[],samples=[];
  for(const c of sc.chunks)setTimeout(()=>{text+=c.text;arrivals.push({t:performance.now()-t0,len:text.length});render()},c.t);
  const end=sc.chunks[sc.chunks.length-1].t;
  setTimeout(()=>{streaming=false;render()},end+30);
  const total=sc.chunks.reduce((n,c)=>n+c.text.length,0);
  while(true){await frame();const t=performance.now()-t0;samples.push({t,n:started()});if(samples[samples.length-1].n>=total&&!streaming)break;if(t>end+20000)break}
  return {name:sc.name,arrivals,samples,total,hidden:document.hidden};
}
window.runAll=async scenarios=>{const out=[];for(let i=0;i<scenarios.length;i++)out.push(await run(scenarios[i],i));return out};
`)
  const build = await Bun.build({ entrypoints: [join(temp, "renderer.ts")], outdir: temp, target: "browser", define: { "process.env.NODE_ENV": JSON.stringify("development") } })
  if (!build.success) throw new Error(build.logs.join("\n"))
  const buildGui = Bun.spawn(["bun", "run", "build"], { cwd: gui, stdout: "ignore", stderr: "inherit" })
  if ((await buildGui.exited) !== 0) throw new Error("GUI build failed")
  const css = readdirSync(join(gui, "dist/assets")).find(name => name.endsWith(".css"))
  if (!css) throw new Error("GUI build produced no CSS")
  writeFileSync(join(temp, "index.html"), `<link rel="stylesheet" href="file://${join(gui, "dist/assets", css)}"><div id="root"></div><script type="module" src="renderer.js"></script>`)
  const result = join(temp, "result.json")
  writeFileSync(join(temp, "main.cjs"), `
const {app,BrowserWindow}=require('electron'),fs=require('fs');
app.setPath('userData',${JSON.stringify(join(temp, "profile"))});
app.whenReady().then(async()=>{const w=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});await w.loadFile(${JSON.stringify(join(temp, "index.html"))});await new Promise(r=>setTimeout(r,800));
const out=await w.webContents.executeJavaScript('runAll('+${JSON.stringify(JSON.stringify(scenarios))}+')');
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify(out));app.quit()}).catch(e=>{console.error(e);app.exit(1)});
`)
  const child = Bun.spawn([electron, join(temp, "main.cjs")], { stdout: "ignore", stderr: "inherit" })
  const timer = setTimeout(() => child.kill(), 240_000)
  const exit = await child.exited
  clearTimeout(timer)
  if (exit !== 0) throw new Error(`Electron exited with ${exit}`)
  type Run = { name: string; arrivals: { t: number; len: number }[]; samples: { t: number; n: number }[]; total: number; hidden: boolean }
  const runs = await Bun.file(result).json() as Run[]
  const rows = runs.map(run => {
    if (run.hidden) throw new Error("Renderer reported document.hidden; pacing would be skipped")
    const { samples, arrivals, total } = run
    const firstAt = samples.find(s => s.n > 0)?.t
    if (firstAt === undefined) throw new Error(`${run.name}: no text was revealed`)
    const doneAt = samples.find(s => s.n >= total)?.t
    if (doneAt === undefined) throw new Error(`${run.name}: reveal stopped at ${samples[samples.length - 1]!.n} of ${total} chars`)
    // Onset per 100ms window across the reveal.
    const windows: number[] = []
    for (let t = firstAt; t < doneAt; t += 100) {
      const at = (x: number) => samples.filter(s => s.t <= x).pop()?.n ?? 0
      windows.push(at(t + 100) - at(t))
    }
    // Reveal speed per 500ms, printed so a run shows how evenly the text flowed.
    const speeds: number[] = []
    for (let t = firstAt; t < doneAt; t += 500) {
      const at = (x: number) => samples.filter(s => s.t <= x).pop()?.n ?? 0
      speeds.push((at(t + 500) - at(t)) * 2)
    }
    console.log(`${run.name} chars/s per 500ms: ${speeds.join(" ")}`)
    const mean = windows.reduce((a, b) => a + b, 0) / windows.length
    const cv = Math.sqrt(windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length) / mean
    let maxGap = 0, maxFrame = 0, lastGrowth = firstAt
    for (let i = 1; i < samples.length; i++) {
      const grew = samples[i]!.n - samples[i - 1]!.n
      if (grew > 0) { maxGap = Math.max(maxGap, samples[i]!.t - lastGrowth); lastGrowth = samples[i]!.t; maxFrame = Math.max(maxFrame, grew) }
    }
    const lag: number[] = []
    let prev = 0
    for (const a of arrivals) {
      for (let c = prev; c < a.len; c += 10) { const s = samples.find(x => x.n > c); if (s) lag.push(s.t - a.t) }
      prev = a.len
    }
    lag.sort((a, b) => a - b)
    const tail = doneAt - arrivals[arrivals.length - 1]!.t
    const longFrames = samples.slice(1).filter((s, i) => s.t - samples[i]!.t > 50).length
    return { scenario: run.name, cv: +cv.toFixed(2), maxGapMs: Math.round(maxGap), maxCharsPerFrame: maxFrame, lagP50: Math.round(lag[lag.length >> 1]!), lagP95: Math.round(lag[Math.floor(lag.length * .95)]!), tailMs: Math.round(tail), longFrames }
  })
  console.table(rows)
  // Text flows at an even speed with no visible stop, a few characters a frame, even across
  // multi-second gaps between clumps; the buffer that takes stays within a few seconds.
  const failures = rows.flatMap(row => [
    row.maxCharsPerFrame > 4 && `${row.scenario}: ${row.maxCharsPerFrame} chars appeared in one frame`,
    row.maxGapMs > 500 && `${row.scenario}: reveal stopped for ${row.maxGapMs}ms`,
    row.cv > (row.scenario.endsWith("recorded") ? 0.8 : 0.5) && `${row.scenario}: onset rate CV ${row.cv}`,
    row.lagP50 > 3000 && `${row.scenario}: median lag ${row.lagP50}ms`,
    row.tailMs > 4500 && `${row.scenario}: finished ${row.tailMs}ms after the stream`,
    row.longFrames > 0 && `${row.scenario}: ${row.longFrames} frames over 50ms`,
  ].filter(Boolean))
  if (failures.length) throw new Error(failures.join("\n"))
  console.log("Streaming check passed")
} finally {
  rmSync(temp, { recursive: true, force: true })
}
