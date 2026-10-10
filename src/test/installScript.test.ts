import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, test } from 'bun:test'

const repoRoot = resolve(import.meta.dir, '../..')
const installScript = readFileSync(resolve(repoRoot, 'install.sh'), 'utf8')

// Derived, not hardcoded: the release process bumps FALLBACK_REF in install.sh,
// and a literal here silently drifts out of sync with it.
const fallbackRef = installScript.match(/^FALLBACK_REF="([^"]+)"$/m)?.[1]
if (!fallbackRef) throw new Error('install.sh is missing FALLBACK_REF')

function runResolver(
  firstPage: unknown[],
  secondPage: unknown[] = [],
  failSecondPage = false,
) {
  const testRoot = mkdtempSync(resolve(tmpdir(), 'noa-install-resolver-'))
  const fakeBin = resolve(testRoot, 'bin')
  mkdirSync(fakeBin)

  const fakeCurl = resolve(fakeBin, 'curl')
  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
set -euo pipefail
original_args="$*"
url=""
output=""
while (($#)); do
  case "$1" in
    -o) shift; output="$1" ;;
    http*) url="$1" ;;
  esac
  shift
done
if [[ "$url" == *"/releases?"* ]]; then
  if [[ "$original_args" != *"--connect-timeout 5"* || "$original_args" != *"--max-time 10"* ]]; then
    exit 64
  fi
  case "$url" in
    *"page=1") printf '%s' "\${NOA_TEST_RELEASES_PAGE_1}" ;;
    *"page=2")
      if [[ "\${NOA_TEST_RELEASES_FAIL_PAGE_2}" == "1" ]]; then
        exit 22
      fi
      printf '%s' "\${NOA_TEST_RELEASES_PAGE_2}"
      ;;
    *) printf '[]' ;;
  esac
  exit 0
fi
if [[ -n "$output" ]]; then
  : > "$output"
  exit 0
fi
exit 1
`,
  )
  chmodSync(fakeCurl, 0o755)

  const fakeTar = resolve(fakeBin, 'tar')
  writeFileSync(fakeTar, '#!/usr/bin/env bash\nexit 42\n')
  chmodSync(fakeTar, 0o755)

  try {
    return spawnSync('bash', ['-s'], {
      input: installScript,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: testRoot,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        NOA_TEST_RELEASES_PAGE_1: JSON.stringify(firstPage),
        NOA_TEST_RELEASES_PAGE_2: JSON.stringify(secondPage),
        NOA_TEST_RELEASES_FAIL_PAGE_2: failSecondPage ? '1' : '0',
      },
    })
  } finally {
    rmSync(testRoot, { recursive: true, force: true })
  }
}

function runLocalInstall(existingTarget: (installDir: string) => string) {
  const testRoot = mkdtempSync(resolve(tmpdir(), 'noa-install-symlink-'))
  const fakeBin = resolve(testRoot, 'fake-bin')
  const binDir = resolve(testRoot, '.local/bin')
  const sourceDir = resolve(testRoot, 'source')
  const installDir = resolve(testRoot, 'install')
  const victimDir = resolve(testRoot, 'victim')
  mkdirSync(fakeBin)
  mkdirSync(binDir, { recursive: true })
  mkdirSync(resolve(sourceDir, 'bin'), { recursive: true })
  mkdirSync(victimDir)
  writeFileSync(resolve(sourceDir, 'bin/noa.js'), '')
  // install.sh canonicalizes paths with `bun -e`; that call must reach the real
  // runtime, while the build and smoke-test calls stay stubbed out.
  writeFileSync(
    resolve(fakeBin, 'bun'),
    `#!/usr/bin/env bash\nif [[ "$1" == "-e" ]]; then exec ${JSON.stringify(process.execPath)} "$@"; fi\nexit 0\n`,
  )
  chmodSync(resolve(fakeBin, 'bun'), 0o755)
  symlinkSync(existingTarget(installDir), resolve(binDir, 'noa'))

  const result = spawnSync('bash', ['-s'], {
    input: installScript,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: testRoot,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      NOA_INSTALL_SOURCE_DIR: sourceDir,
      NOA_INSTALL_TARGET_DIR: installDir,
    },
  })

  return {
    result,
    binLink: resolve(binDir, 'noa'),
    // install.sh writes the canonical spelling (macOS tmpdir is /var -> /private/var).
    expectedTarget: resolve(realpathSync(testRoot), 'install/bin/noa.js'),
    victimEntry: resolve(victimDir, 'noa.js'),
    cleanup: () => rmSync(testRoot, { recursive: true, force: true }),
  }
}

