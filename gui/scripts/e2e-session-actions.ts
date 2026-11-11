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
    await wait(() => !!document.querySelector('textarea') && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder))
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
    await wait(() => [...document.querySelectorAll('[data-rewind]')].filter(button => !button.disabled).length === 2)
    // No files changed after the message, so rewinding needs no choice: it happens at once.
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(-1).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_REMOVE')
    if (await evaluate(() => !!document.querySelector('[role=dialog]'))) throw new Error('Rewind without file changes opened a dialog')
    await wait(() => [...document.querySelectorAll('[data-virtual-turn-id]')].every(element => !element.textContent.includes('GUI_SESSION_REMOVE')))
    await wait(() => document.body.textContent.includes('Rewound to here'))
    await capture('rewound-conversation')
    console.log('PASS rewind without file changes skips the dialog, restores the prompt and marks the cut')
    const hasRemoved = () => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE'))
    await wait(() => [...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'Undo rewind' && !element.disabled))
    await textButton('Undo rewind')
    await wait(hasRemoved)
    await wait(() => document.querySelector('textarea')?.value === '' && !document.body.textContent.includes('Rewound to here'))
    await capture('rewind-undone')
    console.log('PASS undo brings the messages back and takes the untouched prompt out of the composer')
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload() })
    await wait(() => !!document.querySelector('textarea') && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder))
    await wait(hasRemoved)
    if (await evaluate(() => /Rewound|Rewind undone/.test(document.body.textContent))) throw new Error('An undone rewind left a marker after reload')
    console.log('PASS an undone rewind stays undone after reload and leaves no marker')
    // Rewinding twice before sending, then undoing, brings back the conversation as it was before both.
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(-1).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_REMOVE')
    await wait(() => ![...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')) && document.body.textContent.includes('Rewound to here'))
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(0).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_KEEP' && ![...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_KEEP')))
    await wait(() => [...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'Undo rewind' && !element.disabled))
    await textButton('Undo rewind')
    await wait(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')) && document.querySelector('textarea')?.value === '' && !document.body.textContent.includes('Rewound to here'))
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload() })
    await wait(() => !!document.querySelector('textarea') && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder))
    await wait(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')) && [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_KEEP')))
    if (await evaluate(() => /Rewound/.test(document.body.textContent))) throw new Error('Undoing two rewinds left a marker after reload')
    console.log('PASS one undo takes back every rewind since the last send, and it survives reload')
    // Rewinding again after an undo works like the first time.
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(-1).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_REMOVE')
    await wait(() => ![...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')) && document.body.textContent.includes('Rewound to here'))
    console.log('PASS rewinding again after an undo works')
    await evaluate(() => { const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'GUI_SESSION_AFTER_REWIND');e.dispatchEvent(new Event('input',{bubbles:true})) })
    await click('Run task')
    await wait(() => !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled)
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload() })
    await wait(() => !!document.querySelector('textarea') && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder))
    if (await evaluate(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_REMOVE')))) throw new Error('Removed prompt returned after reload')
    // Once a message follows the rewind, its marker is history: no undo, and wording that says what happened.
    await wait(() => document.body.textContent.includes('Rewound here · later messages were removed') && ![...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'Undo rewind'))
    console.log('PASS rewound conversation, its marker and continuation survive Electron reload')
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
