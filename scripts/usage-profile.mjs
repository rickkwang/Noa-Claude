#!/usr/bin/env node
/**
 * Offline cost/cache profile of past sessions, built from the `usage` objects
 * the transcripts already record. Reads only local files — it never calls an
 * API and costs nothing to run.
 *
 * Answers the three questions a cost audit actually needs: where the tokens
 * go, whether prompt caching is working, and what a completed turn costs.
 *
 * Usage:
 *   bun run profile:usage                  # every session on disk
 *   bun run profile:usage -- --days 14     # last 14 days only
 *   bun run profile:usage -- --project Noa # substring match on cwd
 *   bun run profile:usage -- --json        # machine-readable
 *
 * TWO COUNTING RULES, both load-bearing — a rollup that skips either one is
 * wrong by an order of magnitude, so don't "simplify" them away:
 *
 * 1. De-dupe by `message.id`. One API response lands in the transcript
 *    several times (streaming progress snapshots, one record per content
 *    block). Raw record counts run ~2.2x the real request count.
 * 2. Per id, keep the variant with the largest `cache_read_input_tokens`.
 *    On openaiCompatible providers the pre-normalization snapshot reports the
 *    whole prompt as `input_tokens` with `cache_read_input_tokens: 0`; the
 *    normalized one carries the real split (see normalizeUsageForCostAccounting
 *    in src/cost-tracker.ts, which applies the same correction at runtime).
 *    Summing every record instead inflates uncached input by >20x.
 */
import { readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PRODUCT_HOME_DIR = '.noa'
const CONFIG_HOME =
  process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), PRODUCT_HOME_DIR)
const PROJECTS_DIR = join(CONFIG_HOME, 'projects')

// USD per million tokens: [base input, output]. Cache write/read are derived
// from the published multipliers below. First-party Anthropic list prices —
// re-check against https://platform.claude.com/docs/en/about-claude/pricing
// when a model launches or a price changes. Models absent here (third-party
// provider profiles) are reported in tokens only, never in invented dollars.
const PRICES = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-haiku-4-5': [1, 5],
}
const CACHE_WRITE_5M = 1.25
const CACHE_WRITE_1H = 2
// Fable 5.1 / Mythos 5.1 read at 0.025x; every other model at 0.1x.
const cacheReadMultiplier = model => (/fable-5-1|mythos-5-1/.test(model) ? 0.025 : 0.1)

function priceFor(model) {
  const key = Object.keys(PRICES).find(k => model.startsWith(k))
  return key ? PRICES[key] : undefined
}

const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const asJson = args.includes('--json')
const projectFilter = flag('project')
let since
if (args.includes('--days')) {
  const days = Number(flag('days'))
  if (!Number.isFinite(days) || days <= 0) {
    console.error('--days needs a positive number of days, e.g. --days 14')
    process.exit(2)
  }
  since = Date.now() - days * 864e5
}

function collect(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) collect(full, out)
    else if (ent.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

/** Rule 1: group every transcript record by the API response it belongs to. */
const byMessageId = new Map()
for (const file of collect(PROJECTS_DIR)) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const line of text.split('\n')) {
    if (!line || !line.includes('"usage"')) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    if (rec.type !== 'assistant' || !rec.message?.usage) continue
    if (since && Date.parse(rec.timestamp ?? '') < since) continue
    if (projectFilter && !(rec.cwd ?? '').includes(projectFilter)) continue
    const id = rec.message.id ?? rec.uuid
    const bucket = byMessageId.get(id)
    if (bucket) bucket.push(rec)
    else byMessageId.set(id, [rec])
  }
}

