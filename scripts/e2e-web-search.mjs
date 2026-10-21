#!/usr/bin/env node
// WebSearch on non-Anthropic providers, through the compiled CLI with a
// scripted localhost model and search API:
//   searxng          OpenAI-compatible provider + NOA_CLAUDE_WEB_SEARCH_BACKEND=searxng
//   chatgpt-native   Sign in with ChatGPT route, OpenAI's hosted web_search tool
//   gemini-native    Gemini provider, native generateContent + google_search
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-web-search-e2e-')));
mkdirSync(artifacts, { recursive: true });
const cases = ['searxng', 'chatgpt-native', 'gemini-native'].filter(name => !option('--case') || name === option('--case'));
assert.ok(cases.length > 0, 'unknown --case');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const GEMINI_PREFIX = '/googleapis.com/v1beta';
let active;

const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url, 'http://local');
    active.requests.push({ path: url.pathname + url.search, headers: req.headers, body });
    writeFileSync(join(active.dir, 'requests.json'), JSON.stringify(active.requests, null, 2));
    const json = data => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };

    if (url.pathname === '/search') {
      return json({ results: [
        { title: 'Fixture Allowed', url: 'https://docs.allowed.example/page', content: 'SNIPPET_ALLOWED_42' },
        { title: 'Fixture Blocked', url: 'https://www.blocked.example/page', content: 'SNIPPET_BLOCKED' },
      ] });
    }
    if (url.pathname.endsWith(':generateContent')) {
      return json({ candidates: [{
        content: { role: 'model', parts: [{ text: 'GEMINI_ANSWER_42' }] },
        groundingMetadata: { groundingChunks: [
          { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/ok', title: 'allowed.example' } },
          { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/no', title: 'blocked.example' } },
        ] },
      }] });
    }

    // Main loop: first turn calls WebSearch, second (after its result) ends.
    const toolResultSent = JSON.stringify(body.messages ?? body.input ?? []).includes('Web search results for query');
    const callSearch = !toolResultSent;
    const searchInput = { query: 'noa fixture', blocked_domains: ['blocked.example'] };

    if (url.pathname.endsWith('/responses')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const emit = data => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      const hosted = body.tools?.some(t => t.type === 'web_search');
      const items = hosted
        ? [
            { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'noa fixture' } },
            { type: 'web_search_call', id: 'ws_2', status: 'completed', action: { type: 'search', query: 'noa fixture docs' } },
            { type: 'message', id: 'msg_ws', role: 'assistant', content: [{ type: 'output_text', text: 'CHATGPT_ANSWER_42', annotations: [
              { type: 'url_citation', url: 'https://docs.allowed.example/page', title: 'Cited Allowed', start_index: 0, end_index: 5 },
              { type: 'url_citation', url: 'https://www.blocked.example/page', title: 'Cited Blocked', start_index: 0, end_index: 5 },
            ] }] },
          ]
        : callSearch
          ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_ws', name: 'WebSearch', arguments: JSON.stringify(searchInput) }]
          : [{ type: 'message', id: 'msg_done', role: 'assistant', content: [{ type: 'output_text', text: 'AUDIT_OK' }] }];
      items.forEach((item, output_index) => {
        emit({ type: 'response.output_item.added', output_index, item: item.type === 'message' ? { ...item, content: [] } : item });
        if (item.type === 'message') emit({ type: 'response.output_text.delta', output_index, content_index: 0, delta: item.content[0].text });
        emit({ type: 'response.output_item.done', output_index, item });
      });
      emit({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } } });
      return res.end();
    }

    if (url.pathname.endsWith('/chat/completions')) {
      const message = callSearch
        ? { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_ws', type: 'function', function: { name: 'WebSearch', arguments: JSON.stringify(searchInput) } }] }
        : { role: 'assistant', content: 'AUDIT_OK' };
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      const finish = callSearch ? 'tool_calls' : 'stop';
      if (!body.stream) return json({ id: 'cc', object: 'chat.completion', model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish_reason = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: 'cc', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`);
      chunk(message);
      chunk({}, finish, { usage });
      return res.end('data: [DONE]\n\n');
    }
    json({});
  } catch (error) {
    active.transportError = String(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const results = [];

async function run(scenario) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL'].includes(k)));
  const model = scenario === 'gemini-native' ? 'gemini-4-argon' : 'gpt-6.1-sol';
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: join(active.dir, 'config'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
    // Keep WebSearch in the request's tool list instead of behind ToolSearch.
    ENABLE_TOOL_SEARCH: 'false',
    CLAUDE_CODE_USE_OPENAI: '1', OPENAI_API_KEY: 'local-e2e-dummy',
    // The path segment makes this localhost URL read as a Gemini endpoint.
    OPENAI_BASE_URL: scenario === 'gemini-native' ? `${baseUrl}${GEMINI_PREFIX}/openai` : `${baseUrl}/v1`,
    ...(scenario === 'gemini-native' && { GEMINI_API_KEY: 'e2e-gemini-key' }),
    ...(scenario === 'chatgpt-native' && { NOA_CLAUDE_OPENAI_AUTH: 'chatgpt' }),
    // Given as the /search endpoint, which must not become /search/search.
    ...(scenario === 'searxng' && { NOA_CLAUDE_WEB_SEARCH_BACKEND: 'searxng', NOA_CLAUDE_WEB_SEARCH_URL: `${baseUrl}/search/` }),
  });
  if (scenario === 'chatgpt-native') {
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(join(env.CLAUDE_CONFIG_DIR, 'chatgpt-auth.json'), JSON.stringify({ hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000', clientId: 'e2e-client', accessToken: 'e2e-chatgpt-access', refreshToken: 'e2e-chatgpt-refresh', expiresAt: Date.now() + 3_600_000 }));
  }
  // --bare limits the tool pool to the file and shell primitives, so it can't offer WebSearch.
  const command = ['--print', '--verbose', '--output-format', 'stream-json', '--model', model, '--strict-mcp-config', '--setting-sources', '', '--permission-mode', 'dontAsk', '--tools', 'WebSearch', '--allowedTools', 'WebSearch', '--max-turns', '3', '--no-session-persistence'];
  const input = 'Search the web for the fixture.';
  const [bin, binArgs] = entry.endsWith('.js') ? ['bun', [entry, ...command]] : [entry, command];
  const started = performance.now();
  const child = spawn(bin, binArgs, { cwd: active.dir, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', c => { stdout += c; });
  child.stderr.on('data', c => { stderr += c; });
  const timeout = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 30000);
  const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); child.stdin.end(input); });
  clearTimeout(timeout);
  writeFileSync(join(active.dir, 'stdout.jsonl'), stdout);
  writeFileSync(join(active.dir, 'stderr.txt'), stderr);
  active.invocation = { executable: entry, args: command, input_sha256: sha(input), exit, seconds: (performance.now() - started) / 1000 };
  const result = stdout.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).find(e => e?.type === 'result');
  assert.equal(exit.signal, null, `CLI terminated by ${exit.signal}: ${stderr.slice(0, 300)}`);
  assert.ok(result, `no result event: ${stderr.slice(0, 300)}`);
  return { result, code: exit.code };
}

// The WebSearch tool_result the main loop sent back on its second turn.
function searchToolResult(requests) {
  for (const r of requests) {
    for (const m of r.body.messages ?? []) {
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'tool_result' && String(b.content ?? '').includes('Web search results')) return String(b.content);
      }
      if (m.role === 'tool' && String(m.content ?? '').includes('Web search results')) return String(m.content);
    }
    for (const i of r.body.input ?? []) {
      if (i.type === 'function_call_output' && String(i.output).includes('Web search results')) return String(i.output);
    }
  }
  return undefined;
}

try {
  for (const scenario of cases) {
    const dir = join(artifacts, scenario);
    mkdirSync(dir, { recursive: true });
    active = { case: scenario, dir, requests: [] };
    let passed = false, failure, runResult;
    try {
      runResult = await run(scenario);
      assert.equal(runResult.code, 0, `run failed: ${runResult.result?.result}`);
      assert.equal(runResult.result.result, 'AUDIT_OK');
      const output = searchToolResult(active.requests);
      const description = active.requests.flatMap(r => r.body.tools ?? []).map(t => t.description ?? t.function?.description).find(d => d?.includes('Search the web') || d?.includes('search the web'));
      assert.ok(description, 'WebSearch description never reached the model');
      assert.ok(!description.includes('US-only'), 'Anthropic-only "US-only" limit shown for another search backend');
      assert.ok(output, 'WebSearch result never reached the model');
      assert.ok(!output.includes('blocked.example'), 'a blocked domain survived filtering');
      if (scenario === 'searxng') {
        const search = active.requests.filter(r => r.path.startsWith('/search'));
        assert.equal(search.length, 1, 'SearXNG was not queried exactly once');
        const q = new URL(search[0].path, 'http://local').searchParams;
        assert.equal(q.get('format'), 'json');
        assert.ok(q.get('q').includes('noa fixture') && q.get('q').includes('-site:blocked.example'), `query lost the blocked-domain operator: ${q.get('q')}`);
        assert.ok(output.includes('https://docs.allowed.example/page') && output.includes('SNIPPET_ALLOWED_42'), 'hit or snippet missing from the result');
        assert.ok(!active.requests.some(r => r.path.endsWith('/messages')), 'search fell back to the Anthropic transport');
      } else if (scenario === 'chatgpt-native') {
        const sub = active.requests.filter(r => r.body.tools?.some(t => t.type === 'web_search'));
        assert.equal(sub.length, 1, 'hosted web_search request not sent exactly once');
        assert.ok(!sub[0].body.tools.some(t => t.type === 'function' && t.name === 'web_search'), 'server tool leaked as a function tool');
        // Model discovery GETs (/v1/models, /api/tags) carry no body.
        assert.ok(active.requests.filter(r => r.body.model).every(r => r.path.endsWith('/v1/responses')), 'a model request left the Responses transport');
        assert.ok(JSON.stringify(sub[0].body.input).includes('Do not use sources from: blocked.example'), 'blocked domains not passed as an instruction');
        assert.ok(output.includes('CHATGPT_ANSWER_42'), 'answer text missing');
        assert.ok(output.includes('https://docs.allowed.example/page') && output.includes('Cited Allowed'), 'citation missing');
        const toolResult = readFileSync(join(active.dir, 'stdout.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).find(e => e.tool_use_result?.query);
        assert.equal(toolResult?.tool_use_result.searchCount, 2, 'both hosted searches must be counted');
      } else {
        const gen = active.requests.filter(r => r.path.endsWith(':generateContent'));
        assert.equal(gen.length, 1, 'generateContent not called exactly once');
        assert.equal(gen[0].path, `${GEMINI_PREFIX}/models/gemini-4-argon:generateContent`);
        assert.equal(gen[0].headers['x-goog-api-key'], 'e2e-gemini-key', 'Gemini credential not sent');
        assert.deepEqual(gen[0].body.tools, [{ google_search: {} }]);
        assert.ok(output.includes('GEMINI_ANSWER_42') && output.includes('grounding-api-redirect/ok'), 'grounded answer or source missing');
      }
      assert.equal(active.transportError, undefined);
      passed = true;
    } catch (error) { failure = String(error); }
    results.push({ scenario, passed, failure, result: runResult?.result?.result, requests: active.requests.map(r => r.path), invocation: active.invocation });
    writeFileSync(join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`${passed ? 'PASS' : 'FAIL'} ${scenario}${failure ? `: ${failure}` : ''}`);
  }
} finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  let revision; try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()) revision += '-dirty';
  } catch { revision = 'unavailable'; }
  writeFileSync(join(artifacts, 'verification.manifest.json'), JSON.stringify({
    command: [process.execPath, ...process.argv.slice(1)], revision, runtime: process.version,
    transport: 'deterministic localhost OpenAI chat completions / Responses SSE, Gemini generateContent and SearXNG JSON',
    entry, entry_sha256: existsSync(entry) ? sha(readFileSync(entry)) : 'missing',
    script_sha256: sha(readFileSync(fileURLToPath(import.meta.url))),
    passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length,
    exit_code: results.some(r => !r.passed) ? 1 : 0,
  }, null, 2));
}
console.log(`Evidence: ${artifacts}`);
process.exitCode = results.some(r => !r.passed) ? 1 : 0;
