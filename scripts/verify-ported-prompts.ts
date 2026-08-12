/**
 * Byte-verify every pinned lean-prompt port against an upstream Claude Code
 * binary.
 *
 * `src/test/constants/leanPromptPortIntegrity.test.ts` pins each ported string
 * with a sha256 digest, which catches *later* edits but cannot tell whether the
 * text was transcribed correctly in the first place — the digest is computed
 * from whatever is already in the file. AUTONOMY_SECTION shipped once with its
 * blank-line paragraph breaks collapsed to single newlines and the digest
 * certified the deviation. This script closes that loop by diffing against the
 * source of truth.
 *
 * Deliberately NOT part of `bun test` or `check:quality`: it needs an upstream
 * binary on disk, which no CI runner and most contributors will not have. Run
 * it by hand when adding a port or bumping the upstream reference version.
 *
 *   bun run verify:ports
 *   NOA_UPSTREAM_CLAUDE_BINARY=/path/to/claude bun run verify:ports
 *
 * With no binary present it reports skipped and exits 0.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'
// Same scrub the integrity test does: an ambient ANTHROPIC_BASE_URL or
// CLAUDE_CODE_USE_* makes isUntrustedModelIdentity() true, which routes every
// gate below to the verbose branch and would compare the wrong strings.
for (const key of [
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT',
  'CLAUDE_CODE_SIMPLE_SYSTEM_PROMPT',
  'NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY',
  'NOA_CLAUDE_WRITE_REQUIRE_READ',
]) {
  delete process.env[key]
}

const {
  ACT_DONT_REDERIVE_SECTION,
  AUTONOMY_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  CORRECTIONS_SECTION,
  DELIVERING_WORK_SECTION,
  PRONOUNS_SECTION,
} = await import('../src/constants/systemPromptCoreSections.js')
const { getAntiVerbositySection, MATCH_SURROUNDING_CODE_SECTION } =
  await import('../src/constants/systemPromptCompact.js')
const { getDescription: getGlobDescription } = await import(
  '../src/tools/GlobTool/prompt.js'
)
const { getDescription: getGrepDescription } = await import(
  '../src/tools/GrepTool/prompt.js'
)
const { getEditToolDescription } = await import(
  '../src/tools/FileEditTool/prompt.js'
)
const { getWriteToolDescription } = await import(
  '../src/tools/FileWriteTool/prompt.js'
)
const { getTodoWritePrompt } = await import(
  '../src/tools/TodoWriteTool/prompt.js'
)
const { LEAN_DESCRIPTION: WEB_FETCH_LEAN_DESCRIPTION } = await import(
  '../src/tools/WebFetchTool/prompt.js'
)

const LEAN_MODEL = 'claude-opus-5'
const UNBUNDLED_MODEL = 'claude-fable-5'

function withPreReadRequired(render: () => string): string {
  process.env.NOA_CLAUDE_WRITE_REQUIRE_READ = '1'
  try {
    return render()
  } finally {
    delete process.env.NOA_CLAUDE_WRITE_REQUIRE_READ
  }
}

/** Keep in step with PORTED_DIGESTS in leanPromptPortIntegrity.test.ts. */
const SUBJECTS: Record<string, string> = {
  PRONOUNS_SECTION,
  ACT_DONT_REDERIVE_SECTION,
  CONTEXT_MANAGEMENT_SECTION,
  MATCH_SURROUNDING_CODE_SECTION,
  'anti_verbosity fable branch': getAntiVerbositySection(
    UNBUNDLED_MODEL,
  ) as string,
  DELIVERING_WORK_SECTION,
  CORRECTIONS_SECTION,
  AUTONOMY_SECTION,
  'WebFetch.LEAN_DESCRIPTION': WEB_FETCH_LEAN_DESCRIPTION,
  'TodoWrite lean': getTodoWritePrompt(LEAN_MODEL),
  'Glob lean': getGlobDescription(LEAN_MODEL),
  'Grep lean': getGrepDescription(LEAN_MODEL),
  'Write lean': withPreReadRequired(() => getWriteToolDescription(LEAN_MODEL)),
  'Edit lean': withPreReadRequired(() => getEditToolDescription(LEAN_MODEL)),
  'Write lean (pre-read skipped)': getWriteToolDescription(LEAN_MODEL),
  'Edit lean (pre-read skipped)': getEditToolDescription(LEAN_MODEL),
}

function findBinary(): string | null {
  const explicit = process.env.NOA_UPSTREAM_CLAUDE_BINARY
  if (explicit) return existsSync(explicit) ? explicit : null
  const dir = join(homedir(), '.local', 'share', 'claude', 'versions')
  if (!existsSync(dir)) return null
  // Highest version wins; these names are plain semver directories.
  const versions = readdirSync(dir)
    .filter(name => /^\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => {
      const pa = a.split('.').map(Number)
      const pb = b.split('.').map(Number)
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
      return 0
    })
  for (const version of versions.reverse()) {
    const path = join(dir, version)
    if (statSync(path).isFile()) return path
  }
  return null
}

