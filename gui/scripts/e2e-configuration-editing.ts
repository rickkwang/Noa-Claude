import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const output = mkdtempSync(join(tmpdir(), "noa-configuration-editing-e2e-"))
const fixture = Bun.spawn([process.execPath, "tests/bridge.e2e.ts"], {
  cwd: gui,
  env: { ...process.env, NOA_GUI_BROWSER_FIXTURE: "1" },
  stdout: "pipe",
  stderr: "inherit",
})
let resolveUrl: (url: string) => void
const ready = new Promise<string>((resolve) => { resolveUrl = resolve })
const read = (async () => {
  let log = ""
  for await (const chunk of fixture.stdout) {
    log += new TextDecoder().decode(chunk)
    const url = log.match(/BROWSER_FIXTURE (http:\/\/[^\s]+)/)?.[1]
    if (url) resolveUrl(url)
  }
})()
const main = String.raw`
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const [url, output] = process.argv.slice(2)
app.setPath('userData', output + '/profile')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1100, height: 760, show: true, webPreferences: { backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  const evaluate = (fn, ...args) => run('(' + fn.toString() + ')(' + args.map(value => JSON.stringify(value)).join(',') + ')')
  const wait = async (fn, ...args) => {
    const deadline = Date.now() + 25000
    while (!await evaluate(fn, ...args)) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + fn.toString())
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  const clickText = text => evaluate(text => [...document.querySelectorAll('button')].find(element => element.getClientRects().length && (element.textContent.trim() === text || element.getAttribute('aria-label') === text)).click(), text)
  const fill = (label, value) => evaluate((label, value) => { const e=document.querySelector('[aria-label=' + JSON.stringify(label) + ']'); Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, value); e.dispatchEvent(new Event('input', {bubbles:true})) }, label, value)
  const field = label => evaluate(label => document.querySelector('[aria-label=' + JSON.stringify(label) + ']')?.value, label)
  const capture = async name => { await run('Promise.all([...document.querySelectorAll(".noa-confirm-dialog")].flatMap(element => element.getAnimations()).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'); await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); fs.writeFileSync(output + '/' + name + '.png', (await win.webContents.capturePage()).toPNG()) }
  const failures = []
  const check = (value, label) => { console.log((value ? 'PASS ' : 'FAIL ') + label); if (!value) failures.push(label) }
  try {
    await win.loadURL(url)
    await wait(() => !!document.querySelector('textarea') && !document.querySelector('textarea').disabled)
    await clickText('Settings')
    await clickText('MCP servers')
    await clickText('Edit')
    await wait(() => [...document.querySelectorAll('button')].some(e => e.textContent === 'Add server'))
    await clickText('Add server')
    await fill('Server name', 'draft_probe')
    await fill('Server command', '/usr/bin/true')
    await fill('Server environment', 'ONE=1' + String.fromCharCode(10))
    check((await field('Server environment')).endsWith(String.fromCharCode(10)), 'environment keeps a typed trailing newline')
    await fill('Server environment', 'ONE=1' + String.fromCharCode(10) + 'TWO=two=2')
    await capture('mcp-form-light')
    await clickText('Cancel')
    const cancelDialog = await evaluate(() => [...document.querySelectorAll('[role=dialog]')].find(e => e.textContent.includes('Discard unsaved changes?')) != null)
    check(cancelDialog, 'closing a changed server form asks before discarding')
    if (cancelDialog) {
      await evaluate(() => [...document.querySelectorAll('[role=dialog]')].at(-1).querySelector('button').click())
      check(await field('Server name') === 'draft_probe', 'cancel discard keeps the server draft')
      await clickText('Cancel')
      await clickText('Discard')
    }
    await clickText('Configuration')
    await clickText('Edit')
    await wait(() => !!document.querySelector('[aria-label="allow rules"]'))
    await fill('allow rules', 'Read' + String.fromCharCode(10) + 'Bash(git status)')
    await clickText('Appearance')
    await clickText('Configuration')
    check(await field('allow rules') === 'Read' + String.fromCharCode(10) + 'Bash(git status)', 'switching settings pages preserves the permission draft')

    await evaluate(() => new Promise(resolve => {
      const saved=JSON.parse(localStorage.getItem('noa-agent.current'))
      const url=new URL('/ws',location.href); url.protocol='ws:'; url.search=new URLSearchParams({cwd:saved.cwd,runtime:saved.runtimeId}).toString()
      const socket=new WebSocket(url);window.__draftProbeSocket=socket
      socket.onopen=()=>{socket.send(JSON.stringify({type:'user',message:{role:'user',content:'GUI_SLOW_DRAFT_PROBE'},parent_tool_use_id:null}));resolve()}
    }))
    await wait(() => [...document.querySelectorAll('button')].find(e=>e.textContent==='Save rules')?.matches(':disabled'))
    await wait(() => ![...document.querySelectorAll('button')].find(e=>e.textContent==='Save rules')?.matches(':disabled'))
    check(await field('allow rules') === 'Read' + String.fromCharCode(10) + 'Bash(git status)', 'busy to idle transitions preserve unsaved permission rules')
    await evaluate(() => window.__draftProbeSocket.close())
    await evaluate(() => document.querySelector('[aria-label="allow rules"]').scrollIntoView({block:'center'}))
    await capture('permission-draft-light')
    await evaluate(() => document.querySelector('[aria-label="Back to app"]').click())
    const leaveDialog = await evaluate(() => [...document.querySelectorAll('[role=dialog]')].some(e => e.textContent.includes('Discard unsaved changes?')))
    check(leaveDialog, 'leaving settings protects unsaved rules')
    if (leaveDialog) {
      await evaluate(() => [...document.querySelectorAll('[role=dialog]')].at(-1).querySelector('button').click())
      check(await field('allow rules') === 'Read' + String.fromCharCode(10) + 'Bash(git status)', 'cancel leaving settings retains the rules')
      await clickText('Save rules')
      await wait(() => document.querySelector('[data-settings-surface]').textContent.includes('Permission rules saved.'))
      check(await evaluate(() => [...document.querySelectorAll('button')].find(e => e.textContent==='Save rules')?.disabled), 'unchanged rules cannot be saved again')
    }
    if (failures.length) throw new Error(failures.join('; '))
    fs.writeFileSync(output + '/result.json', JSON.stringify({ pass: true }))
    app.quit()
  } catch (error) {
    console.error(error)
    await capture('failure')
    fs.writeFileSync(output + '/result.json', JSON.stringify({ pass: false, error: String(error) }))
    app.exit(1)
  }
})
`
writeFileSync(join(output, "main.cjs"), main)
let child: ReturnType<typeof Bun.spawn> | undefined
const deadline = setTimeout(() => { fixture.kill(); child?.kill("SIGKILL") }, 90000)
try {
  const url = await Promise.race([ready, fixture.exited.then(code => { throw new Error(`Fixture exited: ${code}`) })])
  child = Bun.spawn([electron, join(output, "main.cjs"), url, output], { stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  const result = await Bun.file(join(output, "result.json")).json()
  console.log(JSON.stringify({ output, ...result }))
  if (code !== 0 || !result.pass) process.exitCode = 1
} finally {
  clearTimeout(deadline)
  fixture.kill("SIGTERM")
  await fixture.exited
  await read
}
