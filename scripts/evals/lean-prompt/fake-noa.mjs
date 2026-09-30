// Free stand-in for `noa --print` used to test the harness: EVAL_FAKE=null (no edits) | oracle (apply the real fix).
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const c = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).find(x => x.prompt === prompt);
if (process.env.EVAL_FAKE === 'oracle' && c?.kind === 'fix') {
  const repo = join(here, '../../..');
  const files = execFileSync('git', ['-C', repo, 'show', '--name-only', '--format=', c.sha], { encoding: 'utf8' }).split('\n').filter(f => f && !f.startsWith('src/test/'));
  const patch = execFileSync('git', ['-C', repo, 'diff', `${c.sha}^`, c.sha, '--', ...files], { encoding: 'utf8' });
  execFileSync('git', ['apply', '-'], { input: patch });
}
if (process.env.EVAL_FAKE === 'hang') { console.log(JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'working...' }] } })); setInterval(() => {}, 1000); await new Promise(() => {}); }
const line = o => console.log(JSON.stringify(o));
line({ type: 'assistant', message: { model: process.env.EVAL_FAKE_MODEL || 'claude-opus-5-5', content: [{ type: 'text', text: 'fake ' + process.env.EVAL_FAKE }] } });
line({ type: 'result', is_error: false, result: 'ok', num_turns: 1, total_cost_usd: +(process.env.EVAL_FAKE_COST || 0), usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: { 'claude-opus-5-5': {} } });
