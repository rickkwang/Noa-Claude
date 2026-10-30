import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import electron from "electron"

const gui = resolve(import.meta.dir, "..")
const output = mkdtempSync(join(tmpdir(), "noa-settings-e2e-"))
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
  const win = new BrowserWindow({ width: 1280, height: 900, show: true })
  const run = async (code) => { try { return await win.webContents.executeJavaScript(code) } catch (error) { console.error('Failed script:', code); throw error } }
  const capture = async (name) => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await new Promise(resolve => setTimeout(resolve, 150))
    fs.writeFileSync(output + '/' + name + '.png', (await win.webContents.capturePage()).toPNG())
  }
  const check = (value, label) => { if (!value) throw new Error(label); console.log('PASS ' + label) }
  const wait = async (code, label) => {
    const deadline = Date.now() + 20000
    while (!await run(code)) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + label)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const nav = async (label) => {
    await run("[...document.querySelectorAll('[data-settings-surface] nav button')].find(e => e.textContent.trim() === " + JSON.stringify(label) + ").click()")
    await wait("document.querySelector('[data-settings-surface] h1')?.textContent === " + JSON.stringify(label), label)
  }
  const select = async (label, value) => {
    await run("(() => { const row=[...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel===" + JSON.stringify(label) + "); const el=row.querySelector('select'); el.value=" + JSON.stringify(value) + ";el.dispatchEvent(new Event('change',{bubbles:true})); })()")
  }
  try {
    await win.loadURL(url)
    await wait("document.querySelector('textarea') && !document.querySelector('textarea').disabled", 'CLI initialization')
    await run("[...document.querySelectorAll('button')].find(e => e.textContent.trim().startsWith('Settings')).click()")
    await wait("!!document.querySelector('[data-settings-surface]')", 'settings open')
    await run("(() => {const input=document.querySelector('[aria-label=\"Search settings\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Code font size');input.dispatchEvent(new Event('input',{bubbles:true}));})()")
    await wait("[...document.querySelectorAll('[data-settings-surface] nav button')].some(e=>e.textContent.includes('Code font size'))", 'search results')
    await run("[...document.querySelectorAll('[data-settings-surface] nav button')].find(e=>e.textContent.includes('Code font size')).click()")
    await wait("document.querySelector('[data-settings-surface] h1').textContent === 'Appearance'", 'setting search destination')
    check(await run("(() => {const e=[...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel==='Code font size');const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()"), 'search scrolls to the matching setting')
    await nav('General')
    await select('Send shortcut', 'modifier-enter')
    await wait("JSON.parse(localStorage.getItem('noa-agent.composer')).sendShortcut === 'modifier-enter'", 'send shortcut stored')
    await run("[...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel==='Show context window usage').querySelector('button').click()")
    await wait("JSON.parse(localStorage.getItem('noa-agent.composer')).showContextUsage === false", 'context preference stored')
    await nav('Configuration')
    await wait("document.querySelector('[data-settings-surface] main').textContent.includes('User')", 'CLI configuration sources')
    check(await run("!![...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel==='Model').querySelector('select').value"), 'CLI applied model displayed')
    check(await run("!document.querySelector('[data-settings-surface] main').textContent.includes('enableAllProjectMcpServers')"), 'configuration sources show summaries instead of schema keys')
    check(await run("!!document.querySelector('[data-permission-kind=allow]') && !document.querySelector('[data-permission-kind=allow]').open"), 'permission rules start collapsed')
    await run("document.querySelector('[data-permission-kind=allow] summary').click()")
    await wait("document.querySelector('[data-permission-kind=allow]').open", 'permission rules expanded')
    check(await run("(() => {const list=document.querySelector('[data-permission-kind=allow] ul');return list.children.length===41 && list.getBoundingClientRect().height<=258 && getComputedStyle(list).userSelect==='text'})()"), 'long rule lists are bounded, selectable, and one rule per row')
    await capture('rules-expanded')
    await run("document.querySelector('[data-permission-kind=allow] summary').click()")
    await select('Current permissions', 'plan')
    await wait("[...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel==='Current permissions').querySelector('select').value === 'plan'", 'CLI permission response')
    await select('Current permissions', 'default')
    await nav('Hooks')
    await wait("document.querySelector('[data-settings-surface] main').textContent.includes('printf SETTINGS_HOOK')", 'CLI hook definition')
    check(await run("document.querySelector('[data-settings-surface] main').textContent.includes('PreToolUse')"), 'CLI hook event and command displayed')
    await nav('Skills & plugins')
    await wait("document.querySelector('[data-settings-surface] main').textContent.includes('/settings-probe')", 'CLI project skill')
    check(true, 'CLI project skills displayed')
    check(await run("(() => {const skill=document.querySelector('[data-skill=settings-probe]');const summary=skill.querySelector('summary');return !skill.open && summary.getBoundingClientRect().height<120 && !summary.textContent.includes('(user)') && !summary.textContent.includes('userSettings')})()"), 'long skill descriptions stay compact without duplicate source labels')
    await run("document.querySelector('[data-skill=settings-probe] summary').click()")
    check(await run("(() => {const details=document.querySelector('[data-skill=settings-probe] .noa-selectable');return details.textContent.length>1000 && details.getBoundingClientRect().height<=258})()"), 'full skill description remains available in bounded details')
    await capture('skills-expanded')

    await nav('MCP servers')
    await wait("[...document.querySelectorAll('[data-settings-label]')].some(e=>e.dataset.settingsLabel==='fixture'&&e.textContent.includes('connected'))", 'MCP connection')
    await run("[...document.querySelectorAll('[data-settings-surface] main button')].find(e=>e.textContent.trim()==='Disable').click()")
    await wait("[...document.querySelectorAll('[data-settings-surface] main button')].some(e=>e.textContent.trim()==='Enable'&&!e.disabled)", 'MCP disabled by CLI')
    await run("[...document.querySelectorAll('[data-settings-surface] main button')].find(e=>e.textContent.trim()==='Enable').click()")
    await wait("[...document.querySelectorAll('[data-settings-label]')].some(e=>e.dataset.settingsLabel==='fixture'&&e.textContent.includes('connected')&&!e.querySelector('button').disabled)", 'MCP enabled by CLI')
    await run("[...document.querySelectorAll('[data-settings-surface] main button')].find(e=>e.textContent.trim()==='Reconnect').click()")
    await wait("[...document.querySelectorAll('[data-settings-surface] main button')].some(e=>e.textContent.trim()==='Reconnect'&&!e.disabled)", 'MCP reconnect completed')
    check(true, 'MCP disable, enable, and reconnect work from settings')
    await capture('mcp')
    await nav('Appearance')
    await run("[...document.querySelectorAll('[data-settings-surface] main button')].find(e=>e.textContent.trim()==='Advanced').click()")
    await run("(() => {const e=[...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel==='UI font size').querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'16');e.dispatchEvent(new Event('input',{bubbles:true}));})()")
    await wait("JSON.parse(localStorage.getItem('noa-agent.appearance')).uiFontSize === 16", 'font preference changed')
    await run("[...document.querySelectorAll('[data-settings-surface] main button')].find(e=>e.textContent.trim()==='Reset to default').click()")
    await wait("JSON.parse(localStorage.getItem('noa-agent.appearance')).uiFontSize === 14", 'appearance reset')
    check(await run("JSON.parse(localStorage.getItem('noa-agent.composer')).sendShortcut === 'modifier-enter'"), 'appearance reset preserves composer preferences')
    await capture('appearance')
    await run("[...document.querySelectorAll('[data-settings-label]')].find(e=>e.dataset.settingsLabel==='Mode').querySelectorAll('button')[2].click()")
    await wait("document.documentElement.dataset.theme === 'dark'", 'dark theme applied')
    await nav('Configuration')
    await capture('configuration-dark')
    await nav('Hooks')
    await capture('hooks-dark')
    check(true, 'CLI settings render in dark mode')
    await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.reload() })
    await wait("document.querySelector('textarea') && !document.querySelector('textarea').disabled", 'reload initialized')
    check(await run("JSON.parse(localStorage.getItem('noa-agent.composer')).sendShortcut === 'modifier-enter' && !document.querySelector('[aria-label^=\"Context usage\"]')"), 'preferences survive reload and hide context indicator')
    await run("(() => {const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Explain /no-such-settings-command');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()")
    await wait("!!document.querySelector('#noa-slash-commands')", 'unmatched slash menu opened')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await new Promise(resolve => setTimeout(resolve, 200))
    check(await run("document.querySelector('textarea').value.includes('Explain /no-such-settings-command') && ![...document.querySelectorAll('.noa-selectable')].some(e=>e.textContent==='Explain /no-such-settings-command')"), 'unmatched slash does not bypass modifier Enter preference')
    await run("(() => {const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'SETTINGS_SHORTCUT_CHECK');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()")
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    check(await run("document.querySelector('textarea').value.includes('SETTINGS_SHORTCUT_CHECK')"), 'plain Enter does not send in modifier mode')
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['meta'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['meta'] })
    await wait("document.querySelector('textarea').value === ''", 'modifier Enter sent')
    await wait("document.querySelector('.noa-selectable')?.textContent.includes('SETTINGS_SHORTCUT_CHECK')", 'CLI transcript echo')
    check(true, 'modifier Enter sends through the real CLI')
    fs.writeFileSync(output + '/result.json', JSON.stringify({ pass: true }))
    app.quit()
  } catch (error) {
    console.error(error)
    console.error(await run("[...document.querySelectorAll('[data-settings-surface] nav button')].map(e=>e.textContent)"))
    fs.writeFileSync(output + '/failure.png', (await win.webContents.capturePage()).toPNG())
    fs.writeFileSync(output + '/result.json', JSON.stringify({ pass: false, error: String(error) }))
    app.exit(1)
  }
})
`
writeFileSync(join(output, "main.cjs"), main)
let child: ReturnType<typeof Bun.spawn> | undefined
const deadline = setTimeout(() => { fixture.kill(); child?.kill() }, 90000)
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
