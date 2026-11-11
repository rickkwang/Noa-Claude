import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electron from 'electron'

const gui = resolve(process.argv[2] ?? join(import.meta.dir, '..'))
const output = resolve(process.argv[3] ?? mkdtempSync(join(tmpdir(), 'noa-window-state-')))
const temporary = mkdtempSync(join(tmpdir(), 'noa-window-state-app-'))
mkdirSync(output, { recursive: true })
const profile = join(temporary, 'appdata')
mkdirSync(profile, { recursive: true })
const statePath = join(profile, 'Noa Agent', 'window-state.json')
const wrapper = join(temporary, 'main.cjs')
writeFileSync(wrapper, `
const {app,screen}=require('electron');const fs=require('fs');
app.setPath('appData',${JSON.stringify(profile)});
const phase=process.argv[2],output=${JSON.stringify(output)},statePath=${JSON.stringify(statePath)};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async test=>{const end=Date.now()+5000;while(!test()){if(Date.now()>end)throw Error('Window transition timed out: '+phase);await pause(50)}};
app.once('browser-window-created',(_event,win)=>{
 const createdBounds=win.getBounds(),moves=[];win.on('move',()=>{if(moves.length<12)moves.push(win.getBounds())});
 win.webContents.once('did-finish-load',async()=>{
  try{
   await pause(300);
   const area=screen.getPrimaryDisplay().workArea;
   const initial={bounds:win.getBounds(),maximized:win.isMaximized(),fullScreen:win.isFullScreen(),minimized:win.isMinimized()};
   if(phase==='resize'||phase==='resize-close'){
    const width=Math.min(phase==='resize'?1120:1080,area.width-48),height=Math.min(phase==='resize'?720:680,area.height-48);
    win.setBounds({x:area.x+Math.floor((area.width-width)/2),y:area.y+Math.floor((area.height-height)/2),width,height});
    await pause(phase==='resize'?1200:50);
   }else if(phase==='minimize'){
    app.focus({steal:true});win.show();win.focus();await pause(300);
    win.minimize();await until(()=>win.isMinimized());await pause(1200);
   }else if(phase==='maximize'){
    win.maximize();await until(()=>win.isMaximized());await pause(1200);
   }else if(phase==='fullscreen'){
    win.setFullScreen(true);await until(()=>win.isFullScreen());await pause(1200);
   }else if(phase==='normal'){
    if(win.isFullScreen()){win.setFullScreen(false);await until(()=>!win.isFullScreen())}
    if(win.isMaximized()){win.unmaximize();await until(()=>!win.isMaximized())}
    await pause(1200);
   }
   const final={bounds:win.getBounds(),maximized:win.isMaximized(),fullScreen:win.isFullScreen()};
   let saved;try{saved=JSON.parse(fs.readFileSync(statePath,'utf8'))}catch{}
   fs.writeFileSync(output+'/'+phase+'.json',JSON.stringify({initial,final,saved,area,createdBounds,moves},null,2));
   if(phase==='resize')fs.writeFileSync(output+'/window.png',(await win.webContents.capturePage()).toPNG());
   win.close();
  }catch(error){fs.writeFileSync(output+'/error.json',JSON.stringify({phase,error:String(error),visible:win.isVisible(),minimizable:win.isMinimizable(),maximized:win.isMaximized(),fullScreen:win.isFullScreen()}));app.once('will-quit',()=>app.exit(1));win.close()}
 });
});
require(${JSON.stringify(join(gui, 'electron/main.cjs'))});
`)
const environment = { ...process.env }
if (environment.CLAUDECODE) for (const key of Object.keys(environment)) {
  if (key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_CODE_') || key === 'CLAUDECODE' || key === 'CLAUDE_EFFORT') delete environment[key]
}
environment.NOA_GUI_DEV = '0'
environment.CLAUDE_CONFIG_DIR = join(temporary, 'config')
environment.DISABLE_UPDATES = '1'
const same = (a: any, b: any) => ['x', 'y', 'width', 'height'].every(key => a?.[key] === b?.[key])
const checks: Record<string, boolean> = {}
const defaultFits = (sample: any) => sample.initial.bounds.width === Math.min(sample.area.width, Math.max(960, Math.min(1440, Math.round(sample.area.width * 0.9)))) && sample.initial.bounds.height === Math.min(sample.area.height, Math.max(600, Math.min(900, Math.round(sample.area.height * 0.9)))) && !sample.initial.maximized && !sample.initial.fullScreen
async function launch(phase: string) {
  const errorLog = join(output, phase + '.stderr.log')
  const child = Bun.spawn([electron, wrapper, phase], { env: environment, cwd: gui, stdout: 'ignore', stderr: Bun.file(errorLog) })
  const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
  const status = await child.exited
  clearTimeout(timer)
  if (status) throw new Error(`${phase} failed (${status}): ${await Bun.file(errorLog).text()}`)
  return Bun.file(join(output, phase + '.json')).json()
}
try {
  const resized = await launch('resize')
  const restored = await launch('probe-resized')
  checks.initialDefaultFitsDisplay = defaultFits(resized)
  checks.resizeSavedBeforeClose = same(resized.saved, resized.final.bounds)
  checks.reopenRestoresBounds = same(restored.initial.bounds, resized.final.bounds)
  if (!checks.resizeSavedBeforeClose || !checks.reopenRestoresBounds) throw new Error('Window size does not survive restart')
  await launch('maximize')
  const maximized = await launch('probe-maximized')
  checks.maximizedRestored = maximized.initial.maximized
  checks.maximizePreservesNormalBounds = same(maximized.saved, resized.final.bounds)
  const normal = await launch('normal')
  checks.unmaximizeRestoresNormalBounds = same(normal.final.bounds, resized.final.bounds)
  await launch('fullscreen')
  const fullscreen = await launch('probe-fullscreen')
  checks.fullScreenRestored = fullscreen.initial.fullScreen
  checks.fullScreenPreservesNormalBounds = same(fullscreen.saved, resized.final.bounds)
  await launch('normal')
  const offscreen = { ...resized.final.bounds, x: 100000, y: 100000, isMaximized: false, isFullScreen: false, displayBounds: { x: 100000, y: 100000, width: 13, height: 17 } }
  writeFileSync(statePath, JSON.stringify(offscreen))
  const placed = await launch('probe-offscreen')
  const { bounds } = placed.initial, { area } = placed
  checks.offscreenRestoredIntoWorkArea = bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height
  writeFileSync(statePath, '{invalid json')
  const invalid = await launch('probe-invalid')
  checks.invalidStateFallsBack = defaultFits(invalid)
  const oldDisplay = resized.saved.displayBounds
  writeFileSync(statePath, JSON.stringify({ ...resized.saved, x: resized.saved.x + 100000, y: resized.saved.y + 100000, displayBounds: { ...oldDisplay, x: oldDisplay.x + 100000, y: oldDisplay.y + 100000 } }))
  const relocated = await launch('probe-relocated-display')
  checks.relocatedDisplayKeepsRelativePosition = same(relocated.initial.bounds, resized.final.bounds)
  const minimized = await launch('minimize')
  const unminimized = await launch('probe-minimized')
  checks.minimizeDoesNotReplaceNormalBounds = same(minimized.saved, resized.final.bounds) && same(unminimized.initial.bounds, resized.final.bounds) && !unminimized.initial.minimized
  const quick = await launch('resize-close')
  const quickRestored = await launch('probe-quick-close')
  checks.closeFlushesBeforeDebounce = same(quick.final.bounds, quickRestored.initial.bounds)
  checks.atomicSaveLeavesNoTemporaryFile = !(await Bun.file(statePath + '.tmp').exists())
} catch (error) {
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: String(error) }, null, 2))
  process.exitCode = 1
}
if (!Object.keys(checks).length || Object.values(checks).some(value => !value)) process.exitCode = 1
writeFileSync(join(output, 'checks.json'), JSON.stringify(checks, null, 2))
writeFileSync(join(output, 'reproduction.json'), JSON.stringify({ command: `bun ${join(gui, 'scripts/e2e-window-state.ts')} ${gui} ${output}`, revision: Bun.spawnSync(['git', '-C', gui, 'rev-parse', 'HEAD']).stdout.toString().trim(), inputs: 'Actual desktop entrypoint launched repeatedly with an isolated Electron appData and CLI config; resize, maximize, fullscreen, missing display and invalid JSON. No provider messages sent.', observed: checks, exitStatus: process.exitCode ?? 0 }, null, 2))
console.log(JSON.stringify({ output, checks }, null, 2))
