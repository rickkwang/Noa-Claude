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
    await evaluate(() => {
      const original = WebSocket.prototype.send
      WebSocket.prototype.send = function(data) {
        if (JSON.parse(data).message?.content === 'GUI_SESSION_KEEP') {
          WebSocket.prototype.send = original
          this.close()
          return
        }
        return original.call(this, data)
      }
      const input = document.querySelector('textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'GUI_SESSION_KEEP')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Run task')
    await wait(() => document.body.textContent.includes('Noa did not confirm this message') && document.querySelector('textarea')?.value === 'GUI_SESSION_KEEP')
    await textButton('Reconnect')
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_KEEP' && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder))
    await click('Run task')
    await evaluate(async () => {
      const deadline = Date.now() + 5000
      while (document.querySelector('textarea')?.value !== '') {
        if (Date.now() > deadline) throw new Error('Acknowledged draft did not clear')
        await new Promise(requestAnimationFrame)
      }
      if (Object.keys(localStorage).some(key => key.startsWith('noa-agent.draft:') && localStorage.getItem(key) === 'GUI_SESSION_KEEP')) {
        throw new Error('The acknowledged draft is still in storage and would reappear on remount')
      }
    })
    await wait(() => !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled)
    console.log('PASS a dropped send keeps the draft through reconnect; acknowledged send clears it')
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
    await evaluate(() => { const row = document.querySelector('[data-project-group] > div > [aria-expanded=false]'); if (row) row.click() })
    const forkRow = () => [...document.querySelectorAll('[data-project-list] [role=button]')].find(row => row.querySelector('.noa-marquee-content')?.textContent.endsWith(' (fork)') && row.closest('[data-session-list]') && !row.dataset.sessionId)
    await wait(forkRow)
    const nesting = await evaluate(original => {
      const parent = document.querySelector('[data-project-list] [data-session-id=' + JSON.stringify(original) + ']')
      const child = [...document.querySelectorAll('[data-project-list] [role=button]')].find(row => row.querySelector('.noa-marquee-content')?.textContent.endsWith(' (fork)'))
      const toggle = parent?.querySelector('[aria-label="Hide nested sessions"]')
      return {
        parentTitle: parent?.querySelector('.noa-marquee-content')?.textContent,
        childTitle: child?.querySelector('.noa-marquee-content')?.textContent,
        sameFamily: !!parent && parent.parentElement.parentElement === child?.closest('[data-session-list] > div'),
        deeper: parseFloat(child?.style.paddingLeft) > parseFloat(parent?.style.paddingLeft),
        toggle: !!toggle,
      }
    }, original)
    if (!nesting.sameFamily || !nesting.deeper || !nesting.toggle || nesting.childTitle !== nesting.parentTitle + ' (fork)') throw new Error('Fork is not nested under its task: ' + JSON.stringify(nesting))
    await capture('fork-nested')
    await click('Hide nested sessions')
    await wait(() => !!document.querySelector('[aria-label="Show nested sessions"]') && ![...document.querySelectorAll('[data-project-list] [role=button]')].some(row => row.querySelector('.noa-marquee-content')?.textContent.endsWith(' (fork)')))
    await capture('fork-hidden')
    await click('Show nested sessions')
    await wait(forkRow)
    console.log('PASS the fork is titled "<task> (fork)", nests under its task and hides and shows with the toggle')
    const taskMenu = id => evaluate(id => document.querySelector('[data-project-list] [data-session-id=' + JSON.stringify(id) + '] [aria-label="Task options"]').click(), id)
    const key = keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }) }
    await taskMenu(original)
    await wait(() => !!document.querySelector('[role=menu][aria-label="Task options"]'))
    const menuItems = await evaluate(() => [...document.querySelectorAll('[role=menu][aria-label="Task options"] > .noa-context-menu-entry > [role=menuitem]')].map(item => item.textContent.trim()))
    if (JSON.stringify(menuItems) !== JSON.stringify(['Open in', 'PinP', 'RenameR', 'ForkF', 'DeleteD'])) throw new Error('Task menu items: ' + JSON.stringify(menuItems))
    await capture('task-row-menu')
    key('R')
    await wait(() => document.activeElement?.getAttribute('aria-label') === 'Task name')
    await evaluate(() => { const e = document.activeElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, 'GUI renamed task'); e.dispatchEvent(new Event('input', { bubbles: true })) })
    key('Enter')
    await wait(id => document.querySelector('[data-project-list] [data-session-id=' + JSON.stringify(id) + '] .noa-marquee-content')?.textContent === 'GUI renamed task', original)
    console.log('PASS the task menu lists Open in, Pin, Rename, Fork and Delete with letter keys, and R renames the task in place')
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
    // A rewound message goes in front of the user's own draft; rewinding further back swaps it, and undo
    // takes it out again, leaving the draft.
    const draft = text => evaluate(text => { const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,text);e.dispatchEvent(new Event('input',{bubbles:true})) }, text)
    await wait(() => { const buttons = [...document.querySelectorAll('[data-rewind]')]; return buttons.length === 2 && buttons.every(button => !button.disabled) })
    await draft('GUI_SESSION_DRAFT')
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_DRAFT')
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(-1).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_AFTER_REWIND\n\nGUI_SESSION_DRAFT')
    await capture('rewind-keeps-draft')
    await wait(() => { const buttons = [...document.querySelectorAll('[data-rewind]')]; return buttons.length === 1 && !buttons[0].disabled })
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(0).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_KEEP\n\nGUI_SESSION_DRAFT')
    await wait(() => [...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'Undo rewind' && !element.disabled))
    await textButton('Undo rewind')
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_DRAFT' && [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_SESSION_AFTER_REWIND')))
    console.log('PASS a rewound message joins the draft, a further rewind swaps it, and undo leaves the draft')
    // Rewinding the message sent right after an earlier rewind puts two markers side by side; only one shows.
    await draft('')
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(-1).click())
    await wait(() => document.querySelector('textarea')?.value === 'GUI_SESSION_AFTER_REWIND' && document.body.textContent.includes('Rewound to here'))
    const markers = () => evaluate(() => document.body.textContent.match(/Rewound/g)?.length ?? 0)
    if (await markers() !== 1) throw new Error('Rewinding to the same point twice showed ' + await markers() + ' markers')
    await capture('rewound-twice-one-marker')
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload() })
    await wait(() => !!document.querySelector('textarea') && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder) && document.body.textContent.includes('Rewound to here'))
    if (await markers() !== 1) throw new Error('Reload showed ' + await markers() + ' rewind markers')
    console.log('PASS rewinding to the same point twice leaves one marker, live and after reload')
    // Restoring only files leaves the chat as it is, so the dialog stays to confirm it.
    await draft('GUI_WRITE')
    await click('Run task')
    await wait(() => [...document.querySelectorAll('button')].some(element => element.textContent.trim() === 'Allow once'))
    await textButton('Allow once')
    await wait(() => !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled && !document.querySelector('[aria-label="Stop (Esc)"]') && [...document.querySelectorAll('[data-rewind]')].every(button => !button.disabled))
    await evaluate(() => [...document.querySelectorAll('[data-rewind]')].at(-1).click())
    await wait(() => !!document.querySelector('[role=dialog] [role=radiogroup]'))
    await textButton('Files only')
    await textButton('Restore files')
    await wait(() => document.querySelector('[role=dialog]')?.textContent.includes('Files restored'))
    await capture('files-restored')
    await textButton('Done')
    await wait(() => !document.querySelector('[role=dialog]') && [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_WRITE')) && document.body.textContent.includes('A rewind restored these files'))
    console.log('PASS restoring only files confirms it in the dialog and keeps the chat')
    await evaluate(() => document.querySelector('button[aria-label^="Project actions for "]').click())
    await textButton('Coordinator')
    await wait(fork => JSON.parse(localStorage.getItem('noa-agent.current')).resume !== fork && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder), fork)
    await wait(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Run task'))
    await send('GUI_COORDINATOR_READY')
    await wait(() => [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('GUI_COORDINATOR_READY')))
    const question = '/btw keep the draft until acknowledgment'
    await evaluate(() => {
      const original = WebSocket.prototype.send
      WebSocket.prototype.send = function(data) {
        if (JSON.parse(data).message?.content?.startsWith?.('Side question:')) {
          WebSocket.prototype.send = original
          this.close()
          return
        }
        return original.call(this, data)
      }
    })
    await evaluate(() => document.querySelector('textarea').focus())
    await draft(question)
    await evaluate(() => { const e = document.querySelector('textarea'); e.setSelectionRange(e.value.length, e.value.length); e.dispatchEvent(new Event('select', { bubbles: true })) })
    await click('Run task')
    await wait(question => document.body.textContent.includes('Noa did not confirm this message') && document.querySelector('textarea')?.value === question, question)
    await textButton('Reconnect')
    await wait(question => document.querySelector('textarea')?.value === question && !/Starting|disconnected/.test(document.querySelector('textarea').placeholder), question)
    await click('Run task')
    await wait(() => document.querySelector('textarea')?.value === '' && [...document.querySelectorAll('[data-virtual-turn-id]')].some(element => element.textContent.includes('Side question: keep the draft until acknowledgment')))
    console.log('PASS project /btw keeps an unconfirmed draft and clears it after acceptance')
    // Forking a task that is not open opens it and forks once it is ready.
    await wait(() => !!document.querySelector('[aria-label="Task actions"]') && !document.querySelector('[aria-label="Task actions"]').disabled)
    const coordinator = await evaluate(() => JSON.parse(localStorage.getItem('noa-agent.current')).resume)
    await taskMenu(original)
    await wait(() => !!document.querySelector('[role=menu][aria-label="Task options"]'))
    key('F')
    await wait(ids => { const id = JSON.parse(localStorage.getItem('noa-agent.current')).resume; return !ids.includes(id) && document.querySelector('[data-project-list] [data-session-id=' + JSON.stringify(ids[0]) + ']')?.closest('[data-session-list] > div')?.textContent.includes('GUI renamed task (fork)') }, [original, fork, coordinator])
    console.log('PASS Fork in the menu of a task that is not open forks that task')
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
