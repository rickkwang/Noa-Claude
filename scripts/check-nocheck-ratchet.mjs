#!/usr/bin/env node
/**
 * @ts-nocheck ratchet — the number of type-unchecked source files may only go DOWN.
 *
 * Baseline lives at scripts/nocheck-ratchet.baseline.json (full path list, so
 * "delete one legacy file, add one new unchecked file" is still caught).
 *
 * Usage:
 *   node scripts/check-nocheck-ratchet.mjs           # check (CI)
 *   node scripts/check-nocheck-ratchet.mjs --update  # tighten baseline after cleanup
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

const SRC = join(import.meta.dirname, '..', 'src')
const BASELINE = join(import.meta.dirname, 'nocheck-ratchet.baseline.json')

function collect(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'test') continue // src/test/** is self-contained test code
      collect(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(ent.name)) continue
    if (readFileSync(full, 'utf8').includes('@ts-nocheck')) {
      out.push(relative(join(import.meta.dirname, '..'), full))
    }
  }
  return out.sort()
}

const current = collect(SRC)
const update = process.argv.includes('--update')

if (update) {
  writeFileSync(BASELINE, JSON.stringify({ files: current }, null, 2) + '\n')
  console.log(`nocheck-ratchet: baseline updated to ${current.length} files`)
  process.exit(0)
}

let baseline = []
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).files
} catch {
  console.error(`nocheck-ratchet: no baseline at ${relative(process.cwd(), BASELINE)} — run with --update first`)
  process.exit(2)
}

const baselineSet = new Set(baseline)
const added = current.filter(f => !baselineSet.has(f))
const removed = baseline.filter(f => !new Set(current).has(f))

if (added.length > 0) {
  console.error(`nocheck-ratchet: ${added.length} NEW @ts-nocheck file(s) — the ratchet only moves down:`)
  for (const f of added) console.error(`  + ${f}`)
  console.error('Type-check new code, or fix an existing file instead of adding to the debt.')
  process.exit(1)
}

console.log(
  `nocheck-ratchet: OK — ${current.length} unchecked files` +
    (removed.length ? ` (${removed.length} cleaned up since baseline; run with --update to tighten)` : ''),
)
