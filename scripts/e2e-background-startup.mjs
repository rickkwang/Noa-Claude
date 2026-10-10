// Real built CLI + bundle: background launch must publish its host before returning.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const entry = resolve(option('--entry') || join(repo, 'dist/cli'));
const bundle = join(dirname(entry), 'main.js');
const root = resolve(option('--artifacts') || mkdtempSync(join(tmpdir(), 'noa-bg-startup-e2e-')));
mkdirSync(root, { recursive: true });
const ps = execFileSync('which', ['ps'], { encoding: 'utf8' }).trim();
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const steps = [];
const cases = [];
let passed = false;
let failure;

const run = (command, args, cwd, env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 15000 });
  steps.push({ command, args, cwd, exit: result.status, stdout: result.stdout, stderr: result.stderr });
  return result;
};
const launchArgs = ['--bg', 'PROBE', '--model', 'claude-sonnet-4-6', '--permission-mode', 'default', '--tools', 'Bash,Read', '--setting-sources', '', '--strict-mcp-config'];

async function exercise(name, command, prefix, mode = 'slow') {
  const cwd = join(root, name);
  const config = join(cwd, 'config');
  const bin = join(cwd, 'bin');
  mkdirSync(config, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(config, '.config.json'), JSON.stringify({ theme: 'dark', hasCompletedOnboarding: true, lastOnboardingVersion: '1.17.0', customApiKeyResponses: { approved: ['x'], rejected: [] }, projects: { [realpathSync(cwd)]: { hasTrustDialogAccepted: true } } }));
  const probe = join(cwd, 'identity-probe.txt');
  // Delay the real host's first writeHostPid, or terminate it before that write.
  // This exercises the startup boundary without any product test hooks.
  writeFileSync(join(bin, 'ps'), `#!/bin/sh\ncase "$*" in *lstart=*)\n  printf '%s\\n' "$*" >> ${quote(probe)}\n  ${mode === 'exit' ? '/bin/kill -TERM "$2"' : mode === 'timeout' ? '/bin/kill -STOP "$2"' : '/bin/sleep 0.8'}\n;; esac\nexec ${quote(ps)} "$@"\n`, { mode: 0o755 });
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'LANG', 'TMPDIR'].includes(key))),
    PATH: bin + ':' + process.env.PATH,
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_API_KEY: 'x', ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    CLAUDE_CODE_SIMPLE: '1', NOA_CLAUDE_BG_ISOLATION: 'none', DISABLE_AUTOUPDATER: '1',
  };
  let short;
  try {
    const launched = run(command, [...prefix, ...launchArgs], cwd, env);
    if (mode !== 'slow') {
      const reason = mode === 'timeout' ? /background host did not register within 5 seconds/ : /background host exited before registering/;
      assert.notEqual(launched.status, null, 'launch hung or exceeded the test timeout');
      assert.notEqual(launched.status, 0, 'launch reported success without a registered host');
      assert.match(launched.stderr, reason);
      const listed = run(entry, ['agents', '--json', '--all'], cwd, env);
      assert.equal(listed.status, 0, listed.stderr);
      const jobs = JSON.parse(listed.stdout).filter(row => row.kind === 'background');
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].state, 'failed');
      assert.match(jobs[0].detail, reason);
      assert.equal(jobs[0].running, false);
      short = jobs[0].id;
      const hostPid = Number(readFileSync(probe, 'utf8').match(/-p (\d+) -o lstart=/)?.[1]);
      assert.ok(hostPid > 1, 'host identity probe did not record a valid pid');
      assert.throws(() => process.kill(hostPid, 0), { code: 'ESRCH' }, 'failed launch left its unregistered host alive');
    } else {
      assert.equal(launched.status, 0, launched.stderr);
      short = launched.stdout.match(/backgrounded · ([0-9a-f]{8})/)?.[1];
      assert.ok(short, 'launch did not report its job id');
      assert.ok(existsSync(join(config, 'jobs', short, 'host.json')), 'launch returned before host.json was published');
      const host = JSON.parse(readFileSync(join(config, 'jobs', short, 'host.json'), 'utf8'));
      process.kill(host.pid, 0);
      for (const [reader, args] of [[entry, ['agents', '--json']], ['bun', [bundle, 'agents', '--json']]]) {
        const listed = run(reader, args, cwd, env);
        assert.equal(listed.status, 0, listed.stderr);
        assert.ok(JSON.parse(listed.stdout).some(row => row.id === short && row.running), 'immediate default agents list omitted the launched job');
      }
      const source = run('bun', ['-e', `const jobs=await import(${JSON.stringify(join(repo, 'src/utils/background/jobs.ts'))});console.log(JSON.stringify((await jobs.listJobs()).map(job=>job.short)));`], cwd, env);
      assert.equal(source.status, 0, source.stderr);
      assert.ok(JSON.parse(source.stdout).includes(short), 'source and built readers disagree');
    }
    assert.ok(existsSync(probe), 'the startup identity probe did not execute');
    cases.push({ name, passed: true, short });
    console.log(`PASS ${name}`);
  } finally {
    // Reap only this fixture's host if a failed assertion interrupted cleanup.
    if (mode !== 'slow' && existsSync(probe)) {
      const pid = readFileSync(probe, 'utf8').match(/-p (\d+) -o lstart=/)?.[1];
      if (pid) try {
        const command = execFileSync(ps, ['-p', pid, '-o', 'command='], { encoding: 'utf8' });
        if (command.includes('--bg-pty-host')) process.kill(Number(pid), 'SIGKILL');
      } catch {}
    }
    // Keep the original state even when an assertion fails before the id is read.
    if (short && existsSync(join(config, 'jobs', short, 'state.json'))) {
      writeFileSync(join(cwd, 'state-before-cleanup.json'), readFileSync(join(config, 'jobs', short, 'state.json')));
    }
    // Use the real ps for identity verification during cleanup.
    const cleanupEnv = { ...env, PATH: process.env.PATH };
    const all = run(entry, ['agents', '--json', '--all'], cwd, cleanupEnv);
    if (all.status === 0) {
      for (const job of JSON.parse(all.stdout).filter(row => row.kind === 'background')) {
        // An unfixed launcher may have returned before even host.json exists.
        for (let attempt = 0; job.state !== 'failed' && attempt < 30 && !existsSync(join(config, 'jobs', job.id, 'host.json')); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        run(entry, ['stop', job.id], cwd, cleanupEnv);
      }
    }
  }
}

try {
  await exercise('compiled-slow-host', entry, []);
  await exercise('bundle-slow-host', 'bun', [bundle]);
  await exercise('compiled-host-exits', entry, [], 'exit');
  await exercise('compiled-host-timeout', entry, [], 'timeout');
  passed = true;
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  writeFileSync(join(root, 'verification.manifest.json'), JSON.stringify({ command: process.argv, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), entry, entry_sha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), script_sha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), transport: 'Real compiled CLI and bundle, isolated environment, port 9 with no API, delayed or terminated PTY host identity query', passed, exit_code: passed ? 0 : 1, failure, cases, steps }, null, 2));
  console.log(`Artifacts: ${root}`);
}
