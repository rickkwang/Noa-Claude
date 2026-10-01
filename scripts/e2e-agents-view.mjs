#!/usr/bin/env bun
/**
 * E2E for background sessions and the agents view, driven through a real
 * terminal (tmux). Needs tmux and a working model (live API calls).
 *
 *   bun run build:dev && bun scripts/e2e-agents-view.mjs [--entry <file>] [--artifact <path>]
 *   (default entry dist/main-dev.js; `--entry bin/noa.js` exercises the production
 *   bundle, `--entry dist/cli` the compiled binary after `bun run compile`)
 *
 * Covers: new session from the view, working → completed reporting, attach
 * (enter / →) and detach (←) repeated, /exit detaching, /stop and revive,
 * ctrl+x stopping then deleting (esc keeps), esc quitting the view, and
 * moving a foreground conversation to the background: ← on an empty prompt
 * (upstream's second-press guard, ≥1s apart) with esc returning to it — also
 * from a fresh session with no messages — ← while a tool runs (the turn
 * finishes first), esc cancelling that wait, ← refused while a prompt is
 * queued, ← mid-reply (the background session continues the cut-off reply),
 * /bg with nothing to move, bare /bg mid-turn (exits; the background session
 * finishes the turn), /bg <prompt> typed mid-turn (queued, prompt kept), and
 * the shell side: `noa --continue` refusing a conversation held in the
 * background, `noa logs`, `noa attach` (← detaches to the agents view) and
 * `noa stop`, then `respawn`/`kill`, the /resume tag and refusal, `--bg`, ctrl+r
 * rename in the view and `rm`. Only jobs created by this run are touched; they are removed at
 * the end. Writes a JSON artifact with the command, revision, inputs,
 * observed screens and exit status.
 */
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';

const repoRoot = resolve(import.meta.dir, '..');
const entryArg = process.argv.indexOf('--entry');
const entry = entryArg !== -1 ? resolve(process.argv[entryArg + 1]) : join(repoRoot, 'dist/main-dev.js');
// A compiled binary (dist/cli) runs directly; scripts run under bun.
const launch = /\.(m?js|tsx?)$/.test(entry) ? `bun ${entry}` : entry;
const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.noa');
const jobsDir = join(configDir, 'jobs');
const socket = `noa-e2e-${process.pid}`;
const artifactArg = process.argv.indexOf('--artifact');
const artifactPath = artifactArg !== -1 ? process.argv[artifactArg + 1] : join(tmpdir(), `e2e-agents-view.${process.pid}.json`);

const steps = [];
const preexisting = new Set(existsSync(jobsDir) ? readdirSync(jobsDir) : []);

