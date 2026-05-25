import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { dirname, join, resolve } from 'path'
import type { BunPlugin } from 'bun'
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
  // Former desktop-control MCP flag intentionally omitted: noa now uses its
  // own native ComputerTool (src/tools/ComputerTool).
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

const defaultFeatures = ['VOICE_MODE', 'AUTO_THEME']
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
const featureFlags: Record<string, boolean> = {}
for (const f of features) {
  featureFlags[f] = true
}

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

// ── Pre-process: replace feature() calls with boolean literals ──────────────
// Bun.build() API does not support --feature CLI flags. We pre-process source
// files to strip the bun:bundle import and replace feature('FLAG') with true/false.
// Files are modified in-place before Bun.build() and restored in a finally block.

const featureCallRe = /\bfeature\(\s*['"](\w+)['"][,\s]*\)/gs
const featureImportRe = /import\s*\{[^}]*\bfeature\b[^}]*\}\s*from\s*['"]bun:bundle['"];?\s*\n?/g
const modifiedFiles = new Map<string, string>()

function preProcessFeatureFlags(dir: string) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      preProcessFeatureFlags(full)
      continue
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue

    const raw = readFileSync(full, 'utf-8')
    if (!raw.includes('feature(')) continue

    let contents = raw
    contents = contents.replace(featureImportRe, '')
    contents = contents.replace(featureCallRe, (_match, name) =>
      String(featureFlags[name] ?? false),
    )

    if (contents !== raw) {
      modifiedFiles.set(full, raw)
      writeFileSync(full, contents)
    }
  }
}

function restoreModifiedFiles() {
  for (const [path, original] of modifiedFiles) {
    writeFileSync(path, original)
  }
  modifiedFiles.clear()
}

preProcessFeatureFlags(join(import.meta.dirname ?? '.', 'src'))
const numModified = modifiedFiles.size

// Restore source files on abrupt termination
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    restoreModifiedFiles()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  })
}

const externals = [
  'audio-capture-napi',
  'image-processor-napi',
  'modifiers-napi',
  'url-handler-napi',
  'sharp',
]

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
    'https://github.com/rickkwang/Claude-Agent/issues',
  ),
  'MACRO.VERSION_CHANGELOG': JSON.stringify(getBundledReleaseNotes()),
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

// ── Bun plugin: stub missing optional modules ───────────────────────────────
const reactPackageRoots = {
  react: realpathSync(resolve('./node_modules/react')),
  reactDom: realpathSync(resolve('./node_modules/react-dom')),
  reactReconciler: realpathSync(resolve('./node_modules/react-reconciler')),
}

function resolveReactAlias(specifier: string): string | null {
  const resolveExistingFile = (basePath: string): string => {
    if (existsSync(basePath)) {
      return basePath
    }
    if (existsSync(`${basePath}.js`)) {
      return `${basePath}.js`
    }
    return join(basePath, 'index.js')
  }

  if (specifier === 'react') {
    return join(reactPackageRoots.react, 'index.js')
  }
  if (specifier.startsWith('react/')) {
    return resolveExistingFile(
      join(reactPackageRoots.react, specifier.slice('react/'.length)),
    )
  }
  if (specifier === 'react-dom') {
    return join(reactPackageRoots.reactDom, 'index.js')
  }
  if (specifier.startsWith('react-dom/')) {
    return resolveExistingFile(
      join(reactPackageRoots.reactDom, specifier.slice('react-dom/'.length)),
    )
  }
  if (specifier === 'react-reconciler') {
    return join(reactPackageRoots.reactReconciler, 'index.js')
  }
  if (specifier.startsWith('react-reconciler/')) {
    return resolveExistingFile(
      join(
        reactPackageRoots.reactReconciler,
        specifier.slice('react-reconciler/'.length),
      ),
    )
  }
  return null
}

const dedupeReactPlugin: BunPlugin = {
  name: 'dedupe-react-runtime',
  setup(build) {
    build.onResolve(
      { filter: /^(react|react-dom|react-reconciler)(\/.*)?$/ },
      args => {
        const aliasedPath = resolveReactAlias(args.path)
        if (!aliasedPath) {
          return
        }
        return { path: aliasedPath }
      },
    )
  },
}