/** Rule 2: one canonical row per response, cache-attributed variant wins. */
const requests = []
for (const records of byMessageId.values()) {
  const best = records.reduce((a, b) =>
    (b.message.usage.cache_read_input_tokens ?? 0) >
    (a.message.usage.cache_read_input_tokens ?? 0)
      ? b
      : a,
  )
  const usage = best.message.usage
  const creation = usage.cache_creation
  const row = {
    model: best.message.model ?? 'unknown',
    session: best.sessionId ?? 'unknown',
    project: (best.cwd ?? '').replace(homedir(), '~'),
    timestamp: best.timestamp ?? '',
    isSidechain: Boolean(best.isSidechain),
    uncachedInput: usage.input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    write5m: creation
      ? (creation.ephemeral_5m_input_tokens ?? 0)
      : (usage.cache_creation_input_tokens ?? 0),
    write1h: creation ? (creation.ephemeral_1h_input_tokens ?? 0) : 0,
    // Output grows across streaming snapshots, so take the largest seen.
    output: Math.max(...records.map(r => r.message.usage.output_tokens ?? 0)),
    completedTurn: records.some(r => r.message.stop_reason === 'end_turn'),
    truncated: records.some(r => r.message.stop_reason === 'max_tokens'),
    refused: records.some(r => r.message.stop_reason === 'refusal'),
  }
  if (row.uncachedInput + row.cacheRead + row.write5m + row.write1h === 0) continue
  requests.push(row)
}
requests.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))

if (requests.length === 0) {
  console.error(`no usage records found under ${PROJECTS_DIR}`)
  process.exit(1)
}

function emptyAgg() {
  return {
    requests: 0,
    uncachedInput: 0,
    write5m: 0,
    write1h: 0,
    cacheRead: 0,
    output: 0,
    completedTurns: 0,
    truncated: 0,
    refused: 0,
    sessions: new Set(),
  }
}
function accumulate(agg, row) {
  agg.requests++
  agg.uncachedInput += row.uncachedInput
  agg.write5m += row.write5m
  agg.write1h += row.write1h
  agg.cacheRead += row.cacheRead
  agg.output += row.output
  if (row.completedTurn) agg.completedTurns++
  if (row.truncated) agg.truncated++
  if (row.refused) agg.refused++
  agg.sessions.add(row.session)
}
function costOf(model, agg) {
  const price = priceFor(model)
  if (!price) return undefined
  const [input, output] = price
  return (
    (agg.uncachedInput * input +
      agg.write5m * input * CACHE_WRITE_5M +
      agg.write1h * input * CACHE_WRITE_1H +
      agg.cacheRead * input * cacheReadMultiplier(model) +
      agg.output * output) /
    1e6
  )
}
/** Share of input tokens paid at full or write price rather than read price. */
function coldShare(agg) {
  const total = agg.uncachedInput + agg.write5m + agg.write1h + agg.cacheRead
  return total === 0 ? 0 : (agg.uncachedInput + agg.write5m + agg.write1h) / total
}

const byModel = new Map()
const byProject = new Map()
const mainLoop = emptyAgg()
const subagents = emptyAgg()
for (const row of requests) {
  if (!byModel.has(row.model)) byModel.set(row.model, emptyAgg())
  accumulate(byModel.get(row.model), row)
  if (!byProject.has(row.project)) byProject.set(row.project, emptyAgg())
  accumulate(byProject.get(row.project), row)
  accumulate(row.isSidechain ? subagents : mainLoop, row)
}

/**
 * Prompt caching writes at 1.25x (5m) or 2x (1h) and reads at 0.1x, so a 1h
 * TTL only pays when it prevents a full-prefix rewrite. Bucketing writes by
 * the gap since the previous request in the same session prices that
 * decision instead of guessing at it.
 *
 * Only 5-minute writes take part in the counterfactual: a write already made
 * at the 1h TTL neither gains a saving nor owes a surcharge, so folding it in
 * would count it on both sides.
 *
 * Known bias: transcripts timestamp responses, so the gap measured here is
 * end-to-end, while the TTL actually runs write-to-next-request-start. Real
 * gaps are therefore shorter than these by one generation time, which moves
 * writes *into* the 5m-1h bucket — the bias favours the 1h TTL. A negative
 * verdict is safe; a marginally positive one deserves a closer look.
 */