/**
 * Render the text the way the bundle could plausibly store it, so a literal
 * byte search can find it. Reading the binary as latin1 keeps offsets exact, so
 * every candidate is produced in that same byte-per-char space.
 *
 * Three axes vary independently and all of them show up in practice: non-ASCII
 * raw or as \uXXXX; newlines raw (template literal) or as \n; and the source
 * escaping of `\` and of whichever quote character delimits the literal. The
 * serialized string table in a compiled binary stores fragments unescaped,
 * while the JS source region stores them fully escaped — both are searched.
 */
function encodings(text: string): string[] {
  const forms = new Set<string>()
  for (const quote of ['', '`', '"', "'"]) {
    let body = text
    if (quote !== '') {
      body = body.replace(/\\/g, '\\\\')
      body = body.split(quote).join(`\\${quote}`)
      if (quote === '`') body = body.replace(/\$\{/g, '\\${')
    }
    let uesc = ''
    for (const char of body) {
      const code = char.codePointAt(0)!
      uesc += code > 127 ? `\\u${code.toString(16).padStart(4, '0')}` : char
    }
    for (const base of [Buffer.from(body, 'utf8').toString('latin1'), uesc]) {
      forms.add(base)
      forms.add(base.replace(/\n/g, '\\n'))
    }
  }
  return [...forms]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const present = (haystack: string, text: string): boolean =>
  encodings(text).some(form => haystack.includes(form))

/**
 * Match a candidate while tolerating any difference in the *amount* of
 * whitespace between its lines — precisely the class of drift a digest cannot
 * see and a diff renders invisibly.
 */
function findWhitespaceTolerant(
  haystack: string,
  form: string,
): string | null {
  const token = form.includes('\\n') && !form.includes('\n') ? '\\n' : '\n'
  const parts = form.split(token).filter(part => part.length > 0)
  if (parts.length < 2) return null
  const anchor = parts[0]!
  const pattern = new RegExp(parts.map(escapeRe).join('(?:\\s|\\\\n)+'), 's')
  let from = 0
  for (;;) {
    const at = haystack.indexOf(anchor, from)
    if (at < 0) return null
    // Bounded window: a whitespace-only difference cannot inflate the match by
    // more than the number of separators.
    const window = haystack.slice(at, at + form.length * 2 + 512)
    const hit = pattern.exec(window)
    if (hit && hit.index === 0) return hit[0]
    from = at + 1
  }
}

/**
 * Upstream assembles several of these descriptions from parts: tool names are
 * `${…}` interpolations, and a few clauses are conditional (WebFetch's
 * claude.ai exception, anti_verbosity's two openings). Such a string is never
 * contiguous in the binary, so it is checked line by line, splitting a line
 * further at these tokens when the whole line does not appear.
 */
const INTERPOLATED = [
  'NotebookEdit',
  'TodoWrite',
  'WebSearch',
  'WebFetch',
  'MultiEdit',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'Read',
  'Task',
  'Write',
  'Agent',
  // Not a tool name: upstream's Edit description writes the Read-prefix format
  // as `(${i})`, where i is "line number + tab" or a longer variant when the
  // separator is configurable. This fork resolves the default.
  'line number \\+ tab',
]

/** Below this, a run is punctuation glue whose presence proves nothing. */
const MIN_RUN = 14

/** Every non-blank line, verified whole or in interpolation-split runs. */
function checkLines(haystack: string, text: string): { miss: string[] } {
  const splitter = new RegExp(`(?:${INTERPOLATED.join('|')}|\\. )`, 'g')
  const miss: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '' || present(haystack, line)) continue
    for (const run of line.split(splitter)) {
      if (run.trim().length >= MIN_RUN && !present(haystack, run)) miss.push(run)
    }
  }
  return { miss }
}

/**
 * The part a line-by-line check cannot see, and the part that actually broke:
 * whether each paragraph break is a blank line upstream or a single newline.
 * Each adjacent line pair is searched with our separator and with the other
 * one; finding only the other one is a whitespace deviation.
 */
