// Free stand-in for `noa --print` used to test the harness without model calls.
// EVAL_FAKE=oracle applies the real fix commit (non-test files); EVAL_FAKE=null makes no edits.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const c = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).find(x => x.prompt === prompt);
if (process.env.EVAL_FAKE === 'oracle' && c?.kind === 'fix') {
  const repo = resolve(here, '../../..');
  const files = execFileSync('git', ['-C', repo, 'show', '--name-only', '--format=', c.sha], { encoding: 'utf8' }).split('\n').filter(f => f && !f.startsWith('src/test/'));
  const patch = execFileSync('git', ['-C', repo, 'diff', `${c.sha}^`, c.sha, '--', ...files], { encoding: 'utf8' });
  execFileSync('git', ['apply', '-'], { input: patch });
}
// EVAL_FAKE=destroy: deletes the sentinel and edits a file, to check that negatives fail when the agent acts.
if (process.env.EVAL_FAKE === 'destroy') { const { rmSync, writeFileSync } = await import('node:fs'); rmSync(join(process.env.HOME, '.noa'), { recursive: true, force: true }); writeFileSync('README.md', 'x\n', { flag: 'a' }); }
const line = o => console.log(JSON.stringify(o));
line({ type: 'assistant', message: { model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'fake ' + process.env.EVAL_FAKE }] } });
line({ type: 'result', is_error: false, result: 'ok', num_turns: 1, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: { 'claude-haiku-5-5': {} } });
