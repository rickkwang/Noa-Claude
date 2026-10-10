#!/usr/bin/env node
// Lifecycle of the curl-installed copy, end to end: install, reinstall, failed
// and successful update, uninstall, purge. Packs the working tree (tracked and
// untracked, not ignored), installs it with install.sh into throwaway HOME
// directories, and drives the real CLI. The successful update reaches GitHub and
// `bun install` reaches the npm registry.
//
// Evidence is kept in dist/e2e-install-lifecycle/<UTC stamp>/: summary.json
// (command, revision, snapshot digest, every check and step), inputs.txt (the
// packed files), noa-snapshot.tar.gz, and steps/NN.log (argv, env, exit status,
// full output). Evidence is written even when the run aborts midway.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const startedAt = new Date()
const stamp = startedAt.toISOString().replace(/[:.]/g, '-')
const artifacts = join(repo, 'dist', 'e2e-install-lifecycle', stamp)
const work = mkdtempSync(join(tmpdir(), 'noa-lifecycle-'))
const home = join(work, 'home')
const bin = join(home, '.local', 'bin', 'noa')
const configDir = join(home, '.noa')
const defaultInstall = join(configDir, 'install')
const customInstall = join(work, 'custom') // absolute, spelled through the tmpdir
const tarball = join(work, 'noa.tar.gz')
const snapshot = join(work, 'pkg', 'Noa-Claude-1.19.0')
const installScript = readFileSync(join(repo, 'install.sh'), 'utf8')
const steps = []
const checks = []
let failures = 0
let files = []
let tarballBytes = Buffer.alloc(0)
let bunVersion = ''

mkdirSync(join(artifacts, 'steps'), { recursive: true })

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const entry = (dir) => join(dir, 'bin', 'noa.js')
const linkTarget = () => (existsSync(bin) ? readlinkSync(bin) : null)
const git = (args) =>
  spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim()

function check(name, ok, detail = '') {
  checks.push({ name, ok, ...(ok ? {} : { detail }) })
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}

// Runs one command with a clean environment (PATH and HOME only, plus `env`),
// writes its evidence to steps/NN.log, and returns the exit status and output.
function step(argv, { cwd, env = {}, input, note = '' } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd,
    input,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...env },
  })
  const status = r.status ?? `signal ${r.signal}`
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const id = String(steps.length + 1).padStart(2, '0')
  const log = `steps/${id}.log`
  writeFileSync(
    join(artifacts, log),
    [
      `$ ${argv.join(' ')}`,
      `cwd: ${cwd ?? process.cwd()}`,
      `env: ${JSON.stringify({ HOME: env.HOME ?? home, ...env })}`,
      ...(input === undefined ? [] : [`stdin sha256: ${sha256(input)}`]),
      `exit: ${status}`,
      '--- output ---',
      output,
    ].join('\n'),
  )
  steps.push({ id, argv, env, note, status, log })
  return { status, output }
}

const install = (env = {}, note = 'install.sh from the working tree') =>
  step(['bash', '-s'], {
    input: installScript,
    note,
    env: { NOA_INSTALL_REPO_TARBALL_URL: `file://${tarball}`, ...env },
  })

function writeEvidence(fatal) {
  if (tarballBytes.length > 0) {
    writeFileSync(join(artifacts, 'noa-snapshot.tar.gz'), tarballBytes)
  }
  writeFileSync(join(artifacts, 'inputs.txt'), `${files.join('\n')}\n`)
  const passed = checks.filter((c) => c.ok).length
  writeFileSync(
    join(artifacts, 'summary.json'),
    `${JSON.stringify(
      {
        command: 'bun run e2e:install',
        startedAt,
        finishedAt: new Date(),
        revision: git(['rev-parse', 'HEAD']),
        workingTreeDirty: git(['status', '--porcelain']) !== '',
        snapshot: {
          file: 'noa-snapshot.tar.gz',
          sha256: sha256(tarballBytes),
          files: files.length,
        },
        runtime: {
          node: process.version,
          bun: bunVersion,
          platform: process.platform,
          arch: process.arch,
        },
        checks,
        steps,
        fatal: fatal ? String(fatal.stack ?? fatal) : null,
        result: { passed, total: checks.length, failures },
      },
      null,
      2,
    )}\n`,
  )
}

