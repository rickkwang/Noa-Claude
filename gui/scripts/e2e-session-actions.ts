import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const output = mkdtempSync(join(tmpdir(), "noa-session-actions-e2e-"))
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
  const win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  const evaluate = (fn, ...args) => run('(' + fn.toString() + ')(' + args.map(value => JSON.stringify(value)).join(',') + ')')
  const wait = async (fn, ...args) => {
    const deadline = Date.now() + 25000
    while (!await evaluate(fn, ...args)) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + fn.toString())
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const click = label => evaluate(label => document.querySelector('[aria-label=' + JSON.stringify(label) + ']').click(), label)
  const textButton = text => evaluate(text => [...document.querySelectorAll('button')].find(element => element.textContent.trim() === text).click(), text)
  const capture = async name => { await run('Promise.all([...document.querySelectorAll(".noa-confirm-dialog")].flatMap(element => element.getAnimations()).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))'); await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); fs.writeFileSync(output + '/' + name + '.png', (await win.webContents.capturePage()).toPNG()) }
  const send = async text => {
    await evaluate(text => { const e=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,text); e.dispatchEvent(new Event('input',{bubbles:true})) }, text)
    await click('Run task')
    await wait(() => !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled && !document.querySelector('[aria-label="Stop (Esc)"]'))
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  try {
    await win.loadURL(url)
    await wait(() => !!document.querySelector('textarea') && !document.querySelector('textarea').disabled)
    await send('GUI_SESSION_KEEP')
    await send('GUI_SESSION_REMOVE')
    const original = await evaluate(() => JSON.parse(localStorage.getItem('noa-agent.current')).resume)
    await click('Task actions')
    await wait(() => !!document.querySelector('[role=menu]'))
    await capture('task-menu')
    await textButton('Fork conversation')
    await wait(original => JSON.parse(localStorage.getItem('noa-agent.current')).resume !== original && !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled, original)
    const fork = await evaluate(() => JSON.parse(localStorage.getItem('noa-agent.current')).resume)
    if (!fork) throw new Error('Fork did not open a saved conversation')
    console.log('PASS task menu forks and opens a separate conversation')
    await wait(() => [...document.querySelectorAll('[aria-label="Rewind to this message"]')].length === 2)
    await evaluate(() => [...document.querySelectorAll('[aria-label="Rewind to this message"]')].at(-1).click())
    await wait(() => document.querySelector('[aria-label="Rewind conversation"]')?.textContent.includes('user message'))
    await capture('rewind-dialog')
    await evaluate(() => {
      const send = WebSocket.prototype.send
      WebSocket.prototype.send = function(data) {
        const message = JSON.parse(data)
        if (message.type === 'control_request' && message.request?.subtype === 'session_action' && message.request.dry_run) setTimeout(() => send.call(this, data), 200)
        else send.call(this, data)
      }
      document.querySelector('input[name="rewind-mode"]').closest('fieldset').querySelectorAll('input')[1].click()
    })
    await wait(() => document.querySelector('[aria-label="Rewind conversation"]')?.getAttribute('aria-busy') === 'true')
    if (!await evaluate(() => document.querySelector('[aria-label="Rewind conversation"] fieldset').disabled)) throw new Error('Restore scope stays interactive while its preview is pending')
    await evaluate(() => document.querySelector('[aria-label="Rewind conversation"] fieldset').querySelectorAll('input')[2].click())
    await wait(() => document.querySelector('[aria-label="Rewind conversation"]')?.getAttribute('aria-busy') === 'false')
    if (await evaluate(() => document.querySelector('[aria-label="Rewind conversation"]').textContent.includes('Stop running tasks'))) throw new Error('Rapid mode clicks collided in the bridge')
    await evaluate(() => document.querySelector('[aria-label="Rewind conversation"] fieldset').querySelectorAll('input')[0].click())
    await wait(() => document.querySelector('[aria-label="Rewind conversation"]')?.getAttribute('aria-busy') === 'false' && ![...document.querySelectorAll('[aria-label="Rewind conversation"] button')].find(e=>e.textContent==='Rewind')?.disabled)
    console.log('PASS restore previews show loading and prevent overlapping mode requests under transport latency')

    await textButton('Cancel')
    await wait(() => !document.querySelector('[aria-label="Rewind conversation"]'))
    if (!await evaluate(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')))) throw new Error('Cancel changed the conversation')
    console.log('PASS cancelling rewind leaves the conversation unchanged')
    await evaluate(() => [...document.querySelectorAll('[aria-label="Rewind to this message"]')].at(-1).click())
    await wait(() => document.querySelector('[aria-label="Rewind conversation"]')?.textContent.includes('user message'))
    await textButton('Rewind')
    await wait(() => !document.querySelector('[aria-label="Rewind conversation"]'))
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_REMOVE')
    if (await evaluate(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')))) throw new Error('Removed prompt remains visible')
    await capture('rewound-conversation')
    console.log('PASS rewind updates the visible conversation and restores the prompt for editing')
    await evaluate(() => { const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'GUI_SESSION_AFTER_REWIND');e.dispatchEvent(new Event('input',{bubbles:true})) })
    await click('Run task')
    await wait(() => !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled)
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload() })
    await wait(() => !!document.querySelector('textarea') && !document.querySelector('textarea').disabled)
    if (await evaluate(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')))) throw new Error('Removed prompt returned after reload')
    console.log('PASS rewound conversation and continuation survive Electron reload')
    fs.writeFileSync(output + '/result.json', JSON.stringify({ pass: true, original, fork }))
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
