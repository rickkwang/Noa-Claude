// Compiled CLI trust/memory/UI boundaries and source API-key verification.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-startup-e2e-')));
mkdirSync(artifacts, { recursive: true });
const definitions = [
  { name: 'verify-key-latch', verifyKey: true },
  { name: 'latch-usage', latchUsage: true, trust: true },
  { name: 'project-untrusted', trust: false, run: false },
  { name: 'project-untrusted-bidi', trust: false, run: false, projectName: 'project\u202eevil' },
  { name: 'project-trusted', trust: true, run: true },
  { name: 'parent-trust-only', trust: false, parentTrust: true, run: false },
  { name: 'declaring-folder-untrusted', trust: true, inherited: true, parentTrust: false, run: false },
  { name: 'declaring-folder-trusted', trust: false, inherited: true, parentTrust: true, run: true },
  { name: 'local-untrusted', trust: false, scope: 'local', run: false },
  { name: 'local-trusted', trust: true, scope: 'local', run: true },
  { name: 'user-helper', trust: false, scope: 'user', run: true },
  // Real TUI via tmux: /cd into an untrusted repository, confirm, and the trust lands on that repository.
  { name: 'cd-trust', cd: true, trust: true },
  { name: 'memory-ascii', memory: 'MEMORY_SENTINEL_', expected: 1 },
  { name: 'memory-cjk', memory: '汉'.repeat(20000), expected: 8333, marker: '汉', warning: 'everything after the first 8333 characters of line 1 was cut off' },
  { name: 'memory-emoji', memory: '🦊'.repeat(8000), expected: 6250, marker: '🦊', warning: 'everything after the first 6250 characters of line 1 was cut off' },
  // 200 kept rows plus the first dropped row, named in the warning.
  { name: 'memory-lines', memory: Array.from({ length: 201 }, (_, i) => `MEMORY_ROW_${i}`).join('\n'), expected: 201, marker: 'MEMORY_ROW_', warning: '1 of 201 lines were cut off, starting at line 201 ("MEMORY_ROW_200")' },
].filter(c => !option('--case') || c.name === option('--case'));
assert.ok(definitions.length, 'unknown case');
const secrets = { GITHUB_TOKEN: 'ghp_FixtureToken1234567890abcdef', NPM_TOKEN: 'npm-fixture-secret', DATABASE_URL: 'postgres://app:hunter2@db.invalid/app', PIP_INDEX_URL: 'https://ghp_FixtureToken1234567890abcdef@pypi.invalid/simple', npm_config_proxy: 'http://proxyuser:proxypass@proxy.invalid:8080', NOA_FIXTURE_PLAIN: 'visible', NOA_FIXTURE_FLAG_TOKEN: '1', JAVA_TOOL_OPTIONS: '-Dhttp.proxyPassword=hunter2pass', NOTIFY_URL: 'https://hooks.slack.com/services/T0FIXTURE/B0FIXTURE/abcdefghijklmnop', DEPLOY_PEM: '-----BEGIN OPENSSH PRIVATE KEY-----' };
const results = [];
try {
  for (const c of definitions) {
    const dir = join(artifacts, c.name), home = join(dir, 'home'), config = join(home, 'config'), parent = join(dir, 'parent'), project = join(parent, c.projectName ?? 'project');
    for (const p of [config, parent, project]) mkdirSync(p, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: parent });
    execFileSync('git', ['init', '-q'], { cwd: project });
    const markerFile = join(dir, 'helper-ran');
    const helper = join(dir, 'helper.sh');
    writeFileSync(helper, `#!/bin/sh\nprintf '%s\\n' "$(pwd -P)" "\${ANTHROPIC_API_KEY:-unset}" "\${GITHUB_TOKEN:-unset}" "\${NPM_TOKEN:-unset}" "\${DATABASE_URL:-unset}" "\${PIP_INDEX_URL:-unset}" "\${npm_config_proxy:-unset}" "\${NOA_FIXTURE_PLAIN:-unset}" "\${CLAUDE_CODE_MCP_SERVER_URL:-unset}" "\${JAVA_TOOL_OPTIONS:-unset}" "\${NOTIFY_URL:-unset}" "\${DEPLOY_PEM:-unset}" > '${markerFile}'\nprintf '{"x-probe":"executed"}'\n`, { mode: 0o700 });
    const requests = [];
    const server = createServer(async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      requests.push({ url: req.url, method: req.method, rpc: body.method, probe: req.headers['x-probe'], staticHeader: req.headers['x-static'], body });
      if (req.url.startsWith('/mcp')) {
        if (!('id' in body)) { res.writeHead(202); res.end(); return; }
        const result = body.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } : body.method === 'tools/list' ? { tools: [] } : {};
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })); return;
      }
      if (req.url.includes('/messages') && !req.url.includes('count_tokens')) {
        if ((c.verifyKey || c.latchUsage) && body.metadata) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'metadata: Extra inputs are not permitted' } })); return;
        }
        const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'BOUNDARY_OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
        if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
        const events = [
          { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'BOUNDARY_OK' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
          { type: 'message_stop' },
        ];
        res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')); return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":1}');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    let observation;
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const projects = { [realpathSync(project)]: { hasTrustDialogAccepted: c.trust ?? false }, [realpathSync(parent)]: { hasTrustDialogAccepted: c.parentTrust ?? false } };
      const globalConfig = { hasCompletedOnboarding: true, projects, customApiKeyResponses: { approved: ['local-dummy'], rejected: [] } };
      const settings = { enableAllProjectMcpServers: true };
      if (c.memory !== undefined) {
        const memory = join(dir, 'memory'); mkdirSync(memory); writeFileSync(join(memory, 'MEMORY.md'), c.memory);
        settings.autoMemoryEnabled = true; settings.autoMemoryDirectory = memory;
      } else {
        const serverConfig = { type: 'http', url: url + '/mcp?k=' + secrets.GITHUB_TOKEN, headers: { 'x-static': 'static' }, headersHelper: helper };
        if (c.scope === 'local') projects[realpathSync(project)].mcpServers = { fixture: serverConfig };
        else if (c.scope === 'user') globalConfig.mcpServers = { fixture: serverConfig };
        else {
          const declared = c.inherited ? parent : project; mkdirSync(join(declared, '.noa'));
          writeFileSync(join(declared, '.noa', 'mcp.json'), JSON.stringify({ mcpServers: { fixture: serverConfig } }));
        }
      }
      writeFileSync(join(config, '.config.json'), JSON.stringify(globalConfig));
      writeFileSync(join(config, 'settings.json'), JSON.stringify(settings));
      const env = { ...secrets, PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: 'local-dummy', ANTHROPIC_BASE_URL: url, DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_MAX_RETRIES: '0' };
      if (c.latchUsage) env.CLAUDE_CODE_MAX_RETRIES = '2';
      if (c.verifyKey) {
        const probe = join(dir, 'verify-key.ts');
        writeFileSync(probe, `globalThis.MACRO={VERSION:'test',DISPLAY_VERSION:'test'};
          const {enableConfigs}=await import(${JSON.stringify(join(repo, 'src/utils/config.ts'))}); enableConfigs();
          const {verifyApiKey}=await import(${JSON.stringify(join(repo, 'src/services/api/claude.ts'))});
          console.log(JSON.stringify([await verifyApiKey('local-dummy',false),await verifyApiKey('local-dummy',false)]));
          process.exit(0);`);
        const child = spawn('bun', [probe], { cwd: project, env: { ...env, NODE_ENV: 'development', CLAUDE_CODE_MAX_RETRIES: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
        const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
        const exit = await new Promise(r => child.on('close', r)); clearTimeout(timer);
        writeFileSync(join(dir, 'observed.json'), JSON.stringify({ exit, stdout, stderr, requests }, null, 2));
        assert.equal(exit, 0, stderr); assert.deepEqual(JSON.parse(stdout.trim().split('\n').at(-1)), [true, true]);
        assert.equal(requests.length, 3); assert.ok(requests[0].body.metadata);
        assert.ok(requests.slice(1).every(r => !('metadata' in r.body)), 'verification resent rejected metadata');
        results.push({ name: c.name, passed: true }); console.log('PASS ' + c.name); continue;
      }
      if (c.cd || c.latchUsage) {
        const target = join(dir, 'target'); mkdirSync(target); execFileSync('git', ['init', '-q'], { cwd: target });
        const socket = 'noa-startup-' + process.pid, tmux = (...a) => execFileSync('tmux', ['-L', socket, ...a], { encoding: 'utf8' });
        const sh = v => "'" + v.replaceAll("'", "'\\''") + "'";
        const screen = () => tmux('capture-pane', '-p', '-t', 'cd');
        const until = async (what, fn) => { for (let i = 0; i < 150; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`timed out waiting for ${what}:\n${screen()}`); };
        const readConfig = () => JSON.parse(readFileSync(join(config, '.config.json'), 'utf8'));
        // env -i: the tmux server inherits the caller's environment, and a caller
        // running inside Noa (CLAUDE_CODE_PRODUCT_DIR) would point the TUI at the real config.
        tmux('new-session', '-d', '-s', 'cd', '-x', '120', '-y', '40', ['cd', sh(project), '&&', 'env', '-i', 'TERM=xterm-256color', ...Object.entries(env).map(([k, v]) => sh(k + '=' + v)), sh(entry), '--model', 'claude-opus-5-5'].join(' '));
        try {
          await until('prompt', () => /shift\+tab to cycle/.test(screen()));
          if (c.latchUsage) {
            tmux('send-keys', '-t', 'cd', '-l', 'Run the compatibility fixture.'); tmux('send-keys', '-t', 'cd', 'Enter');
            await until('answer after field rejection', () => screen().includes('BOUNDARY_OK'));
            tmux('send-keys', '-t', 'cd', '-l', '/usage'); tmux('send-keys', '-t', 'cd', 'Enter');
            await until('latch summary in usage', () => screen().includes('API compatibility fallbacks:') && screen().includes('metadata'));
          } else {
            tmux('send-keys', '-t', 'cd', '-l', '/cd ' + realpathSync(target)); await new Promise(r => setTimeout(r, 300));
            tmux('send-keys', '-t', 'cd', 'Enter');
            await until('cd confirmation', () => screen().includes('Yes, move here'));
            tmux('send-keys', '-t', 'cd', 'Enter');
            await until('persisted trust', () => readConfig().projects?.[realpathSync(target)]?.hasTrustDialogAccepted === true);
          }
          observation = { name: c.name, screen: screen(), projects: readConfig().projects, requests };
          writeFileSync(join(dir, 'observed.json'), JSON.stringify(observation, null, 2));
        } finally { try { observation ??= { name: c.name, screen: screen() }; writeFileSync(join(dir, 'observed.json'), JSON.stringify(observation, null, 2)); } catch {} try { tmux('kill-server'); } catch {} }
        assert.equal(observation.projects[realpathSync(project)].hasTrustDialogAccepted, true);
        results.push({ name: c.name, passed: true }); console.log('PASS ' + c.name); continue;
      }
      const args = ['--print', 'Reply BOUNDARY_OK.', '--output-format', 'json', '--model', 'claude-opus-5-5', '--permission-mode', 'dontAsk'];
      const child = spawn(entry, args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      const exit = await new Promise(r => child.on('close', r)); clearTimeout(timer);
      const helperRun = existsSync(markerFile) ? readFileSync(markerFile, 'utf8').split('\n') : null;
      observation = { name: c.name, exit, args, stdout, stderr, marker: helperRun !== null, helperRun, requests };
      writeFileSync(join(dir, 'observed.json'), JSON.stringify(observation, null, 2));
      assert.equal(exit, 0, stderr); const result = JSON.parse(stdout.trim().split('\n').at(-1)); assert.equal(result.result, 'BOUNDARY_OK'); assert.equal(result.is_error, false);
      const modelRequests = requests.filter(r => r.url.includes('/messages') && !r.url.includes('count_tokens')); assert.equal(modelRequests.length, 1);
      if (c.memory !== undefined) {
        const payload = JSON.stringify(modelRequests[0].body); const marker = c.marker ?? 'MEMORY_SENTINEL_';
        const count = payload.split(marker).length - 1;
        assert.equal(count, c.expected, `loaded memory count: ${count}`);
        assert.ok(!payload.includes('\ufffd'), 'UTF-8 truncation inserted a replacement character');
        if (c.warning) assert.ok(payload.includes('WARNING: MEMORY.md') && payload.includes(`Only part of it was loaded: ${c.warning}.`.replaceAll('"', '\\"')), 'warning names the cut-off point');
      } else {
        assert.equal(observation.marker, c.run, 'helper trust boundary');
        const init = requests.find(r => r.rpc === 'initialize'); assert.ok(init, 'MCP failed before trust assertions');
        assert.equal(init.staticHeader, 'static'); assert.equal(init.probe, c.run ? 'executed' : undefined);
        assert.ok(requests.some(r => r.rpc === 'tools/list'));
        if (c.run) {
          // Repository helpers run where they were declared; only .mcp.json helpers lose the CLI's credentials.
          const declared = c.scope === undefined && c.inherited ? parent : project;
          assert.equal(helperRun[0], realpathSync(declared), 'helper cwd');
          // .mcp.json helpers lose every credential-shaped variable and see removed values redacted; proxies and plain variables stay.
          const scrubbed = c.scope === undefined;
          assert.deepEqual(helperRun.slice(1, 6), scrubbed ? ['unset', 'unset', 'unset', 'unset', 'unset'] : ['local-dummy', secrets.GITHUB_TOKEN, secrets.NPM_TOKEN, secrets.DATABASE_URL, secrets.PIP_INDEX_URL], 'helper credential env');
          assert.deepEqual(helperRun.slice(6, 8), [secrets.npm_config_proxy, secrets.NOA_FIXTURE_PLAIN], 'helper keeps proxy and plain env');
          assert.equal(helperRun[8], url + '/mcp?k=' + (scrubbed ? 'REDACTED' : secrets.GITHUB_TOKEN), 'server URL redaction');
          // Credentials recognized by value under innocuous names: password pairs, webhooks, private keys.
          assert.deepEqual(helperRun.slice(9, 12), scrubbed ? ['unset', 'unset', 'unset'] : [secrets.JAVA_TOOL_OPTIONS, secrets.NOTIFY_URL, secrets.DEPLOY_PEM], 'credential values under plain names');
        } else {
          assert.equal(stderr.split('headersHelper not run').length - 1, 1, 'missing-trust notice printed once');
          const key = realpathSync(c.inherited ? parent : project).replaceAll('\u202e', ' ');
          assert.ok(!stderr.includes('\u202e'), 'format characters from repository paths reach the terminal');
          assert.ok(stderr.includes(`projects[${JSON.stringify(key)}].hasTrustDialogAccepted in ${join(config, '.config.json')}`), 'notice names the exact trust key and file');
          // A trusted parent suppresses the trust dialog, so the notice must not send the user to it.
          const inheritsTrust = c.parentTrust && c.scope === undefined;
          assert.equal(stderr.includes('accept the trust dialog'), !inheritsTrust, 'notice offers the trust dialog only when it can appear');
          assert.equal(stderr.includes('trust inherited from a parent folder does not count'), Boolean(inheritsTrust), 'notice explains inherited trust');
        }
      }
      results.push({ name: c.name, passed: true }); console.log('PASS ' + c.name);
    } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  }
} finally {
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  let revision = 'unavailable'; try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() } catch {}
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision, entry, entry_sha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), inputs: definitions.map(c => ({ ...c, memory: c.memory === undefined ? undefined : { utf8_bytes: Buffer.byteLength(c.memory), sha256: createHash('sha256').update(c.memory).digest('hex') } })), transport: 'Compiled CLI trust/memory/UI plus source API-key verification, localhost scripted API, isolated HOME/config', passed: results.length, expected: definitions.length, exit_code: results.length === definitions.length ? 0 : 1 }, null, 2));
}