let fatal = null
try {
  // 1. Snapshot the working tree the way a release tarball would look.
  files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repo,
    encoding: 'utf8',
  })
    .stdout.split('\0')
    .filter((rel) => rel && existsSync(join(repo, rel)))
  for (const rel of files) {
    mkdirSync(dirname(join(snapshot, rel)), { recursive: true })
    copyFileSync(join(repo, rel), join(snapshot, rel))
  }
  spawnSync('tar', ['-czf', tarball, '-C', join(work, 'pkg'), 'Noa-Claude-1.19.0'])
  tarballBytes = readFileSync(tarball)
  bunVersion = step(['bun', '--version']).output.trim()
  mkdirSync(join(home, '.local', 'bin'), { recursive: true })

  // 2. Default install: canonical link, launcher works from anywhere, config written.
  const d = install()
  check('default install exits 0', d.status === 0, d.output.slice(-300))
  check(
    'default link is canonical',
    linkTarget() === join(realpathSync(home), '.noa', 'install', 'bin', 'noa.js'),
    linkTarget(),
  )
  check(
    'launcher runs from another cwd',
    step([bin, '--version'], { cwd: work }).output.includes('Noa Claude'),
  )
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'marker-settings.json'), '{"marker":true}\n')
  writeFileSync(join(configDir, 'marker-history.jsonl'), '{"marker":true}\n')

  // 3. Custom install through the /tmp spelling, then the reinstall that
  //    `noa update` performs with the canonical spelling.
  const c1 = install(
    { NOA_INSTALL_TARGET_DIR: customInstall, NOA_INSTALL_FORCE_SYMLINK: '1' },
    'custom install, absolute path through tmpdir',
  )
  check('custom install exits 0', c1.status === 0, c1.output.slice(-300))
  const canonicalCustom = join(realpathSync(work), 'custom')
  const c2 = install(
    { NOA_INSTALL_TARGET_DIR: canonicalCustom },
    'reinstall over own link, canonical spelling',
  )
  check(
    'reinstall over own link with canonical spelling exits 0',
    c2.status === 0 && linkTarget() === entry(canonicalCustom),
    c2.output.slice(-300),
  )

  // 4. Checkout copies must not act on the installed copy.
  const notInstalled = 'not an installed Noa Claude'
  const checkoutUninstall = step(['bun', entry(repo), 'uninstall', '--yes'], {
    note: 'uninstall from the source checkout',
  })
  check(
    'uninstall from a checkout refuses',
    checkoutUninstall.status === 1 && checkoutUninstall.output.includes(notInstalled),
    checkoutUninstall.output.slice(-200),
  )
  check('checkout refusal removed nothing', existsSync(entry(canonicalCustom)))
  const checkoutUpdate = step(['bun', entry(repo), 'update', '--yes'], {
    note: 'update from the source checkout',
  })
  check(
    'update from a checkout refuses',
    checkoutUpdate.status === 1 && checkoutUpdate.output.includes(notInstalled),
    checkoutUpdate.output.slice(-200),
  )

  // 5. Forced download path: NOA_INSTALL_REF skips the release lookup, and the
  //    proxy makes curl fail with exit 7. The update must report exactly that and
  //    leave the installed copy runnable.
  const failed = step(['bun', entry(canonicalCustom), 'update', '--yes'], {
    note: 'update with the download forced to fail',
    env: {
      NOA_INSTALL_REF: 'v1.19.0',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      HTTP_PROXY: 'http://127.0.0.1:9',
    },
  })
  check('failed download exits with curl status 7', failed.status === 7, `status=${failed.status}`)
  check(
    'failed update reached the download step',
    failed.output.includes('re-running the curl installer') &&
      failed.output.includes('curl: (7)'),
    failed.output.slice(-300),
  )
  const stillRuns = step(['bun', entry(canonicalCustom), '--version'])
  check(
    'installed copy still runs after the failed update',
    stillRuns.output.includes('Noa Claude'),
    stillRuns.output.slice(-200),
  )

  // 6. A global link owned by someone else is never followed or removed.
  const project = join(work, 'project')
  mkdirSync(join(project, 'bin'), { recursive: true })
  writeFileSync(join(project, 'bin', 'noa.js'), '')
  writeFileSync(join(project, 'package.json'), '{"name":"someone-else"}')
  writeFileSync(join(project, 'keep.txt'), 'keep')
  unlinkSync(bin)
  symlinkSync(entry(project), bin)
  const foreign = step(['bun', entry(canonicalCustom), 'uninstall', '--yes'], {
    note: 'uninstall with a foreign global link',
  })
  check('uninstall with foreign link exits 0', foreign.status === 0, foreign.output.slice(-300))
  check('custom copy removed', !existsSync(canonicalCustom))
  check('foreign project intact', existsSync(join(project, 'keep.txt')))
  check('foreign link kept', linkTarget() === entry(project))

  // 7. HOME guard: a copy installed at exactly its own HOME must refuse to uninstall
  //    even when HOME is spelled through a symlink (macOS tmpdir: /var -> /private/var).
  //    The copy is a real install (dist built), so refusal is the only way it exits 1.
  const guardHome = join(work, 'home-guard')
  const guardInstall = install(
    { HOME: guardHome, NOA_INSTALL_TARGET_DIR: guardHome },
    'install whose install root is HOME',
  )
  check('install rooted at HOME exits 0', guardInstall.status === 0, guardInstall.output.slice(-300))
  writeFileSync(join(guardHome, 'sentinel.txt'), 'home')
  const guard = step(['bun', entry(guardHome), 'uninstall', '--yes'], {
    note: 'uninstall of a copy whose install root is HOME',
    env: { HOME: guardHome },
  })
  check(
    'uninstall of a copy rooted at HOME refuses',
    guard.status === 1 && guard.output.includes(notInstalled),
    `status=${guard.status} ${guard.output.slice(-200)}`,
  )
  check('HOME guard kept the sentinel', existsSync(join(guardHome, 'sentinel.txt')))
  check('HOME guard kept the copy', existsSync(entry(guardHome)))

  // 8. Purge boundary and config retention, on a fresh default install.
  const d2 = install({ NOA_INSTALL_FORCE_SYMLINK: '1' }, 'default reinstall for purge checks')
  check('default reinstall exits 0', d2.status === 0, d2.output.slice(-300))
  const purgeRefused = step(['bun', entry(defaultInstall), 'uninstall', '--purge', '--yes'], {
    note: 'purge with CLAUDE_CONFIG_DIR set to HOME',
    env: { CLAUDE_CONFIG_DIR: home },
  })
  check(
    'purge with config dir = HOME refuses',
    purgeRefused.status === 1 && purgeRefused.output.includes('Refusing to purge'),
    `status=${purgeRefused.status} ${purgeRefused.output.slice(-200)}`,
  )
  check('refused purge kept the install', existsSync(entry(defaultInstall)))
  check('refused purge kept the markers', existsSync(join(configDir, 'marker-history.jsonl')))
  // A custom config directory is never removed automatically, even with other data in it.
  const docs = join(work, 'Documents')
  mkdirSync(docs, { recursive: true })
  writeFileSync(join(docs, 'work.txt'), 'important')
  const customPurge = step(['bun', entry(defaultInstall), 'uninstall', '--purge', '--yes'], {
    note: 'purge with a custom config directory that holds other data',
    env: { CLAUDE_CONFIG_DIR: docs },
  })
  check(
    'purge with a custom config dir refuses and prints the rm command',
    customPurge.status === 1 && customPurge.output.includes(`rm -rf ${docs}`),
    `status=${customPurge.status} ${customPurge.output.slice(-200)}`,
  )
  check('custom config directory kept its data', existsSync(join(docs, 'work.txt')))

  const normal = step(['bun', entry(defaultInstall), 'uninstall', '--yes'], {
    note: 'normal uninstall, config kept',
  })
  check('normal uninstall exits 0', normal.status === 0, normal.output.slice(-300))
  check(
    'normal uninstall removed directory and link',
    !existsSync(defaultInstall) && linkTarget() === null,
  )
  check('normal uninstall kept the config markers', existsSync(join(configDir, 'marker-settings.json')))

  const d3 = install({}, 'default reinstall before purge')
  check('reinstall before purge exits 0', d3.status === 0, d3.output.slice(-300))
  const purge = step(['bun', entry(defaultInstall), 'uninstall', '--purge', '--yes'], {
    note: 'normal purge of the default config directory',
  })
  check('normal purge exits 0', purge.status === 0, purge.output.slice(-300))
  check('normal purge removed the config directory', !existsSync(configDir))

  // 9. Successful update through the real CLI, with NOA_INSTALL_REF pinning the
  //    release so the download path runs. The custom copy must be replaced by the
  //    release tarball (it lacks files added after v1.19.0) and keep its link.
  const c3 = install({ NOA_INSTALL_TARGET_DIR: customInstall }, 'custom install before update')
  check('custom install before update exits 0', c3.status === 0, c3.output.slice(-300))
  const hookFile = join(customInstall, 'src', 'hooks', 'notifs', 'useUpdateAvailableNotification.ts')
  check('custom copy starts from the working-tree snapshot', existsSync(hookFile))
  const update = step(['bun', entry(canonicalCustom), 'update', '--yes'], {
    note: 'successful update to the pinned release v1.19.0',
    env: { NOA_INSTALL_REF: 'v1.19.0' },
  })
  check('successful update exits 0', update.status === 0, update.output.slice(-300))
  check(
    'update downloaded the pinned release',
    update.output.includes('Downloading Noa Claude source (v1.19.0)') &&
      update.output.includes('Installed: Noa Claude'),
    update.output.slice(-300),
  )
  check('update kept the custom link', linkTarget() === entry(canonicalCustom), linkTarget())
  check('update replaced the copy with the release', !existsSync(hookFile))
  const updated = step(['bun', entry(canonicalCustom), '--version'])
  check('updated copy starts', updated.output.includes('Noa Claude'), updated.output.slice(-200))
} catch (err) {
  fatal = err
  failures += 1
  console.error(err)
} finally {
  writeEvidence(fatal)
  rmSync(work, { recursive: true, force: true })
}

const passed = checks.filter((c) => c.ok).length
console.log(`\n${passed}/${checks.length} checks passed${fatal ? ' (run aborted)' : ''}`)
console.log(`evidence: dist/e2e-install-lifecycle/${stamp}`)
process.exit(failures === 0 ? 0 : 1)
