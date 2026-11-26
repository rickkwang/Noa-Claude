#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs the compiled CLI; only the model transport is scripted. The fixture repo
// has a real commit so the review skill's git commands have something to read.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const artifacts = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-review-e2e-')));
mkdirSync(artifacts, { recursive: true });
const model = 'claude-sonnet-4-6';
const finding = '[{"file":"src/a.ts","line":2,"summary":"E2E_FINDING_42 inverted guard","short_summary":"inverted guard","failure_scenario":"x → y","category":"correctness","verdict":"CONFIRMED","severity":"important"}]';

const fixture = mkdtempSync(join(tmpdir(), 'noa-review-fixture-'));
const git = (...a) => execFileSync('git', a, { cwd: fixture, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 'e2e@example.invalid');
git('config', 'user.name', 'e2e');
writeFileSync(join(fixture, 'a.ts'), 'export function ok(x: number) {\n  return x > 0\n}\n');
git('add', '.'); git('commit', '-qm', 'base');
writeFileSync(join(fixture, 'a.ts'), 'export function ok(x: number) {\n  return x < 0\n}\n');
git('commit', '-qam', 'invert guard');
writeFileSync(join(fixture, 'new.ts'), 'export const newFile = true;\n');
writeFileSync(join(artifacts, 'outside.ts'), 'export const outside = true;\n');
symlinkSync(join(artifacts, 'outside.ts'), join(fixture, 'outside-link.ts'));

const requests = [];
const sse = (res, text, toolUse) => {
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const msg = { id: 'msg_e2e', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  ev('message_start', { message: msg });
  if (toolUse) {
    ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_e2e_skill', name: toolUse.name, input: {} } });
    ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolUse.input) } });
  } else {
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  }
  ev('content_block_stop', { index: 0 });
  ev('message_delta', { delta: { stop_reason: toolUse ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
  ev('message_stop', {});
  res.end();
};
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/messages') || req.url.includes('count_tokens')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(req.url.includes('count_tokens') ? '{"input_tokens":100}' : '{}');
    return;
  }
  const body = JSON.parse(raw || '{}');
  requests.push(JSON.stringify(body));
  const text = JSON.stringify(body);
  // E2E_MODEL_INVOKE: the main model starts a review through the Skill tool, as a model would on its own.
  if (text.includes('E2E_MODEL_INVOKE') && !text.includes('Phase 0 — Gather the diff') && !text.includes('toolu_e2e_skill')) {
    sse(res, '', { name: 'Skill', input: { skill: 'code-review', args: 'low --max-findings 2' } });
    return;
  }
  sse(res, !text.includes('Phase 0 — Gather the diff') ? 'ok' : text.includes('E2E_EMPTY') ? '[]' : finding);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const configDir = join(artifacts, 'config');
const homeDir = join(artifacts, 'home');
mkdirSync(configDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });
writeFileSync(join(configDir, 'CLAUDE.md'), '# E2E_USER_RULE_MARKER\n');

