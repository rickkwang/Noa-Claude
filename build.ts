import { chmodSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { getLauncherBootstrapCode } from './launcher-config.js'

const args = process.argv.slice(2)
const compile = args.includes('--compile')
const dev = args.includes('--dev')

const fullExperimentalFeatures = [
  'AGENT_MEMORY_SNAPSHOT',
  'AGENT_TRIGGERS',
  'AGENT_TRIGGERS_REMOTE',
  'ALLOW_TEST_VERSIONS',
  'AUTO_THEME',
  'AWAY_SUMMARY',
  'BASH_CLASSIFIER',
  'BG_SESSIONS',
  'BRIDGE_MODE',
  'CACHED_MICROCOMPACT',
  'CCR_AUTO_CONNECT',
  'CCR_MIRROR',
  'CHICAGO_MCP',
  'COMMIT_ATTRIBUTION',
  'CONNECTOR_TEXT',
  'CONTEXT_COLLAPSE',
  'COORDINATOR_MODE',
  'DIRECT_CONNECT',
  'DOWNLOAD_USER_SETTINGS',
  'EXPERIMENTAL_SKILL_SEARCH',
  'EXTRACT_MEMORIES',
  'FILE_PERSISTENCE',
  'FORK_SUBAGENT',
  'HARD_FAIL',
  'HISTORY_PICKER',
  'HISTORY_SNIP',
  'IS_LIBC_GLIBC',
  'IS_LIBC_MUSL',
  'KAIROS',
  'KAIROS_BRIEF',
  'KAIROS_CHANNELS',
  'KAIROS_GITHUB_WEBHOOKS',
  'KAIROS_PUSH_NOTIFICATION',
  'LODESTONE',
  'MCP_RICH_OUTPUT',
  'MCP_SKILLS',
  'MESSAGE_ACTIONS',
  'MONITOR_TOOL',
  'NATIVE_CLIPBOARD_IMAGE',
  'NATIVE_CLIENT_ATTESTATION',
  'NEW_INIT',
  'OVERFLOW_TEST_TOOL',
  'POWERSHELL_AUTO_MODE',
  'PROMPT_CACHE_BREAK_DETECTION',
  'QUICK_SEARCH',
  'REACTIVE_COMPACT',
  'REVIEW_ARTIFACT',
  'SHOT_STATS',
  'SKILL_IMPROVEMENT',
  'SLOW_OPERATION_LOGGING',
  'SSH_REMOTE',
  'TEAMMEM',
  'TEMPLATES',
  'TERMINAL_PANEL',
  'TOKEN_BUDGET',
  'TRANSCRIPT_CLASSIFIER',
  'TREE_SITTER_BASH',
  'TREE_SITTER_BASH_SHADOW',
  'UDS_INBOX',
  'ULTRATHINK',
  'UNATTENDED_RETRY',
  'UPLOAD_USER_SETTINGS',
  'VERIFICATION_AGENT',
  'VOICE_MODE',
  'WEB_BROWSER_TOOL',
  'WORKFLOW_SCRIPTS',
] as const

async function runCommand(cmd: string[]): Promise<string | null> {
  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const [stdout, stderr] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(''),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(''),
  ])

  const code = await proc.exited
  if (code !== 0) {
    return null
  }
  return stdout.trim() || null
}

async function getDevVersion(baseVersion: string): Promise<string> {
  const timestamp = new Date().toISOString()
  const date = timestamp.slice(0, 10).replaceAll('-', '')
  const time = timestamp.slice(11, 19).replaceAll(':', '')
  const sha = (await runCommand(['git', 'rev-parse', '--short=8', 'HEAD'])) ?? 'unknown'
  return `${baseVersion}-dev.${date}.t${time}.sha${sha}`
}

async function getVersionChangelog(): Promise<string> {
  return (await runCommand(['git', 'log', '--format=%h %s', '-20'])) ?? 'Local development build'
}

function getBundledReleaseNotes(): string {
  try {
    return readFileSync('./docs/release-notes.md', 'utf-8').trim()
  } catch {
    return ''
  }
}

const defaultFeatures = ['VOICE_MODE']
const featureSet = new Set<string>(defaultFeatures)

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--feature-set' && args[i + 1]) {
    if (args[i + 1] === 'dev-full') {
      for (const feature of fullExperimentalFeatures) {
        featureSet.add(feature)
      }
    }
    i += 1
    continue
  }
  if (arg === '--feature-set=dev-full') {
    for (const feature of fullExperimentalFeatures) {
      featureSet.add(feature)
    }
    continue
  }
  if (arg === '--feature' && args[i + 1]) {
    featureSet.add(args[i + 1]!)
    i += 1
    continue
  }
  if (arg?.startsWith('--feature=')) {
    featureSet.add(arg.slice('--feature='.length))
  }
}