function tmux(...args) {
  return execFileSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
}
const screen = (target = 'view') => tmux('capture-pane', '-p', '-t', target);
const keys = (target, ...k) => tmux('send-keys', '-t', target, ...k);
const type = (target, text) => tmux('send-keys', '-t', target, '-l', text);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A shell command (bun + entry, or the binary) as argv.
const cliArgv = /\.(m?js|tsx?)$/.test(entry) ? ['bun', entry] : [entry];
function cliIn(cwd, ...args) {
  const r = spawnSync(cliArgv[0], [...cliArgv.slice(1), ...args], { cwd, encoding: 'utf8', timeout: 30000 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const cli = (...args) => cliIn(repoRoot, ...args);

async function waitFor(what, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

function ourJobs() {
  if (!existsSync(jobsDir)) return [];
  return readdirSync(jobsDir).filter(d => !preexisting.has(d)).flatMap(d => {
    try {
      return [JSON.parse(readFileSync(join(jobsDir, d, 'state.json'), 'utf8'))];
    } catch {
      return [];
    }
  });
}

function hostPid(job) {
  try {
    return JSON.parse(readFileSync(join(jobsDir, job.short, 'host.json'), 'utf8')).pid;
  } catch {
    return 0;
  }
}

function pidAlive(pid) {
  if (!pid) return false; // kill(0) would signal our own process group
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hostAlive(job) {
  const pid = hostPid(job);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The REPL footer: "← for agents", or "← N agents" once some need input.
const agentsHint = target => /← (for agents|\d+ agents?)/.test(screen(target));
// A shell command is running (not just the prompt that asks for one): the
// progress line under the prompt box.
const toolRunning = target => /Running \d+ bash command/.test(screen(target).split('╰').slice(1).join(''));
const inList = (target = 'view') => screen(target).includes('describe a task for a new session');

async function step(name, fn) {
  const started = Date.now();
  try {
    const observed = await fn();
    steps.push({ name, ok: true, ms: Date.now() - started, observed });
    console.log(`ok   ${name}`);
  } catch (e) {
    // Every pane: the step may have been driving a session other than the view.
    let snapshot = '';
    try {
      for (const target of tmux('list-sessions', '-F', '#S').trim().split('\n')) snapshot += `--- ${target}\n${screen(target)}\n`;
    } catch {}
    steps.push({ name, ok: false, ms: Date.now() - started, error: String(e?.message ?? e), screen: snapshot });
    console.log(`FAIL ${name}: ${e?.message ?? e}\n${snapshot}`);
    throw e;
  }
}

async function run() {
  if (!existsSync(entry)) throw new Error(`${entry} missing — run \`bun run build:dev\` first`);
  tmux('new-session', '-d', '-s', 'view', '-x', '150', '-y', '40', '-c', repoRoot, `${launch} agents; echo EXIT:$?; sleep 600`);

  await step('agents view opens', async () => {
    await waitFor('prompt box', () => inList());
    return screen().split('\n').slice(0, 4).join('\n');
  });

  let job;
  await step('new session from the view runs and completes', async () => {
    type('view', 'Reply with exactly the word PONG and nothing else.');
    keys('view', 'Enter');
    job = await waitFor('job created', () => ourJobs()[0]);
    const done = await waitFor('job done', () => ourJobs().find(j => j.short === job.short && j.state === 'done'), 90000);
    await waitFor('row shows result', () => /Completed[\s\S]*PONG/.test(screen()));
    return { state: done.state, tempo: done.tempo, result: done.output?.result, name: done.name };
  });

  await step('enter / → attach, ← detaches (x3)', async () => {
    const cycles = [];
    for (let i = 0; i < 3; i++) {
      keys('view', i === 1 ? 'Right' : 'Enter');
      await waitFor(`attached #${i + 1}`, () => !inList() && screen().includes('PONG'));
      keys('view', 'Left');
      await waitFor(`back in list #${i + 1}`, () => inList());
      cycles.push('attached+detached');
    }
    return cycles;
  });

  await step('/exit in a background session detaches (it keeps running)', async () => {
    keys('view', 'Enter');
    await waitFor('attached', () => !inList());
    type('view', '/exit');
    await sleep(300);
    keys('view', 'Enter');
    await waitFor('back in list after /exit', () => inList());
    await sleep(1000);
    const still = ourJobs().find(j => j.short === job.short);
    if (!hostAlive(still)) throw new Error('/exit stopped the session instead of detaching');
    return { hostAlive: true };
  });

  await step('/stop ends the session (listed as stopped); enter revives it', async () => {
    keys('view', 'Enter');
    await waitFor('attached', () => !inList());
    type('view', '/stop');
    await sleep(300);
    keys('view', 'Enter');
    await waitFor('back in list after /stop', () => inList());
    await waitFor('host gone', () => ourJobs().find(j => j.short === job.short && !hostAlive(j)));
    await waitFor('marked stopped', () => ourJobs().find(j => j.short === job.short && j.detail === 'stopped'));
    keys('view', 'Enter');
    await waitFor('revived + attached', () => !inList() && screen().includes('PONG'), 30000);
    const revived = ourJobs().find(j => j.short === job.short);
    keys('view', 'Left');
    await waitFor('back in list', () => inList());
    return { hostAlive: hostAlive(revived), sessionId: revived.sessionId === job.sessionId };
  });

  await step('ctrl+x stops a running session (esc keeps it), ctrl+x twice then deletes', async () => {
    keys('view', 'C-x');
    await waitFor('stopped, delete armed', () => screen().includes('stopped · ctrl+x again to delete'));
    await waitFor('host gone', () => ourJobs().find(j => j.short === job.short && !hostAlive(j)));
    keys('view', 'Escape');
    await waitFor('delete disarmed', () => !screen().includes('ctrl+x again'));
    await sleep(500);
    if (!inList() || !ourJobs().some(j => j.short === job.short)) throw new Error('esc did more than cancel the delete');
    keys('view', 'C-x');
    await waitFor('delete armed again', () => screen().includes('ctrl+x again to delete'));
    keys('view', 'C-x');
    await waitFor('job removed', () => !ourJobs().some(j => j.short === job.short));
    await waitFor('row removed', () => !screen().includes('PONG'));
    return { remaining: ourJobs().length };
  });

  await step('enter right after starting a session opens it (one host)', async () => {
    type('view', 'Reply with exactly the word QUICK and nothing else.');
    keys('view', 'Enter');
    const fresh = await waitFor('job created', () => ourJobs()[0], 5000);
    keys('view', 'Enter');
    await waitFor('attached', () => !inList() && screen().includes('QUICK'), 60000);
    const hosts = spawnSync('pgrep', ['-f', '--', `--bg-pty-host ${fresh.short}`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    if (hosts.length !== 1) throw new Error(`expected 1 host, found ${hosts.length}`);
    keys('view', 'Left');
    await waitFor('back in list', () => inList());
    return { hosts: hosts.length };
  });

  await step('esc quits the view when no conversation was moved here', async () => {
    keys('view', 'Escape');
    await waitFor('exit', () => screen().includes('EXIT:0'));
    return 'EXIT:0';
  });

  tmux('new-session', '-d', '-s', 'fresh', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  await step('fresh session (no messages): ← moves it, esc/← go back and forth; if it dies, esc quits', async () => {
    await waitFor('repl ready', () => agentsHint('fresh'), 30000);
    await sleep(500);
    keys('fresh', 'Left');
    await waitFor('agents view with origin', () => screen('fresh').includes('Your conversation moved to the background') && screen('fresh').includes('current session'), 20000);
    const origin = await waitFor('origin started', () => ourJobs().find(j => hostAlive(j) && j.tempo === 'blocked' && j.needs === 'send a prompt to start'), 20000);
    const trips = [];
    for (let i = 0; i < 2; i++) {
      keys('fresh', 'Escape');
      await waitFor(`esc returns #${i + 1}`, () => !inList('fresh') && agentsHint('fresh'), 20000);
      keys('fresh', 'Left');
      await waitFor(`← back #${i + 1}`, () => inList('fresh'));
      trips.push('esc→session, ←→list');
    }
    const job = ourJobs().find(j => j.short === origin.short);
    if (job.state === 'failed') throw new Error(`origin failed: ${job.detail}`);
    // The moved conversation dies: esc must now quit instead of bouncing.
    // Only the session: the host's own argv carries the same flags.
    const pids = spawnSync('pgrep', ['-f', '--', `--session-id ${job.sessionId}`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      const cmd = spawnSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' }).stdout;
      if (!cmd.includes('--bg-pty-host')) process.kill(Number(pid), 'SIGKILL');
    }
    const failed = await waitFor('origin marked failed', () => ourJobs().find(j => j.short === origin.short && j.state === 'failed' && !hostAlive(j)), 20000);
    await waitFor('footer offers open, not return', () => screen('fresh').includes('enter to open'), 5000);
    keys('fresh', 'Escape');
    await waitFor('exit', () => screen('fresh').includes('EXIT:0'));
    return { trips, afterKill: { state: failed.state, detail: failed.detail } };
  });

  tmux('new-session', '-d', '-s', 'repl', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  await step('← on an empty prompt moves the conversation to the background (second press after deleting a draft)', async () => {
    await waitFor('repl ready', () => screen('repl').includes('auto mode') || screen('repl').includes('? for shortcuts') || screen('repl').includes('❯'), 30000);
    await sleep(1500);
    type('repl', 'Reply with exactly the word FORKED and nothing else.');
    keys('repl', 'Enter');
    await waitFor('reply', () => /FORKED[\s\S]*FORKED/.test(screen('repl')), 90000);
    await sleep(1000);
    // Upstream guard: ← right after deleting the draft asks for a second press.
    type('repl', 'x');
    await sleep(300);
    keys('repl', 'BSpace');
    await sleep(300);
    keys('repl', 'Left');
    await waitFor('second-press hint', () => screen('repl').includes('Press ← again to open agents'));
    if (screen('repl').includes('Your conversation moved to the background')) throw new Error('moved on the first press');
    // Upstream absorbs a press inside 1s of arming (not a deliberate second press).
    await sleep(300);
    keys('repl', 'Left');
    await sleep(500);
    if (screen('repl').includes('Your conversation moved to the background')) throw new Error('a press 300ms after arming fired');
    await sleep(600);
    keys('repl', 'Left');
    await waitFor('agents view with origin', () => screen('repl').includes('Your conversation moved to the background'), 20000);
    // Upstream parity: the moved conversation waits in Needs input.
    const origin = await waitFor('origin job reported', () => ourJobs().find(j => j.name && j.tempo === 'blocked'), 20000);
    await waitFor('listed under Needs input', () => /Needs input\s*\n\s*✻ Reply with exactly…\s+FORKED/.test(screen('repl')));
    return { origin: { state: origin.state, tempo: origin.tempo, needs: origin.needs, name: origin.name } };
  });

  await step('esc returns to the moved conversation (history carried over)', async () => {
    keys('repl', 'Escape');
    await waitFor('attached with history', () => !inList('repl') && screen('repl').includes('FORKED'), 30000);
    keys('repl', 'Left');
    await waitFor('back in list', () => inList('repl'));
    keys('repl', 'C-c');
    await waitFor('quit hint', () => screen('repl').includes('Ctrl-C again'));
    keys('repl', 'C-c');
    await waitFor('exit', () => screen('repl').includes('EXIT:0'));
    return screen('repl').split('\n').filter(l => l.trim()).slice(-3).join('\n');
  });

  tmux('new-session', '-d', '-s', 'mid', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  await step('← while a tool runs: waits (10s cap), stops the turn, the background session finishes it', async () => {
    await waitFor('repl ready', () => agentsHint('mid'), 30000);
    await sleep(500);
    type('mid', 'Run this shell command in the foreground (never in the background): sleep 15 && echo SLEPT. Then reply with exactly the word MIDTURN-DONE.');
    keys('mid', 'Enter');
    await waitFor('tool running', () => toolRunning('mid'), 90000);
    // The progress line can show while the tool call is still streaming.
    await sleep(1500);
    const pressed = Date.now();
    keys('mid', 'Left');
    await waitFor('defer notice', () => screen('mid').includes('Backgrounding after the current tool finishes'), 5000);
    await sleep(5000);
    if (screen('mid').includes('Your conversation moved to the background')) throw new Error('moved before the turn ended or the cap');
    await waitFor('moved at the cap', () => screen('mid').includes('Your conversation moved to the background'), 20000);
    const waitedMs = Date.now() - pressed;
    const done = await waitFor('background session finished the turn', () => ourJobs().find(j => j.state === 'done' && j.output?.result?.includes('MIDTURN-DONE')), 120000);
    keys('mid', 'C-c');
    await waitFor('quit hint', () => screen('mid').includes('Ctrl-C again'));
    keys('mid', 'C-c');
    await waitFor('exit', () => screen('mid').includes('EXIT:0'));
    return { waitedMs, result: done.output.result, launchArgs: done.launchArgs };
  });

  const newJob = async (before, what, timeoutMs = 20000) => waitFor(what, () => ourJobs().find(j => !before.has(j.short)), timeoutMs);
  const jobIds = () => new Set(ourJobs().map(j => j.short));

  tmux('new-session', '-d', '-s', 'esc', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  await step('esc while waiting for the turn cancels backgrounding; ← refused while a prompt is queued', async () => {
    await waitFor('repl ready', () => agentsHint('esc'), 30000);
    await sleep(500);
    const before = jobIds();
    type('esc', 'Run this shell command in the foreground (never in the background): sleep 8 && echo SLEPT. Then reply with exactly the word ESC-DONE.');
    keys('esc', 'Enter');
    await waitFor('tool running', () => toolRunning('esc'), 90000);
    // The progress line can show while the tool call is still streaming.
    await sleep(1500);
    keys('esc', 'Left');
    await waitFor('defer notice', () => screen('esc').includes('Backgrounding after the current tool finishes'), 5000);
    keys('esc', 'Escape');
    await sleep(3000);
    if (screen('esc').includes('Your conversation moved to the background')) throw new Error('esc did not cancel the move');
    if (ourJobs().some(j => !before.has(j.short))) throw new Error('a background session was started anyway');
    // A prompt queued behind a running turn would be lost: ← refuses.
    type('esc', 'Run this shell command in the foreground (never in the background): sleep 6 && echo AGAIN. Then reply with exactly the word QUEUE-DONE.');
    keys('esc', 'Enter');
    await waitFor('tool running again', () => toolRunning('esc'), 90000);
    type('esc', 'Reply with exactly the word QUEUED.');
    keys('esc', 'Enter');
    await sleep(500);
    keys('esc', 'Left');
    await waitFor('refused for the queue', () => screen('esc').includes('queued command would be lost'), 5000);
    if (ourJobs().some(j => !before.has(j.short))) throw new Error('moved despite the queued prompt');
    // The reply, not the queued prompt itself (still shown in the input box).
    await waitFor('queued prompt ran here', () => /QUEUE-DONE[\s\S]*• QUEUED\s*$/m.test(screen('esc')), 90000);
    keys('esc', 'C-c');
    await sleep(300);
    keys('esc', 'C-c');
    await waitFor('exit', () => screen('esc').includes('EXIT:'), 15000);
    return 'cancelled + refused';
  });

  tmux('new-session', '-d', '-s', 'stream', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  await step('← mid-reply: moves at once, the background session continues the cut-off reply', async () => {
    await waitFor('repl ready', () => agentsHint('stream'), 30000);
    await sleep(500);
    const before = jobIds();
    type('stream', 'Without using any tools, write the numbers from 1 to 400, one per line, then a final line with exactly the word STREAM-END.');
    keys('stream', 'Enter');
    // Any numbered line under the prompt before the last one: the reply is
    // mid-stream (it scrolls too fast to wait for a particular number).
    await waitFor('reply streaming', () => {
      // Below the prompt box, or the whole screen once the box scrolled away.
      const text = screen('stream');
      const reply = text.includes('╰') ? text.split('╰').slice(1).join('') : text;
      return /^\s*(•\s*)?\d{1,3}\s*$/m.test(reply) && !reply.includes('STREAM-END');
    }, 90000);
    keys('stream', 'Left');
    await waitFor('moved', () => screen('stream').includes('Your conversation moved to the background'), 20000);
    const job = await newJob(before, 'fork job');
    const done = await waitFor('continued to the end', () => ourJobs().find(j => j.short === job.short && j.state === 'done' && j.output?.result), 180000);
    keys('stream', 'Enter');
    await waitFor('attached', () => !inList('stream'), 30000);
    await waitFor('continuation notice', () => screen('stream').includes('Continuing an interrupted response') || screen('stream').includes('STREAM-END'), 20000);
    const attached = screen('stream');
    keys('stream', 'Left');
    await waitFor('back in list', () => inList('stream'));
    keys('stream', 'C-c');
    await sleep(300);
    keys('stream', 'C-c');
    await waitFor('exit', () => screen('stream').includes('EXIT:0'));
    return { launchArgs: done.launchArgs, result: done.output.result, notice: attached.includes('Continuing an interrupted response') };
  });

  tmux('new-session', '-d', '-s', 'bgcmd', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  let bgJob;
  await step('/bg with nothing to move is refused; bare /bg mid-turn exits and the background session finishes the turn', async () => {
    await waitFor('repl ready', () => agentsHint('bgcmd'), 30000);
    await sleep(500);
    type('bgcmd', '/bg');
    keys('bgcmd', 'Enter');
    await waitFor('refused', () => screen('bgcmd').includes('Nothing to background yet'), 10000);
    const before = jobIds();
    type('bgcmd', 'Run this shell command in the foreground (never in the background): sleep 4 && echo SLEPT. Then reply with exactly the word BG-DONE.');
    keys('bgcmd', 'Enter');
    await waitFor('tool running', () => toolRunning('bgcmd'), 90000);
    type('bgcmd', '/bg');
    keys('bgcmd', 'Enter');
    await waitFor('exited with the backgrounded summary', () => screen('bgcmd').includes('backgrounded ·') && screen('bgcmd').includes('EXIT:0'), 30000);
    bgJob = await newJob(before, 'fork job');
    if (!screen('bgcmd').includes(`noa attach ${bgJob.short}`)) throw new Error('summary does not name the job');
    const done = await waitFor('turn finished in the background', () => ourJobs().find(j => j.short === bgJob.short && j.state === 'done' && j.output?.result?.includes('BG-DONE')), 120000);
    return { summary: screen('bgcmd').split('\n').filter(l => l.includes('backgrounded') || l.includes('noa ')).join('\n'), result: done.output.result, launchArgs: done.launchArgs };
  });

  await step('shell: --continue refuses the backgrounded conversation; logs, attach (← detaches) and stop', async () => {
    tmux('new-session', '-d', '-s', 'cont', '-x', '150', '-y', '40', '-c', repoRoot, `${launch} --continue; echo EXIT:$?; sleep 600`);
    await waitFor('refused', () => screen('cont').includes('running in the background'), 30000);
    const logs = cli('logs', bgJob.short);
    if (logs.status !== 0 || !logs.out.includes('BG-DONE')) throw new Error(`logs: ${logs.status} ${logs.out.slice(-300)}`);
    tmux('new-session', '-d', '-s', 'att', '-x', '150', '-y', '40', '-c', repoRoot, `${launch} attach ${bgJob.short}; echo EXIT:$?; sleep 600`);
    await waitFor('attached', () => screen('att').includes('BG-DONE') && agentsHint('att'), 30000);
    await sleep(500);
    // ← lands in the agents view, not the shell; ctrl+c twice quits that.
    keys('att', 'Left');
    await waitFor('detached to the agents view', () => inList('att'), 20000);
    keys('att', 'C-c');
    await sleep(300);
    keys('att', 'C-c');
    await waitFor('back in the shell', () => screen('att').includes('EXIT:0'), 20000);
    const stop = cli('stop', bgJob.short);
    if (stop.status !== 0 || !stop.out.includes('stopped')) throw new Error(`stop: ${stop.status} ${stop.out}`);
    await waitFor('host gone', () => ourJobs().find(j => j.short === bgJob.short && !hostAlive(j)), 20000);
    const json = JSON.parse(cli('agents', '--json', '--all').out);
    return { logsTail: logs.out.trim().split('\n').slice(-2).join('\n'), stop: stop.out.trim(), listed: json.some(r => r.id === bgJob.short) };
  });

  tmux('new-session', '-d', '-s', 'queued', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
  await step('/bg <prompt> typed mid-turn waits for the turn and keeps the prompt', async () => {
    await waitFor('repl ready', () => agentsHint('queued'), 30000);
    await sleep(500);
    const before = jobIds();
    type('queued', 'Run this shell command in the foreground (never in the background): sleep 3 && echo FIRST. Then reply with exactly the word FIRST-DONE.');
    keys('queued', 'Enter');
    await waitFor('tool running', () => toolRunning('queued'), 90000);
    type('queued', '/bg Reply with exactly the word CARRIED-PROMPT.');
    keys('queued', 'Enter');
    await waitFor('first turn finished here', () => screen('queued').includes('FIRST-DONE'), 90000);
    await waitFor('exited', () => screen('queued').includes('backgrounded ·') && screen('queued').includes('EXIT:0'), 30000);
    // The fork that carries the prompt (another step's fork may still be settling).
    const job = await waitFor('fork job', () => ourJobs().find(j => !before.has(j.short) && j.launchArgs?.some(a => a.includes('CARRIED-PROMPT'))), 20000);
    const done = await waitFor('prompt answered in the background', () => ourJobs().find(j => j.short === job.short && j.state === 'done' && j.output?.result?.includes('CARRIED-PROMPT')), 120000);
    return { result: done.output.result };
  });

  await step('shell: respawn and kill; /resume tags a conversation running in the background and will not open it twice', async () => {
    const respawn = cli('respawn', bgJob.short);
    if (respawn.status !== 0 || !respawn.out.includes('respawned')) throw new Error(`respawn: ${respawn.status} ${respawn.out}`);
    await waitFor('host back', () => ourJobs().find(j => j.short === bgJob.short && hostAlive(j)), 20000);
    const again = cli('respawn', bgJob.short);
    if (!again.out.includes('already running')) throw new Error(`respawn while running: ${again.out}`);
    tmux('new-session', '-d', '-s', 'res', '-x', '150', '-y', '40', '-c', repoRoot, `${launch}; echo EXIT:$?; sleep 600`);
    await waitFor('repl ready', () => agentsHint('res'), 30000);
    await sleep(500);
    type('res', `/resume ${bgJob.sessionId}`);
    keys('res', 'Enter');
    await waitFor('refused', () => screen('res').includes(`running in a background session (${bgJob.short})`), 20000);
    type('res', '/resume');
    await sleep(300);
    keys('res', 'Enter');
    await waitFor('picker tags it', () => screen('res').includes(`bg:${bgJob.short}`), 30000);
    keys('res', 'Escape');
    await sleep(500);
    keys('res', 'C-c');
    await sleep(300);
    keys('res', 'C-c');
    await waitFor('exit', () => screen('res').includes('EXIT:'), 15000);
    const kill = cli('kill', bgJob.short);
    if (kill.status !== 0 || !kill.out.includes('stopped')) throw new Error(`kill: ${kill.status} ${kill.out}`);
    await waitFor('host gone', () => ourJobs().find(j => j.short === bgJob.short && !hostAlive(j)), 20000);
    return { respawn: respawn.out.trim(), kill: kill.out.trim() };
  });

  await step('shell: --bg starts a session; ctrl+r renames it in the view; rm removes it', async () => {
    const noTask = cli('--bg');
    if (noTask.status === 0 || !noTask.out.includes('needs a task')) throw new Error(`--bg without a task: ${noTask.status} ${noTask.out}`);
    // Its own directory, so `agents --cwd` lists only this session.
    const dir = join(repoRoot, 'dist', `e2e-bg-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    try {
      const started = cliIn(dir, '--bg', 'Reply with exactly the word BGFLAG-DONE.');
      const short = /backgrounded · ([0-9a-f]{8})/.exec(started.out)?.[1];
      if (started.status !== 0 || !short) throw new Error(`--bg: ${started.status} ${started.out}`);
      await waitFor('answered in the background', () => ourJobs().find(j => j.short === short && j.state === 'done' && j.output?.result?.includes('BGFLAG-DONE')), 120000);
      tmux('new-session', '-d', '-s', 'view2', '-x', '150', '-y', '40', '-c', repoRoot, `${launch} agents --cwd ${dir}; echo EXIT:$?; sleep 600`);
      await waitFor('listed', () => inList('view2') && screen('view2').includes('Reply with exactly'), 30000);
      keys('view2', 'C-r');
      await waitFor('renaming', () => screen('view2').includes('enter to save'));
      for (let i = 0; i < 40; i++) keys('view2', 'BSpace');
      type('view2', 'e2e renamed');
      keys('view2', 'Enter');
      const renamed = await waitFor('renamed', () => ourJobs().find(j => j.short === short && j.name === 'e2e renamed' && j.nameSource === 'user'));
      await waitFor('row shows it', () => screen('view2').includes('e2e renamed'));
      keys('view2', 'C-c');
      await sleep(300);
      keys('view2', 'C-c');
      await waitFor('exit', () => screen('view2').includes('EXIT:0'), 15000);
      const pid = hostPid(renamed);
      const removed = cli('rm', short);
      if (removed.status !== 0 || !removed.out.includes(`removed ${short}`)) throw new Error(`rm: ${removed.status} ${removed.out}`);
      if (existsSync(join(jobsDir, short))) throw new Error('job directory left behind');
      await waitFor('host gone after rm', () => !pidAlive(pid), 10000);
      return { started: started.out.split('\n')[0], renamed: renamed.name, removed: removed.out.trim() };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

let status = 0;
try {
  await run();
} catch {
  status = 1;
} finally {
  const sweep = () => {
    for (const job of ourJobs()) {
      const pid = hostPid(job);
      try {
        if (pid) process.kill(pid, 'SIGTERM');
      } catch {}
      rmSync(join(jobsDir, job.short), { recursive: true, force: true });
    }
  };
  sweep();
  spawnSync('tmux', ['-L', socket, 'kill-server']);
  // A handoff still in flight when a step failed can write its job after the
  // first sweep.
  await sleep(2000);
  sweep();
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim() !== '';
  writeFileSync(artifactPath, JSON.stringify({
    command: ['bun', ...process.argv.slice(1)].join(' '),
    revision,
    dirtyWorktree: dirty,
    entry,
    configDir,
    terminal: 'tmux 150x40',
    steps,
    exitStatus: status,
    finishedAt: new Date().toISOString()
  }, null, 2));
  console.log(`${status === 0 ? 'PASS' : 'FAIL'} — artifact: ${artifactPath}`);
  process.exit(status);
}