const stubPlugin: BunPlugin = {
  name: 'stub-optional-modules',
  setup(build) {
    // Modules that may not be installed at build time
    const stubModules = [
      '@ant/claude-for-chrome-mcp',
      '@anthropic-ai/sandbox-runtime',
      // ink pulls react-devtools-core in dev mode; not needed for prod bundle.
      'react-devtools-core',
    ]

    for (const mod of stubModules) {
      build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
        path: mod,
        namespace: 'optional-stub',
      }))
    }

    build.onLoad({ filter: /.*/, namespace: 'optional-stub' }, () => ({
      contents: `
const noop = () => null;
const handler = {
  get(_, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return new Proxy({}, handler);
    if (prop === 'SandboxRuntimeConfigSchema') return { parse: () => ({}) };
    return noop;
  }
};
const stub = new Proxy(noop, handler);
export default stub;
export const __stub = true;
export const BROWSER_TOOLS = [];
export const createClaudeForChromeMcpServer = noop;
export const SandboxViolationStore = null;
// Return undefined for SandboxManager properties so that
// sandbox-adapter.ts callBaseSandboxMethod() falls back correctly.
export const SandboxManager = new Proxy({}, { get: () => undefined });
export const SandboxRuntimeConfigSchema = { parse: () => ({}) };
`,
      loader: 'js',
    }))
  },
}

// Convert --define flags for Bun.build API
const defineEntries: Record<string, string> = {}
for (const [key, value] of Object.entries(defines)) {
  defineEntries[key] = value
}

try {
  const result = await Bun.build({
    entrypoints: ['./src/main.tsx'],
    target: 'bun',
    format: 'esm',
    outdir: dirname(resolve(outfile)),
    external: externals,
    define: defineEntries,
    plugins: [dedupeReactPlugin, stubPlugin],
  })

  if (!result.success) {
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Bun.build writes to outdir, but we need a single outfile name.
  // Find the output file and rename if needed.
  const outputFile = result.outputs.find(o => o.kind === 'entry-point')
  if (!outputFile) {
    console.error('No entry-point output found')
    process.exit(1)
  }

  // If the output path doesn't match our expected outfile, copy it
  const actualPath = outputFile.path
  const expectedPath = resolve(outfile)
  if (actualPath !== expectedPath) {
    const content = readFileSync(actualPath, 'utf-8')
    writeFileSync(expectedPath, content)
  }

  chmodSync(expectedPath, 0o755)
  console.log(`Built ${outfile}`)

  // Patch the bundled output before optional binary compilation.
  {
    const content = readFileSync(expectedPath, 'utf-8')
    let patched = content
    patched = patched
      .replace(/"external"\s*===\s*'ant'/g, 'true')
      .replace(/'external'\s*===\s*"ant"/g, 'true')
      .replace(/"external"\s*!==\s*'ant'/g, 'false')
      .replace(/'external'\s*!==\s*"ant"/g, 'false')

    if (patched === content) {
      console.warn(
        'Build patch: no USER_TYPE ant/external replacements found (may already be inlined by bundler)',
      )
    }

    writeFileSync(expectedPath, patched + '\n' + getLauncherBootstrapCode())
    console.log(`Build complete: ${outfile}`)
  }

  if (compile) {
    const compileResult = await Bun.build({
      entrypoints: [bundleOutfile],
      target: 'bun',
      format: 'esm',
      outdir: dirname(resolve(cliOutfile)),
      external: externals,
      plugins: [dedupeReactPlugin, stubPlugin],
      compile: true,
    })

    if (!compileResult.success) {
      console.error('Compile failed:')
      for (const log of compileResult.logs) {
        console.error(log)
      }
      process.exit(1)
    }

    const compileOutput = compileResult.outputs.find(o => o.kind === 'entry-point')
    if (!compileOutput) {
      console.error('No compile output found')
      process.exit(1)
    }

    // Bun.build with compile:true emits a native binary. Use fs.rename
    // (not readFileSync/writeFileSync) to avoid corrupting the Mach-O/ELF format.
    const compileActualPath = compileOutput.path
    const compileExpectedPath = resolve(cliOutfile)
    if (compileActualPath !== compileExpectedPath) {
      renameSync(compileActualPath, compileExpectedPath)
    }

    if (!existsSync(cliOutfile)) {
      console.error(`Compiled binary missing: ${cliOutfile}`)
      process.exit(1)
    }
    chmodSync(cliOutfile, 0o755)
    console.log(`Built standalone binary: ${cliOutfile}`)
  }
} finally {
  // Always restore source files, even if Bun.build() throws
  restoreModifiedFiles()
  if (numModified > 0) {
    console.log(`  🔄 feature-flags: pre-processed ${numModified} files (restored)`)
  }
}