function ttlAnalysis(model) {
  const rows = requests.filter(r => r.model === model)
  const bySession = new Map()
  for (const row of rows) {
    if (!bySession.has(row.session)) bySession.set(row.session, [])
    bySession.get(row.session).push(row)
  }
  const buckets = { firstInSession: 0, within5m: 0, from5mTo1h: 0, over1h: 0 }
  let alreadyAt1h = 0
  for (const session of bySession.values()) {
    for (let i = 0; i < session.length; i++) {
      alreadyAt1h += session[i].write1h
      const written = session[i].write5m
      if (i === 0) {
        buckets.firstInSession += written
        continue
      }
      const gapSeconds =
        (Date.parse(session[i].timestamp) - Date.parse(session[i - 1].timestamp)) / 1000
      if (!Number.isFinite(gapSeconds) || gapSeconds <= 300) buckets.within5m += written
      else if (gapSeconds <= 3600) buckets.from5mTo1h += written
      else buckets.over1h += written
    }
  }
  const price = priceFor(model)
  if (!price) return { buckets, alreadyAt1h }
  const [input] = price
  // Rewrites a 1h TTL would have turned into reads, against the surcharge it
  // would add to every other write in the session.
  const saved =
    (buckets.from5mTo1h * input * CACHE_WRITE_5M -
      buckets.from5mTo1h * input * cacheReadMultiplier(model)) /
    1e6
  const surcharge =
    ((buckets.firstInSession + buckets.within5m + buckets.over1h) *
      input *
      (CACHE_WRITE_1H - CACHE_WRITE_5M)) /
    1e6
  return { buckets, alreadyAt1h, saved, surcharge, net: saved - surcharge }
}

const number = n => n.toLocaleString('en-US')
const percent = x => `${(x * 100).toFixed(1)}%`
const usd = x => `$${x.toFixed(2)}`

