import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(process.argv[2] ?? join(import.meta.dir, ".."))
const temp = mkdtempSync(join(tmpdir(), "noa-scroll-check-"))
const source = (path: string) => JSON.stringify(join(gui, path))
try {
  writeFileSync(join(temp, "renderer.ts"), `
import React from ${source("node_modules/react/index.js")};
import {createRoot} from ${source("node_modules/react-dom/client.js")};
import {MessageList} from ${source("src/components/MessageList.tsx")};
const turns=Array.from({length:60},(_,i)=>[{role:'user',id:'u'+i,text:'Prompt '+i},{role:'assistant',id:'a'+i,streaming:false,blocks:[{kind:'text',done:true,text:('Long line of explanation and measured text '.repeat(8)+'\\n\\n').repeat(i%3===0?18:2)}]}]).flat();
createRoot(document.getElementById('root')).render(React.createElement('div',{style:{height:700,display:'flex'}},React.createElement(MessageList,{turns,busy:false,readingWidth:700})));
`)
  const build = await Bun.build({ entrypoints: [join(temp, "renderer.ts")], outdir: temp, target: "browser" })
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
app.whenReady().then(async()=>{const w=new BrowserWindow({width:1100,height:800,show:false,webPreferences:{sandbox:true,backgroundThrottling:false}});await w.loadFile(${JSON.stringify(join(temp, "index.html"))});await new Promise(r=>setTimeout(r,1000));
const result=await w.webContents.executeJavaScript(\`new Promise(resolve=>{const e=document.querySelector('.noa-agent-scroll');const samples=[];const start=performance.now();e.scrollTop=e.scrollHeight*0.5;const requested=e.scrollTop;function tick(){const bounds=e.getBoundingClientRect();const row=[...e.querySelectorAll('[data-virtual-turn-id]')].find(n=>{const r=n.getBoundingClientRect();return r.bottom>bounds.top&&r.top<bounds.bottom});samples.push({scroll:e.scrollTop,id:row?.dataset.virtualTurnId,top:row?.getBoundingClientRect().top});if(performance.now()-start<500)requestAnimationFrame(tick);else resolve({requested,samples})}requestAnimationFrame(tick)})\`);
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify(result));app.quit()}).catch(e=>{console.error(e);app.exit(1)});
`)
  const child = Bun.spawn([electron, join(temp, "main.cjs")], { stdout: "ignore", stderr: "inherit" })
  const timer = setTimeout(() => child.kill(), 60_000)
  const exit = await child.exited
  clearTimeout(timer)
  if (exit !== 0) throw new Error(`Electron exited with ${exit}`)
  const { requested, samples } = await Bun.file(result).json() as { requested: number; samples: { scroll: number; id?: string; top?: number }[] }
  const visible = samples.filter(sample => sample.id)
  const maxJump = Math.max(0, ...samples.slice(1).map((sample, index) => Math.abs(sample.scroll - samples[index]!.scroll)))
  if (requested < 1000 || visible.length < 2 || maxJump > 200) throw new Error(`Requested ${Math.round(requested)}px; scroll jumped ${Math.round(maxJump)}px; visible samples: ${visible.length}`)
  console.log(`Scroll check passed: ${visible.length} visible samples, largest correction ${Math.round(maxJump)}px`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