describe('install.sh latest release resolution', () => {
  test('excludes draft and prerelease releases by flag', () => {
    const result = runResolver([
      { tag_name: 'v1.12.0', draft: true },
      { tag_name: 'v1.11.0', prerelease: true },
      { tag_name: '9.9.9' },
      { tag_name: 'v1.10.0' },
    ])

    expect(result.status).toBe(42)
    expect(result.stdout).toContain('Installing release: v1.10.0')
  })

  test('reads every release page before choosing the semver max', () => {
    const firstPage = Array.from({ length: 100 }, (_, patch) => ({
      tag_name: `v1.0.${patch}`,
    }))
    const result = runResolver(firstPage, [{ tag_name: 'v2.0.0' }])

    expect(result.status).toBe(42)
    expect(result.stdout).toContain('Installing release: v2.0.0')
  })

  test('falls back instead of trusting a partial page set', () => {
    const firstPage = Array.from({ length: 100 }, () => ({
      tag_name: 'v9.9.9',
    }))
    const result = runResolver(firstPage, [], true)

    expect(result.status).toBe(42)
    expect(result.stdout).toContain(`Installing release: ${fallbackRef}`)
    expect(result.stdout).not.toContain('Installing release: v9.9.9')
  })
})

describe('install.sh symlink replacement', () => {
  test('rejects an external directory target disguised with dot-dot', () => {
    const run = runLocalInstall(installDir => `${installDir}/../victim`)
    try {
      expect(run.result.status).toBe(1)
      expect(run.result.stderr).toContain('does not point to this installation')
      expect(existsSync(run.victimEntry)).toBeFalse()
    } finally {
      run.cleanup()
    }
  })

  test('replaces an existing installer-owned link without following it', () => {
    const run = runLocalInstall(installDir => resolve(installDir, 'bin/noa.js'))
    try {
      expect(run.result.status).toBe(0)
      expect(readlinkSync(run.binLink)).toBe(run.expectedTarget)
    } finally {
      run.cleanup()
    }
  })
})

// Runs install.sh as a file on disk (not piped), so the BASH_SOURCE branch in
// resolve_root_dir decides between checkout and download. bun's canonical-path
// call reaches the real runtime; everything else is stubbed. curl serves one
// release and an empty tarball; tar fails with a marker status proving the
// download path was taken.
function runScriptFile(sourceDir: string) {
  const testRoot = mkdtempSync(resolve(tmpdir(), 'noa-install-checkout-'))
  const fakeBin = resolve(testRoot, 'fake-bin')
  mkdirSync(fakeBin)
  writeFileSync(
    resolve(fakeBin, 'bun'),
    `#!/usr/bin/env bash\nif [[ "$1" == "-e" ]]; then exec ${JSON.stringify(process.execPath)} "$@"; fi\nexit 0\n`,
  )
  writeFileSync(
    resolve(fakeBin, 'curl'),
    `#!/usr/bin/env bash
url=""
output=""
while (($#)); do
  case "$1" in
    -o) shift; output="$1" ;;
    http*) url="$1" ;;
  esac
  shift
done
if [[ "$url" == *"/releases?"* ]]; then printf '[{"tag_name":"v9.9.9"}]'; exit 0; fi
if [[ -n "$output" ]]; then : > "$output"; exit 0; fi
exit 1
`,
  )
  writeFileSync(resolve(fakeBin, 'tar'), '#!/usr/bin/env bash\nexit 42\n')
  for (const f of ['bun', 'curl', 'tar']) {
    chmodSync(resolve(fakeBin, f), 0o755)
  }
  writeFileSync(resolve(sourceDir, 'install.sh'), installScript)

  const result = spawnSync('bash', [resolve(sourceDir, 'install.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: testRoot,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      NOA_INSTALL_TARGET_DIR: resolve(testRoot, 'install'),
      NOA_INSTALL_SOURCE_DIR: '',
      NOA_INSTALL_REF: '',
      NOA_INSTALL_REPO_TARBALL_URL: '',
    },
  })
  return {
    result,
    testRoot,
    binLink: resolve(testRoot, '.local/bin/noa'),
    expectedTarget: resolve(realpathSync(testRoot), 'install/bin/noa.js'),
    cleanup: () => rmSync(testRoot, { recursive: true, force: true }),
  }
}

describe('install.sh checkout detection', () => {
  test('a script sitting in this repo runs from the checkout', () => {
    const testRoot = mkdtempSync(resolve(tmpdir(), 'noa-install-source-'))
    const sourceDir = resolve(testRoot, 'source')
    mkdirSync(resolve(sourceDir, 'bin'), { recursive: true })
    writeFileSync(resolve(sourceDir, 'bin/noa.js'), '')
    writeFileSync(
      resolve(sourceDir, 'package.json'),
      '{"name":"@rickkwang/noa-claude"}\n',
    )
    const run = runScriptFile(sourceDir)
    try {
      expect(run.result.status).toBe(0)
      expect(run.result.stdout).not.toContain('Downloading Noa Claude source')
      expect(readlinkSync(run.binLink)).toBe(run.expectedTarget)
    } finally {
      run.cleanup()
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  test('a standalone-downloaded script falls through to the download path', () => {
    const testRoot = mkdtempSync(resolve(tmpdir(), 'noa-install-foreign-'))
    const sourceDir = resolve(testRoot, 'foreign')
    mkdirSync(sourceDir)
    writeFileSync(
      resolve(sourceDir, 'package.json'),
      '{"name":"someone-else"}\n',
    )
    const run = runScriptFile(sourceDir)
    try {
      expect(run.result.status).toBe(42)
      expect(run.result.stdout).toContain('Downloading Noa Claude source (v9.9.9)')
    } finally {
      run.cleanup()
      rmSync(testRoot, { recursive: true, force: true })
    }
  })
})