const features = [...featureSet]

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  name: string
  version: string
}

const cliOutfile = dev ? './dist/cli-dev' : './dist/cli'
const bundleOutfile = dev ? './dist/main-dev.js' : './dist/main.js'
const outfile = bundleOutfile

const buildTime = new Date().toISOString()
const version = dev ? await getDevVersion(pkg.version) : pkg.version

const outDir = dirname(outfile)
if (outDir !== '.') {
  mkdirSync(outDir, { recursive: true })
}

const externals = [
  'audio-capture-napi',
  'image-processor-napi',
  'modifiers-napi',
  'url-handler-napi',
  'sharp',
]

const versionChangelog = getBundledReleaseNotes()

const defines: Record<string, string> = {
  'process.env.USER_TYPE': JSON.stringify('external'),
  ...(dev ? { 'process.env.NODE_ENV': JSON.stringify('development') } : {}),
  ...(dev
    ? { 'process.env.CLAUDE_CODE_EXPERIMENTAL_BUILD': JSON.stringify('true') }
    : {}),
  'process.env.CLAUDE_CODE_VERIFY_PLAN': JSON.stringify('false'),
  'process.env.CCR_FORCE_BUNDLE': JSON.stringify('true'),
  'MACRO.VERSION': JSON.stringify(version),
  'MACRO.BUILD_TIME': JSON.stringify(buildTime),
  'MACRO.PACKAGE_URL': JSON.stringify(pkg.name),
  'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  'MACRO.FEEDBACK_CHANNEL': JSON.stringify('github'),
  'MACRO.ISSUES_EXPLAINER': JSON.stringify(
    'This reconstructed source snapshot does not include Anthropic internal issue routing.',
  ),
  'MACRO.VERSION_CHANGELOG': JSON.stringify(versionChangelog),
}

console.log('Building Claude Agent...')
console.log(`Version: ${version}`)
if (compile) {
  console.log(`Bundle output: ${bundleOutfile}`)
  console.log(`Binary output: ${cliOutfile}`)
} else {
  console.log(`Output: ${outfile}`)
}
console.log(`Compile: ${compile}`)
if (features.length > 0) {
  console.log(`Features: ${features.join(', ')}`)
}

const bundleCmd = [
  'bun',
  'build',
  './src/main.tsx',
  '--target',
  'bun',
  '--format',
  'esm',
  '--outfile',
  outfile,
]

for (const external of externals) {
  bundleCmd.push('--external', external)
}

for (const feature of features) {
  bundleCmd.push(`--feature=${feature}`)
}

for (const [key, value] of Object.entries(defines)) {
  bundleCmd.push('--define', `${key}=${value}`)
}

const proc = Bun.spawn(bundleCmd, {
  stdio: ['inherit', 'inherit', 'inherit'],
})

const code = await proc.exited
if (code === 0 && existsSync(outfile)) {
  chmodSync(outfile, 0o755)
  console.log(`Built ${outfile}`)
} else if (code !== 0) {
  process.exit(code ?? 1)
}

// Patch the bundled output before optional binary compilation.
if (code === 0) {
  const content = readFileSync(outfile, 'utf-8')
  let patched = content
  patched = patched
    .replace(/"external"\s*===\s*'ant'/g, 'true')
    .replace(/'external'\s*===\s*"ant"/g, 'true')
    .replace(/"external"\s*!==\s*'ant'/g, 'false')
    .replace(/'external'\s*!==\s*"ant"/g, 'false')

  writeFileSync(outfile, patched + '\n' + getLauncherBootstrapCode())
  console.log(`Build complete: ${outfile}`)
}

if (compile && code === 0) {
  const compileCmd = [
    'bun',
    'build',
    bundleOutfile,
    '--target',
    'bun',
    '--format',
    'esm',
    '--compile',
    '--bytecode',
    '--outfile',
    cliOutfile,
  ]

  for (const external of externals) {
    compileCmd.push('--external', external)
  }

  const compileProc = Bun.spawn(compileCmd, {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const compileCode = await compileProc.exited
  if (compileCode !== 0) {
    process.exit(compileCode ?? 1)
  }
  if (!existsSync(cliOutfile)) {
    console.error(`Compiled binary missing: ${cliOutfile}`)
    process.exit(1)
  }
  chmodSync(cliOutfile, 0o755)
  console.log(`Built standalone binary: ${cliOutfile}`)
}
