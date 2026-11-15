// Real hook dispatch, child processes, and plugin file events; all state stays in /tmp.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const artifacts = mkdtempSync(join(tmpdir(), 'noa-hooks-e2e-'))
for (const name of Object.keys(process.env)) {
  if (/^(NOA_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(name)) delete process.env[name]
}
process.env.CLAUDE_CONFIG_DIR = join(artifacts, 'config')
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:1'
process.env.NODE_ENV = 'development'
;(globalThis as any).MACRO = { VERSION: '1.25.0' }
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
const state = await import('../src/bootstrap/state.js')
state.setIsInteractive(false)
state.setOriginalCwd(artifacts)
state.setProjectRoot(artifacts)
state.setCwdState(artifacts)
const { enableConfigs } = await import('../src/utils/config.js')
enableConfigs()
const hooks = await import('../src/utils/hooks.js')
const registry = await import('../src/utils/hooks/AsyncHookRegistry.js')
const { updateHooksConfigSnapshot } = await import('../src/utils/hooks/hooksConfigSnapshot.js')
const { runCleanupFunctions } = await import('../src/utils/cleanupRegistry.js')
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
const results: Array<Record<string, unknown>> = []
const failures: string[] = []
const context: any = { getAppState: () => ({ sessionHooks: new Map() }), options: { tools: [], mainLoopModel: 'claude-haiku-5-5' } }
function configure(hook?: object, event = 'PreToolUse') {
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR!, 'settings.json'), JSON.stringify({ model: 'claude-haiku-5-5', hooks: hook ? { [event]: [{ hooks: [hook] }] } : {} }))
  updateHooksConfigSnapshot()
}
async function dispatch(signal = new AbortController().signal) {
  for await (const _ of hooks.executePreToolHooks('Read', 'hook-fixture', {}, context, undefined, signal)) { /* drain */ }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitFor(check: () => boolean, timeout = 2500) {
  const deadline = performance.now() + timeout
  while (!check() && performance.now() < deadline) await sleep(20)
  assert.ok(check(), 'condition did not become true before its deadline')
}
async function check(name: string, run: () => Promise<object>) {
  try { results.push({ name, passed: true, ...await run() }) }
  catch (error) { failures.push(name); results.push({ name, passed: false, error: String(error) }) }
  finally { await registry.finalizePendingAsyncHooks() }
}

await check('async deadline', async () => {
  const pidFile = join(artifacts, 'deadline.pid')
  configure({ type: 'command', command: `echo $$ > ${quote(pidFile)}; sleep 2`, timeout: 0.1, async: true })
  await dispatch()
  await waitFor(() => existsSync(pidFile))
  const pid = Number(readFileSync(pidFile, 'utf8'))
  await sleep(300)
  assert.equal(alive(pid), false, 'async hook survived its timeout')
  return { timeoutMs: 100, observedMs: 300 }
})

await check('protocol async deadline', async () => {
  const pidFile = join(artifacts, 'protocol-deadline.pid')
  configure({ type: 'command', command: `printf '%s\\n' '{"async":true,"asyncTimeout":100}'; echo $$ > ${quote(pidFile)}; sleep 2`, timeout: 1 })
  await dispatch()
  await waitFor(() => existsSync(pidFile))
  const pid = Number(readFileSync(pidFile, 'utf8'))
  await sleep(300)
  assert.equal(alive(pid), false, 'protocol asyncTimeout was ignored')
  return { asyncTimeoutMs: 100, observedMs: 300 }
})

await check('async interrupt and hard cancellation', async () => {
  for (const reason of ['interrupt', 'cancel']) {
    const pidFile = join(artifacts, `${reason}.pid`)
    configure({ type: 'command', command: `echo $$ > ${quote(pidFile)}; sleep 2`, timeout: 1, async: true })
    const controller = new AbortController()
    await dispatch(controller.signal)
    await waitFor(() => existsSync(pidFile))
    const pid = Number(readFileSync(pidFile, 'utf8'))
    controller.abort(reason)
    await sleep(100)
    assert.equal(alive(pid), reason === 'interrupt', `unexpected process lifetime after ${reason}`)
    await registry.finalizePendingAsyncHooks()
  }
  return { interruptSurvives: true, hardCancelStops: true }
})

await check('inherited pipes close at the hook deadline', async () => {
  const pidFile = join(artifacts, 'descendant.pid')
  configure({ type: 'command', command: `sleep 0.8 & echo $! > ${quote(pidFile)}; printf 'tail-output'; exit 0`, timeout: 0.1 }, 'CwdChanged')
  const started = performance.now()
  const { results: output } = await hooks.executeCwdChangedHooks(artifacts, artifacts + '/next')
  const wallMs = performance.now() - started
  assert.ok(wallMs < 500, `inherited pipe held the hook for ${wallMs}ms`)
  assert.ok(output.length > 0 && output.every(r => !r.succeeded), 'terminated hook was reported as successful')
  const pid = Number(readFileSync(pidFile, 'utf8'))
  await waitFor(() => !alive(pid))
  return { timeoutMs: 100, wallMs, descendantStopped: true }
})

await check('permission decisions survive delayed descendant output', async () => {
  configure({ type: 'command', command: `(sleep 0.25; printf '%s\\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"late guard"}}') & exit 0`, timeout: 1 })
  const decisions: string[] = []
  const started = performance.now()
  for await (const result of hooks.executePreToolHooks('Read', 'delayed-guard', {}, context)) {
    if (result.permissionBehavior) decisions.push(result.permissionBehavior)
  }
  assert.deepEqual(decisions, ['deny'], 'hook denial was discarded before its configured timeout')
  return { timeoutMs: 1000, producerDelayMs: 250, wallMs: performance.now() - started, decisions }
})

await check('async structured output, stderr, and single delivery', async () => {
  for (const protocol of [false, true]) {
    configure({ type: 'command', command: `${protocol ? `printf '%s\\n' '{"async":true,"asyncTimeout":500}'; ` : ''}sleep 0.05; printf '%s\\n' '{"systemMessage":"expected"}'; printf 'diagnostic' >&2`, timeout: 1, ...(!protocol && { async: true }) })
    await dispatch()
    await sleep(150)
    const responses = await registry.checkForAsyncHookResponses()
    assert.equal(responses.length, 1)
    assert.deepEqual(responses[0]!.response, { systemMessage: 'expected' })
    assert.equal(responses[0]!.stderr, 'diagnostic')
    assert.deepEqual(await registry.checkForAsyncHookResponses(), [])
  }
  return { configAsync: true, protocolAsync: true, deliveredOnce: true }
})

await check('quiet async completion keeps its exit status', async () => {
  const events = await import('../src/utils/hooks/hookEvents.js')
  const responses: Array<{ exitCode?: number; outcome: string; stderr: string }> = []
  events.setAllHookEventsEnabled(true)
  events.registerHookEventHandler(event => { if (event.type === 'response') responses.push(event) })
  try {
    for (const code of [0, 7]) {
      configure({ type: 'command', command: `printf 'diagnostic' >&2; exit ${code}`, timeout: 1, async: true })
      await dispatch()
      await sleep(100)
      assert.deepEqual(await registry.checkForAsyncHookResponses(), [])
      assert.equal(responses.at(-1)?.exitCode, code)
      assert.equal(responses.at(-1)?.outcome, code === 0 ? 'success' : 'error')
      assert.equal(responses.at(-1)?.stderr, 'diagnostic')
    }
    return { quietSuccess: true, quietFailure: true }
  } finally { events.registerHookEventHandler(null); events.setAllHookEventsEnabled(false) }
})

await check('quiet SessionStart refreshes the environment cache', async () => {
  const env = await import('../src/utils/sessionEnvironment.js')
  env.invalidateSessionEnvCache()
  const before = await env.getSessionEnvironmentScript()
  assert.ok(!before?.includes('HOOK_E2E_READY'), 'fixture variable already existed')
  configure({ type: 'command', command: `sleep 0.1; printf '%s\\n' 'export HOOK_E2E_READY=1' >> "$CLAUDE_ENV_FILE"`, timeout: 1, async: true }, 'SessionStart')
  for await (const _ of hooks.executeSessionStartHooks('startup')) { /* drain */ }
  await sleep(250)
  assert.equal(readFileSync(await env.getHookEnvFilePath('SessionStart', 0), 'utf8').trim(), 'export HOOK_E2E_READY=1')
  assert.deepEqual(await registry.checkForAsyncHookResponses(), [])
  const after = await env.getSessionEnvironmentScript()
  assert.ok(after?.includes('export HOOK_E2E_READY=1'), 'completed hook left a stale environment cache')
  return { before, after }
})

await check('early stdin close is handled locally', async () => {
  const errors: string[] = []
  const onError = (error: any) => errors.push(String(error.code ?? error))
  process.on('uncaughtException', onError)
  try {
    configure({ type: 'command', command: 'exit 0', timeout: 1, async: true }, 'Notification')
    await hooks.executeNotificationHooks({ message: 'x'.repeat(2 * 1024 * 1024), notificationType: 'fixture' })
    await sleep(150)
    assert.deepEqual(errors, [], 'stdin error escaped to the global exception handler')
    return { inputBytes: 2 * 1024 * 1024, uncaughtErrors: errors }
  } finally { process.removeListener('uncaughtException', onError) }
})

await check('plugin environment hooks load, watch, and unload', async () => {
  configure()
  const plugin = join(artifacts, 'plugin')
  const cwd = join(artifacts, 'workspace')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(plugin, 'hooks'), { recursive: true })
  mkdirSync(cwd)
  const log = join(artifacts, 'events')
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'hook-fixture', version: '1.0.0' }))
  writeFileSync(join(plugin, 'hooks/hooks.json'), JSON.stringify({ hooks: {
    CwdChanged: [{ hooks: [{ type: 'command', command: `echo cwd >> ${quote(log)}` }] }],
    FileChanged: [{ matcher: '.env', hooks: [{ type: 'command', command: `echo file >> ${quote(log)}` }] }],
  } }))
  const watcher = await import('../src/utils/hooks/fileChangedWatcher.js')
  watcher.initializeFileChangedWatcher(artifacts)
  const plugins = await import('../src/utils/plugins/loadPluginHooks.js')
  const { clearPluginCache } = await import('../src/utils/plugins/pluginLoader.js')
  async function load(paths: string[]) {
    state.setInlinePlugins(paths)
    clearPluginCache('hook lifecycle E2E')
    plugins.clearPluginHookCache()
    await plugins.loadPluginHooks()
  }
  try {
    await watcher.onCwdChangedForHooks(artifacts, cwd)
    await load([plugin])
    await sleep(300)
    writeFileSync(join(cwd, '.env'), 'FIXTURE=1\n')
    await waitFor(() => existsSync(log) && readFileSync(log, 'utf8').includes('file'))
    await watcher.onCwdChangedForHooks(artifacts, cwd)
    assert.match(readFileSync(log, 'utf8'), /cwd/)
    await load([])
    const before = readFileSync(log, 'utf8')
    writeFileSync(join(cwd, '.env'), 'FIXTURE=2\n')
    await watcher.onCwdChangedForHooks(cwd, artifacts)
    await sleep(800)
    assert.equal(readFileSync(log, 'utf8'), before, 'removed plugin still received events')
    return { cwdDispatched: true, fileDispatched: true, removedPluginSilent: true }
  } finally { await load([]); await runCleanupFunctions() }
})

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' }).trim()
writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ command: 'bun scripts/e2e-hooks.ts', revision, model: 'claude-haiku-5-5', inputs: 'isolated synthetic hook commands, no model API calls', results, exitStatus: failures.length ? 1 : 0 }, null, 2))
console.log(JSON.stringify({ artifacts, results, failures }, null, 2))
process.exit(failures.length ? 1 : 0)