if (asJson) {
  const serialize = ([name, agg]) => ({
    name,
    ...agg,
    sessions: agg.sessions.size,
    costUSD: costOf(name, agg),
    coldShare: coldShare(agg),
  })
  console.log(
    JSON.stringify(
      {
        window: { from: requests[0].timestamp, to: requests.at(-1).timestamp },
        requests: requests.length,
        byModel: [...byModel].map(serialize),
        // No cost on projects: a project mixes models, and priceFor() would
        // silently return undefined for a path anyway.
        byProject: [...byProject].map(([name, agg]) => ({
          name,
          ...agg,
          sessions: agg.sessions.size,
          coldShare: coldShare(agg),
        })),
        mainLoop: { ...mainLoop, sessions: mainLoop.sessions.size, coldShare: coldShare(mainLoop) },
        subagents: { ...subagents, sessions: subagents.sessions.size, coldShare: coldShare(subagents) },
        ttl: Object.fromEntries([...byModel.keys()].map(m => [m, ttlAnalysis(m)])),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const from = requests[0].timestamp.slice(0, 10)
const to = requests.at(-1).timestamp.slice(0, 10)
const spanDays = Math.max(
  1,
  Math.round((Date.parse(requests.at(-1).timestamp) - Date.parse(requests[0].timestamp)) / 864e5),
)
console.log(`usage profile — ${from} .. ${to} (${spanDays}d)`)
console.log(`${requests.length} API responses across ${new Set(requests.map(r => r.session)).size} sessions`)
console.log(`source: ${PROJECTS_DIR}\n`)

console.log('model                       reqs   uncached      write       read     output   cold%      cost')
let pricedTotal = 0
let anyUnpriced = false
for (const [model, agg] of [...byModel].sort(
  (a, b) => b[1].cacheRead + b[1].uncachedInput - (a[1].cacheRead + a[1].uncachedInput),
)) {
  const cost = costOf(model, agg)
  if (cost === undefined) anyUnpriced = true
  else pricedTotal += cost
  console.log(
    [
      model.slice(0, 26).padEnd(26),
      String(agg.requests).padStart(5),
      number(agg.uncachedInput).padStart(10),
      number(agg.write5m + agg.write1h).padStart(10),
      number(agg.cacheRead).padStart(10),
      number(agg.output).padStart(10),
      percent(coldShare(agg)).padStart(7),
      (cost === undefined ? 'unpriced' : usd(cost)).padStart(9),
    ].join(' '),
  )
}
console.log(`\npriced models total: ${usd(pricedTotal)} over ${spanDays}d (${usd((pricedTotal / spanDays) * 30)}/30d)`)
if (anyUnpriced) {
  console.log('"unpriced" = third-party provider profile; add its rate to PRICES to include it.')
}

console.log('\nper completed turn (stop_reason: end_turn)')
for (const [model, agg] of byModel) {
  const cost = costOf(model, agg)
  if (cost === undefined || agg.completedTurns === 0) continue
  console.log(`  ${model.padEnd(26)} ${agg.completedTurns} turns, ${usd(cost / agg.completedTurns)}/turn`)
}

const totals = requests.reduce(
  (a, r) => ({
    uncached: a.uncached + r.uncachedInput,
    write: a.write + r.write5m + r.write1h,
    read: a.read + r.cacheRead,
    output: a.output + r.output,
  }),
  { uncached: 0, write: 0, read: 0, output: 0 },
)
console.log('\nper-request averages (all models)')
console.log(
  `  cache read ${number(Math.round(totals.read / requests.length))}` +
    `  uncached ${number(Math.round(totals.uncached / requests.length))}` +
    `  write ${number(Math.round(totals.write / requests.length))}` +
    `  output ${number(Math.round(totals.output / requests.length))}`,
)

console.log('\nmain loop vs subagents')
for (const [label, agg] of [
  ['main', mainLoop],
  ['subagent', subagents],
]) {
  console.log(
    `  ${label.padEnd(9)} reqs ${String(agg.requests).padStart(5)}  read ${number(agg.cacheRead).padStart(12)}  output ${number(agg.output).padStart(9)}  cold ${percent(coldShare(agg))}`,
  )
}

console.log('\n1h-TTL decision (5m cache writes bucketed by gap since previous request)')
for (const [model, agg] of byModel) {
  if (agg.write5m + agg.write1h === 0) continue
  const { buckets, alreadyAt1h, saved, surcharge, net } = ttlAnalysis(model)
  console.log(
    `  ${model}: first ${number(buckets.firstInSession)} | <=5m ${number(buckets.within5m)} | 5m-1h ${number(buckets.from5mTo1h)} | >1h ${number(buckets.over1h)}` +
      (alreadyAt1h > 0 ? ` (${number(alreadyAt1h)} already written at 1h, excluded)` : ''),
  )
  if (net !== undefined) {
    const verdict = net > 0 ? 'switching to 1h TTL would PAY' : 'keeping the 5m TTL is correct'
    console.log(`    saves ${usd(saved)}, costs ${usd(surcharge)} → net ${usd(net)} — ${verdict}`)
  }
}

const truncated = requests.filter(r => r.truncated).length
const refused = requests.filter(r => r.refused).length
console.log(`\nhealth: ${truncated} max_tokens truncations, ${refused} refusals`)
if (truncated > 0) {
  console.log('  a truncated response is a failed attempt that still billed — raise max_tokens.')
}

console.log('\ntop projects by input tokens')
for (const [project, agg] of [...byProject]
  .sort((a, b) => b[1].cacheRead + b[1].uncachedInput - (a[1].cacheRead + a[1].uncachedInput))
  .slice(0, 6)) {
  console.log(
    `  ${(project || '(unknown)').padEnd(48)} reqs ${String(agg.requests).padStart(5)}  read ${number(agg.cacheRead).padStart(12)}`,
  )
}