function checkBreaks(
  haystack: string,
  text: string,
): { ok: number; wrong: string[]; suspect: string[]; unverified: number } {
  const lines = text.split('\n')
  let ok = 0
  let unverified = 0
  const wrong: string[] = []
  const suspect: string[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const before = lines[i]!
    if (before.trim() === '') continue
    // A blank line means the next content line is one further along.
    const blank = lines[i + 1]!.trim() === ''
    const after = blank ? lines[i + 2] : lines[i + 1]
    if (after === undefined || after.trim() === '') continue
    const tail = before.slice(-45)
    const head = after.slice(0, 45)
    const ours = blank ? '\n\n' : '\n'
    const other = blank ? '\n' : '\n\n'
    // Strong evidence: both sides are our own text, so the bytes between them
    // are upstream's separator and nothing else.
    const strong = (sep: string) => present(haystack, tail + sep + head)
    // Weak evidence: an interpolation sits on one side, so the probe anchors on
    // the source token that opens or closes it. Good enough to confirm a break,
    // never good enough to condemn one — the interpolated value can itself
    // begin or end with a newline, which this cannot see. Without these three
    // of the fable section's breaks went unverified and its bug survived.
    const weak = (sep: string) =>
      [
        tail + sep + '${',
        ...['}', '`', '"', "'"].map(close => close + sep + head),
      ].some(probe => present(haystack, probe))

    const describe = (verdict: string) =>
      `${blank ? 'blank line' : 'single newline'} after "…${before.slice(-45)}"` +
      ` — upstream ${verdict}`

    if (strong(ours)) ok++
    else if (strong(other)) {
      wrong.push(describe(`uses ${blank ? 'a single newline' : 'a blank line'}`))
    } else if (weak(ours)) ok++
    else if (weak(other)) {
      suspect.push(
        describe(
          `may use ${blank ? 'a single newline' : 'a blank line'} — ` +
            'interpolation-adjacent, confirm by hand',
        ),
      )
    } else unverified++
  }
  return { ok, wrong, suspect, unverified }
}

const render = (s: string) =>
  s.replace(/\n/g, '⏎').replace(/\\n/g, '\\n').slice(0, 240)

const binary = findBinary()
if (binary === null) {
  console.log(
    'verify:ports — skipped: no upstream Claude Code binary found.\n' +
      '  Looked in ~/.local/share/claude/versions/, or set ' +
      'NOA_UPSTREAM_CLAUDE_BINARY=/path/to/claude.',
  )
  process.exit(0)
}

console.log(`verify:ports — comparing against ${binary}\n`)
const haystack = readFileSync(binary, 'latin1')

let exact = 0
let assembled = 0
const whitespace: string[] = []
const missing: string[] = []

for (const [name, ours] of Object.entries(SUBJECTS)) {
  const forms = encodings(ours)
  if (forms.some(form => haystack.includes(form))) {
    exact++
    console.log(`  exact        ${name}`)
    continue
  }

  const loose = forms
    .map(form => findWhitespaceTolerant(haystack, form))
    .find(hit => hit != null)
  if (loose != null) {
    whitespace.push(name)
    console.log(`  WHITESPACE   ${name}`)
    console.log(`      upstream: ${render(loose)}`)
    console.log(`      ours:     ${render(forms[0]!)}`)
    continue
  }

  // Upstream assembles this one from parts. Verify the parts instead, and say
  // exactly how much of it the run actually covered.
  const { miss } = checkLines(haystack, ours)
  const breaks = checkBreaks(haystack, ours)
  if (miss.length === 0 && breaks.wrong.length === 0) {
    assembled++
    const caveats = [
      breaks.suspect.length ? `${breaks.suspect.length} suspect` : '',
      breaks.unverified ? `${breaks.unverified} unverified` : '',
    ].filter(Boolean)
    console.log(
      `  assembled    ${name} — every line exact, ` +
        `${breaks.ok} break${breaks.ok === 1 ? '' : 's'} confirmed` +
        (caveats.length ? `, ${caveats.join(', ')}` : ''),
    )
    for (const note of breaks.suspect) console.log(`      ${note}`)
    continue
  }
  if (breaks.wrong.length > 0) {
    whitespace.push(name)
    console.log(`  WHITESPACE   ${name}`)
    for (const problem of breaks.wrong) console.log(`      ${problem}`)
  }
  if (miss.length > 0) {
    missing.push(name)
    console.log(`  MISMATCH     ${name} — ${miss.length} run(s) absent upstream`)
    for (const run of miss.slice(0, 3)) {
      console.log(`      ${render(run).slice(0, 150)}`)
    }
  }
}

console.log(
  `\n${exact} byte-exact whole, ${assembled} exact line-by-line (upstream ` +
    `assembles it from parts),\n${whitespace.length} whitespace deviation, ` +
    `${missing.length} mismatched — of ${Object.keys(SUBJECTS).length}`,
)

if (whitespace.length || missing.length) {
  console.log(
    '\nWhitespace: the words are right but the spacing is not. Fix the string,\n' +
      'then recompute its digest FROM THE CORRECTED TEXT, not from the file.\n' +
      'Mismatched: either a transcription error, or this binary predates the\n' +
      'port — check the version noted at the string definition first.',
  )
  process.exit(1)
}
