// Standalone fixture for the MCP-truncation memory-retention regression test.
// Run in a subprocess (see mcpValidation.memory.test.ts) so heap accounting is
// isolated from the test runner. Exercises the REAL truncateMcpContent, holds
// every truncated result, and reports post-GC heapUsed as JSON.
//
// Why this catches a regression: each source is 25MB but truncates to ~100KB.
// With the detachString fix, each truncated result is a standalone copy, so its
// 25MB source is unreachable and one final GC reclaims all of them — heapUsed
// stays flat (~independent of source size). If truncateString regresses to a
// bare `.slice()`, every truncated result pins its full 25MB parent; they are
// all reachable at GC time, cannot be reclaimed, and heapUsed balloons past
// HEAP_LIMIT_MB. No intervening GC is used — an aggressive mid-loop Bun.gc()
// flattens the pinned slices and masks the leak, which is not how a real
// session behaves. RSS is NOT the signal; it is a high-water mark the allocator
// never returns.
import { truncateMcpContent } from '../../utils/mcpValidation.js'

const N = 20
const SIZE = 25 * 1024 * 1024 // 25MB per source → 500MB pinned if leaked
const retainedMB = (N * SIZE) / 1024 / 1024

async function main() {
  const kept: string[] = []
  for (let i = 0; i < N; i++) {
    let big: string | null = 'x'.repeat(SIZE)
    // Real truncation path: string branch → truncateString → detachString.
    kept.push((await truncateMcpContent(big)) as string)
    big = null
  }
  Bun.gc(true)
  // Touch results so nothing is optimized away.
  let liveChars = 0
  for (const k of kept) liveChars += k.length
  const m = process.memoryUsage()
  console.log(
    JSON.stringify({
      heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
      rssMB: Math.round(m.rss / 1024 / 1024),
      retainedMB,
      liveChars,
    }),
  )
}

void main()