function runCli(prompt, tools, runModel = model, extraEnv = {}, extraArgs = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['PATH', 'TMPDIR', 'USER', 'LANG', 'LC_ALL', 'SHELL'].includes(k)));
  Object.assign(env, {
    HOME: homeDir, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_API_KEY: 'local-e2e-dummy', ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_MODEL: runModel, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: '1', DISABLE_AUTOUPDATER: '1',
  }, extraEnv);
  return new Promise(resolveRun => {
    const child = spawn(entry, ['--print', '--model', runModel, '--permission-mode', 'dontAsk', ...(tools ? ['--tools', tools] : []), '--max-turns', '3', ...extraArgs, prompt], { cwd: fixture, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', code => { clearTimeout(timer); resolveRun({ code, out, err }); });
  });
}

const results = [];
async function scenario(name, prompt, tools, check, runModel, extraEnv, extraArgs) {
  requests.length = 0;
  const run = await runCli(prompt, tools, runModel, extraEnv, extraArgs);
  let failure;
  try {
    assert.equal(run.code, 0, `exit ${run.code}: ${run.err.slice(-500)}`);
    assert.ok(requests.length >= 1, 'no review request reached the scripted model');
    check(requests.join('\n'), run.out);
  } catch (error) {
    failure = String(error.message ?? error);
  }
  results.push({ name, prompt, tools, passed: !failure, failure, exit: run.code, reviewRequests: requests.length });
  writeFileSync(join(artifacts, `${name}.requests.json`), requests.join('\n'));
  writeFileSync(join(artifacts, `${name}.stdout.txt`), run.out);
  writeFileSync(join(artifacts, `${name}.stderr.txt`), run.err);
  console.log(`${failure ? 'FAIL' : 'PASS'} ${name}${failure ? `: ${failure}` : ''}`);
}

const ALL_TOOLS = undefined;
const configFile = join(configDir, '.config.json');
const readConfig = () => { try { return JSON.parse(readFileSync(configFile, 'utf8')); } catch { return {}; } };
const storedReviewChoice = () => { const c = readConfig(); return JSON.stringify([c.codeReviewLastEffort, c.codeReviewLastMaxFindings]); };
// --print runs never remember a typed level or limit, so reuse scenarios seed them as an interactive run would.
const seedReviewChoice = (effort, maxFindings) => writeFileSync(configFile, JSON.stringify({ ...readConfig(), codeReviewLastEffort: effort, codeReviewLastMaxFindings: maxFindings }));
try {
  await scenario('explicit-effort-and-cap', '/code-review high --max-findings 3', ALL_TOOLS, (req, out) => {
    assert.ok(req.includes('high effort → 8 inline angles → dedup (no verify) → ≤3 findings'), 'high tier or cap not applied');
    assert.ok(req.includes('do not spawn subagents for them'), 'default-model high should run its angles inline');
    assert.ok(!req.includes('via the Agent tool'), 'default-model high should not fan out');
    assert.ok(req.includes('Target at least 1 finding.'), 'finding floor not derived from the cap');
    assert.ok(out.includes('E2E_FINDING_42'), 'model findings not returned to the user');
    assert.equal(storedReviewChoice(), JSON.stringify([undefined, undefined]), 'a --print run remembered the typed level or limit');
  }, 'claude-opus-4-8');
  seedReviewChoice('high', 3);
  await scenario('reuse-last-effort-and-cap', '/code-review', ALL_TOOLS, req => {
    assert.ok(req.includes('No effort level given — reusing high, the level the user typed last time.'), 'last effort not reused');
    assert.ok(req.includes('typing a level (for example `/code-review high`) changes it'), 'reuse hint missing');
    assert.ok(req.includes('Reporting up to 3 findings, the limit the user set last time'), 'last max-findings not reused');
    assert.ok(req.includes('passing `--max-findings default` goes back to the usual limit'), 'max reuse hint missing');
    assert.ok(req.includes('Open your report with one short line'), 'reused settings not relayed to the user');
  });
  await scenario('uppercase-effort-and-pr-number', '/code-review HIGH #123 --comment', ALL_TOOLS, req => {
    assert.ok(req.includes('`high effort →'), 'uppercase effort not accepted');
    assert.ok(req.includes('Review target: `123`'), 'PR target missing or leading # kept');
    assert.ok(req.includes('That target is GitHub pull request 123'), 'PR diff source section missing');
    assert.ok(req.includes('gh pr diff 123') && req.includes('gh api repos/{owner}/{repo}/pulls/123'), 'PR diff commands missing');
    assert.ok(req.includes('so this review and its comments are of the checked-out code'), '--comment fallback sentence missing');
    assert.ok(req.includes('## Posting to GitHub (--comment)'), '--comment section missing');
    assert.ok(req.includes('Open each finding\'s text with its severity in words'), 'severity words missing from --comment');
  });
  await scenario('ultra-falls-back-to-max', '/code-review ultra high', ALL_TOOLS, req => {
    assert.ok(req.includes('Falling back to a local max-effort review'), 'ultra fallback notice missing');
    assert.ok(req.includes('`max effort →'), 'ultra did not fall back to max');
    assert.ok(req.includes('Review target: `high`'), 'token after ultra was parsed as a level');
  });
  await scenario('branch-target-and-invalid-max-notice', '/code-review hig --max-findings 0', ALL_TOOLS, req => {
    assert.ok(req.includes('Review target: `hig`'), 'non-level token was swallowed instead of kept as a target');
    assert.ok(!req.includes('Ignoring unrecognized effort'), 'target was treated as an invalid effort');
    assert.ok(req.includes('was ignored: type a whole number above zero'), 'invalid max-findings notice missing');
    assert.ok(req.includes('Reporting up to 3 findings, the limit the user set last time'), 'stored max not reported when the bad flag falls back to it');
    assert.ok(!req.includes('Using the usual limit.'), 'usual-limit notice shown although the stored limit is reused');
    assert.ok(req.includes('reusing high, the level the user typed last time'), 'should fall back to the last typed level');
  });
  await scenario('max-fans-out-with-agent-tool', '/code-review max', ALL_TOOLS, req => {
    assert.ok(req.includes('Run the 10 finder angles via the Agent tool'), 'max tier does not fan out');
    assert.ok(req.includes('run one verifier via the Agent tool'), 'max tier does not verify');
    assert.ok(req.includes('a single non-REFUTED vote carries the finding'), 'max verify is not recall mode');
  }, 'claude-opus-4-8');
  await scenario('default-max-bugs-fan-out', '/code-review max --max-findings default', ALL_TOOLS, req => {
    assert.ok(req.includes('max effort → 5+1 angles × 8 candidates → 1-vote verify → sweep → ≤15 findings'), 'default max recipe not used');
    assert.ok(req.includes('Run the 6 finder angles via the Agent tool'), 'default max does not fan out over 6 angles');
    assert.ok(!req.includes('### Reuse'), 'cleanup angles leak into the bugs recipe');
    assert.ok(req.includes('a single non-REFUTED vote carries the finding'), 'default max verify is not recall mode');
    assert.ok(req.includes("Then give each finding, the sweep's too, its `severity`"), 'severity step after the sweep missing');
    assert.ok(req.includes('`severity` (one of `important`, `nit`, `pre_existing`)'), 'severity output field missing');
  });
  await scenario('no-agent-tool-fallback', '/code-review max', 'Read,Bash,Grep,Glob', req => {
    assert.ok(req.includes('tool is not available here'), 'single-pass fallback missing without Agent tool');
    assert.ok(!req.includes('via the Agent tool'), 'fan-out instruction present without Agent tool');
    assert.ok(!req.includes('PLAUSIBLE is the default'), 'subagent verdict rules leak into the single-pass fallback');
  });
  await scenario('low-tier-with-fix', '/review low --max-findings all --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('low effort → 1 diff pass (bugs) → no verify'), 'default low recipe not used');
    assert.ok(req.includes('Review at low effort'), 'low tier prompt missing');
    assert.ok(req.includes('Output every finding'), 'max-findings all not applied');
    assert.ok(req.includes('important|pre_existing|nit'), 'low-tier severity word missing');
    assert.ok(!req.includes('dead code the diff leaves behind'), 'cleanup flags leak into the bugs low recipe');
    assert.ok(req.includes('apply the findings to the working tree'), 'low-tier fix section missing');
    assert.ok(req.includes('whatever its kind or severity'), 'bugs fix wording missing');
  });
  await scenario('flag-after-bad-max-is-kept', '/code-review medium --max-findings --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('was ignored: type a whole number'), 'bad max-findings value not reported');
    assert.ok(req.includes('apply the findings to the working tree'), '--fix swallowed as the max-findings value');
  });
  await scenario('fix-refused-for-target', '/code-review 123 --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('change no files and say so'), '--fix not refused for a PR target');
    assert.ok(!req.includes('apply the findings'), '--fix applied to a PR target');
  });
  await scenario('user-rules-path', '/code-review medium --max-findings default', ALL_TOOLS, req => {
    assert.ok(req.includes(`${configDir}/CLAUDE.md`), 'convention angle does not use the config home CLAUDE.md');
    assert.ok(!req.includes('~/.claude/CLAUDE.md'), 'hardcoded ~/.claude/CLAUDE.md still in the prompt');
    assert.ok(req.includes('take it only from your context'), 'user-level CLAUDE.md is not taken from context');
    const reviewer = requests.find(r => r.includes('Phase 0 — Gather the diff'));
    assert.ok(reviewer?.includes('E2E_USER_RULE_MARKER'), 'forked reviewer context lacks the user-level CLAUDE.md');
    assert.ok(req.includes('high effort → 4 inline angles (bugs + conventions) → dedup (no verify) → ≤10 findings'), 'default-model medium routing or default cap wrong');
    assert.ok(req.includes('git diff origin/HEAD...HEAD'), 'bugs recipe does not gather against origin/HEAD');
    assert.ok(req.includes('Three forms need permission, so never write them'), 'permission-free gather rule missing');
    assert.ok(req.includes('Give each finding that is left its `severity`'), 'severity step missing');
    assert.ok(req.includes('Target at least 5 findings'), 'finding floor missing');
  });
  await scenario('xhigh-inline-sweep', '/code-review xhigh --max-findings all', ALL_TOOLS, req => {
    assert.ok(req.includes('10 angles, up to 8 each'), 'xhigh finder budget missing');
    assert.ok(req.includes('Phase 3 — Sweep for gaps'), 'xhigh sweep missing');
    assert.ok(!req.includes('via the Agent tool'), 'xhigh should run inline');
    assert.ok(req.includes('Target at least 7 findings'), 'floor for --max-findings all should use the recipe default');
  }, 'claude-opus-4-8');
  await scenario('default-xhigh-bugs-inline-sweep', '/code-review xhigh --max-findings all', ALL_TOOLS, req => {
    assert.ok(req.includes('xhigh effort → 6 inline angles (bugs + conventions) → dedup (no verify) → sweep → all findings'), 'default xhigh recipe not used');
    assert.ok(req.includes('6 angles, up to 8 each'), 'default xhigh finder budget missing');
    assert.ok(req.includes('Phase 3 — Sweep for gaps'), 'default xhigh sweep missing');
    assert.ok(!req.includes('via the Agent tool'), 'default xhigh should run inline');
    assert.ok(req.includes('Target at least 7 findings'), 'default xhigh floor missing');
  });
  await scenario('branch-name-preserved', '/code-review highlight', ALL_TOOLS, req => {
    assert.ok(req.includes('Review target: `highlight`'), 'branch target was swallowed');
  });
  await scenario('local-path-fix', '/code-review a.ts --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('apply the findings to the working tree'), 'local path fix was refused');
    assert.ok(req.includes('Restrict edits to the reviewed target `a.ts`'), 'path fix scope missing');
  });
  await scenario('local-path-fix-boundary', '/code-review outside-link.ts --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('change no files and say so'), 'symlink outside the working directory allowed');
    assert.ok(!req.includes('apply the findings'), 'outside target received fix instruction');
  });
  await scenario('untracked-path-fix', '/code-review new.ts --fix', ALL_TOOLS, req => {
    assert.ok(req.includes('apply the findings to the working tree'), 'untracked local path refused');
    assert.ok(req.includes('Restrict edits to the reviewed target `new.ts`'), 'untracked path scope missing');
  });
  for (const value of ['9007199254740993', '9'.repeat(400)]) {
    await scenario(`invalid-cap-${value.length}`, `/code-review --max-findings ${value}`, ALL_TOOLS, req => {
      assert.ok(req.includes('was ignored: type a whole number'), 'unsafe finding cap accepted');
      assert.ok(!req.includes('Infinity findings'), 'overflow leaked into prompt');
    });
  }
  await scenario('gather-and-dedup-rules', '/code-review medium', ALL_TOOLS, req => {
    assert.ok(req.includes('Untracked files are not part of the default scope'), 'default scope reads untracked files');
    assert.ok(req.includes('how many untracked files were not reviewed'), 'unreviewed untracked files are not disclosed');
    assert.ok(req.includes("':(literal)<path>'"), 'path target matches git pathspec globs');
    assert.ok(req.includes('same defect, same location, and same cause'), 'dedup rule can merge distinct defects');
  });
  await scenario('comment-without-pr', '/code-review --comment', ALL_TOOLS, req => {
    assert.ok(req.includes('If the target is not a PR, print the findings and note that `--comment` was ignored'), '--comment without PR not handled');
  });
  // Per-model recipes.
  await scenario('opus-4-8-medium-inline', '/code-review medium --max-findings default', ALL_TOOLS, req => {
    assert.ok(req.includes('medium effort → 8 inline angles → dedup (no verify) → ≤8 findings'), 'opus 4.8 medium recipe not used');
    assert.ok(req.includes('reviewing for **correctness bugs**'), 'opus 4.8 medium lead-in missing');
  }, 'claude-opus-4-8');
  await scenario('sonnet-5-high-fans-out-with-budget', '/code-review high HEAD~1...HEAD', ALL_TOOLS, req => {
    assert.ok(req.includes('high effort → 3+5 angles × 6 candidates → 1-vote verify (recall-biased)'), 'sonnet 5 high recipe not used');
    assert.ok(req.includes('Phase 2 — Verify (1 vote, recall-biased)'), 'recall-biased verify missing');
    assert.ok(req.includes('This diff is about 2 lines. Spawn about 2 finder subagents (min 2, max 8)'), 'finder budget hint missing');
  }, 'claude-sonnet-5');
  // Sonnet 5 defaults to high effort, so medium here proves the typed level reaches the forked reviewer.
  await scenario('sonnet-5-medium-runs-at-typed-effort', '/code-review medium', ALL_TOOLS, req => {
    assert.ok(req.includes('medium effort → 3+5 angles × 6 candidates → 1-vote verify'), 'sonnet 5 medium recipe not used');
    assert.ok(req.includes('"effort":"medium"'), 'forked reviewer not run at the typed effort');
  }, 'claude-sonnet-5');
  await scenario('sonnet-5-low-has-no-cap', '/code-review low --max-findings 2', ALL_TOOLS, req => {
    assert.ok(req.includes('Target min(files_changed, 4) findings'), 'sonnet 5 low recipe not used');
    assert.ok(req.includes('`--max-findings` does not change this review'), 'no-maximum notice missing');
    assert.ok(req.includes('"effort":"medium"'), 'sonnet 5 low should run the reviewer at medium effort');
  }, 'claude-sonnet-5');
  await scenario('opus-5-low-keeps-plain-low', '/code-review low --max-findings default', ALL_TOOLS, req => {
    assert.ok(req.includes('`low effort → 1 diff pass → no verify → ≤4 findings`'), 'opus 5 low should keep the plain low recipe');
  }, 'claude-opus-5');
  await scenario('opus-5-xhigh-keeps-o48-inline', '/code-review xhigh', ALL_TOOLS, req => {
    assert.ok(req.includes('xhigh effort → 10 inline angles → dedup (no verify) → sweep'), 'opus 5 xhigh should keep the 10-angle inline recipe');
  }, 'claude-opus-5');
  await scenario('opus-5-high-minimal-clamps-cap', '/code-review high --max-findings all', ALL_TOOLS, req => {
    assert.ok(req.includes('minimal prompt → single careful diff pass → ≤32 findings'), 'opus 5 minimal recipe or clamp missing');
    assert.ok(req.includes('This review reports at most 32 findings, so the limit is 32 here.'), 'clamp notice missing');
  }, 'claude-opus-5');
  await scenario('typed-level-beats-effort-env', '/code-review max', ALL_TOOLS, req => {
    assert.ok(req.includes('`max effort →'), 'session effort env overrode the typed level');
  }, undefined, { CLAUDE_CODE_EFFORT_LEVEL: 'low' });
  await scenario('unsupported-level-is-capped-with-notice', '/code-review xhigh', ALL_TOOLS, req => {
    assert.ok(req.includes('xhigh effort is not available for this model; running at high here.'), 'cap notice missing');
    assert.ok(req.includes('`high effort →'), 'xhigh not capped to the model');
  }, 'claude-sonnet-4-6', {
    CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: '',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
    ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: 'effort,max_effort',
  });
  await scenario('github-pr-url-target', '/code-review medium https://github.com/foo/bar/pull/12', ALL_TOOLS, req => {
    assert.ok(req.includes('gh pr diff 12 -R foo/bar'), 'PR URL diff command missing');
    assert.ok(req.includes("gh api repos/foo/bar/pulls/12 -H 'Accept: application/vnd.github.diff'"), 'PR URL api fallback missing');
    assert.ok(req.includes('or of another repository'), 'cross-repository warning missing');
    assert.ok(req.includes('so nothing was reviewed.'), 'PR URL failure should stop the review');
  });
  await scenario('gitlab-mr-target', '/code-review medium !7 --comment', ALL_TOOLS, req => {
    assert.ok(req.includes('That target is GitLab merge request 7'), 'GitLab MR not recognized');
    assert.ok(req.includes('glab mr diff 7'), 'GitLab diff command missing');
    assert.ok(req.includes('## Posting to GitLab (--comment)') && req.includes('glab mr note 7 -m'), 'GitLab comment section missing');
    assert.ok(!req.includes('## Posting to GitHub'), 'GitHub comment section shown for a GitLab target');
  });
  await scenario('post-flag-ignored', '/code-review medium --post', ALL_TOOLS, req => {
    assert.ok(req.includes('The typed `--post` applies only to the cloud review'), '--post notice missing');
    assert.ok(!req.includes('Review target:'), '--post was kept as a review target');
  });
  await scenario('max-findings-equals-form', '/code-review medium --max-findings=3', ALL_TOOLS, req => {
    assert.ok(req.includes('→ ≤3 findings`'), '--max-findings=N not applied');
    assert.ok(!req.includes('was ignored'), '--max-findings=N reported as invalid');
  });
  await scenario('stream-json-formats-findings', '/code-review medium', ALL_TOOLS, (req, out) => {
    assert.ok(out.includes('1 finding:'), 'findings not rendered as a list');
    assert.ok(out.includes('1. 🔴 Important `src/a.ts:2`: E2E_FINDING_42 inverted guard'), 'finding line not rendered');
    assert.ok(out.includes('Failure scenario: x → y'), 'failure scenario not rendered');
  }, undefined, undefined, ['--output-format', 'stream-json', '--verbose']);
  await scenario('stream-json-empty-findings', '/code-review medium E2E_EMPTY', ALL_TOOLS, (req, out) => {
    assert.ok(out.includes('Code review found no issues.'), 'empty findings not rendered');
  }, undefined, undefined, ['--output-format', 'stream-json', '--verbose']);
  const beforeModelRun = storedReviewChoice();
  await scenario('model-invokes-review', 'E2E_MODEL_INVOKE please review my change', ALL_TOOLS, () => {
    const reviewer = requests.find(r => r.includes('Phase 0 — Gather the diff'));
    assert.ok(reviewer, 'model-invoked Skill call did not start the review');
    assert.ok(reviewer.includes('low effort → 1 diff pass (bugs) → no verify → ≤2 findings'), 'model-passed level or cap not applied');
    assert.ok(reviewer.includes('"effort":"low"'), 'model-invoked reviewer not run at the requested effort');
    assert.ok(requests.some(r => r.includes('args: optional level first') && r.includes('Use max only when explicitly asked')), 'whenToUse guidance missing from the skill listing');
    assert.equal(storedReviewChoice(), beforeModelRun, 'a model-started review overwrote the remembered level or limit');
  }, undefined, undefined, ['--permission-mode', 'bypassPermissions']);
  await scenario('text-output-keeps-json', '/code-review medium', ALL_TOOLS, (req, out) => {
    assert.ok(out.includes('"severity":"important"'), 'text print output should keep the raw JSON');
  });
} finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ entry, fixture, results }, null, 2));
}
const failed = results.filter(r => !r.passed).length;
console.log(`Evidence: ${artifacts}`);
process.exitCode = failed ? 1 : 0;
