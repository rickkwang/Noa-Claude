#!/usr/bin/env node
// PostToolUse(Read|Edit|Write) hook: when a touched file calls feature('…'),
// inject docs/feature-flags.md once per session.
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const input = JSON.parse(readFileSync(0, 'utf8'))
const file = input.tool_input?.file_path
if (!file || !existsSync(file) || !/\.(ts|tsx)$/.test(file)) process.exit(0)
if (!/\bfeature\(\s*['"]/.test(readFileSync(file, 'utf8'))) process.exit(0)

const marker = join(tmpdir(), `noa-feature-flags-${input.session_id}`)
if (existsSync(marker)) process.exit(0)
writeFileSync(marker, '')

const doc = readFileSync(new URL('../../docs/feature-flags.md', import.meta.url), 'utf8')
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: doc },
}))
