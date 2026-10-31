// Pure comparison of two bridge run-list polls, kept free of Electron so it can be tested.
// Compares the previous poll with the current run list and returns what to announce.
// `previous` is null on the first poll: runs that already exist are not announced.
function diffRuns(previous, runs) {
  const next = new Map()
  const notices = []
  for (const run of runs) {
    const before = previous?.get(run.runtimeId)
    const waiting = new Set(run.waitingKinds ?? [])
    // A stopped turn is not a finished one; it is flagged while busy, which the last busy poll saw.
    const interrupted = run.interrupted === true || before?.interrupted === true
    if (previous) {
      if (before?.busy && !run.busy && !interrupted) notices.push({ kind: run.failed ? 'failed' : 'turn', title: run.title })
      for (const kind of waiting) if (!before?.waiting.has(kind)) notices.push({ kind, title: run.title })
    }
    next.set(run.runtimeId, { busy: run.busy, waiting, title: run.title, interrupted: run.interrupted === true, failed: run.failed === true })
  }
  // A run that finishes and is dropped from the list between two polls still completed.
  if (previous) {
    for (const [id, before] of previous) {
      if (!next.has(id) && before.busy && !before.interrupted) notices.push({ kind: before.failed ? 'failed' : 'turn', title: before.title })
    }
  }
  return { next, notices }
}

module.exports = { diffRuns }
