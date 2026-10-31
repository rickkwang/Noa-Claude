import { describe, expect, test } from "bun:test"
import { diffRuns } from "../electron/runNotices.cjs"

const run = (overrides: Record<string, unknown> = {}) => ({
  runtimeId: "r1",
  title: "Fix the build",
  busy: false,
  waitingKinds: [] as string[],
  ...overrides,
})

describe("desktop notices from run polls", () => {
  test("the first poll only records state, so existing runs are not announced", () => {
    const { notices } = diffRuns(null, [run({ busy: true, waitingKinds: ["permission"] })])
    expect(notices).toEqual([])
  })

  test("a busy run going idle announces a finished turn", () => {
    const first = diffRuns(null, [run({ busy: true })])
    const second = diffRuns(first.next, [run({ busy: false })])
    expect(second.notices).toEqual([{ kind: "turn", title: "Fix the build" }])
  })

  test("a stopped turn does not announce a finished turn", () => {
    const first = diffRuns(null, [run({ busy: true, interrupted: true })])
    expect(diffRuns(first.next, [run({ busy: false })]).notices).toEqual([])
  })

  test("a stopped turn dropped from the list does not announce either", () => {
    const first = diffRuns(null, [run({ busy: true, interrupted: true })])
    expect(diffRuns(first.next, []).notices).toEqual([])
  })

  test("a turn that ends in an error announces a failed task, not a finished one", () => {
    const first = diffRuns(null, [run({ busy: true })])
    const second = diffRuns(first.next, [run({ busy: false, failed: true })])
    expect(second.notices).toEqual([{ kind: "failed", title: "Fix the build" }])
  })

  test("a run dropped while busy still announces its finished turn", () => {
    const first = diffRuns(null, [run({ busy: true })])
    const second = diffRuns(first.next, [])
    expect(second.notices).toEqual([{ kind: "turn", title: "Fix the build" }])
  })

  test("a run that was never busy and disappears announces nothing", () => {
    const first = diffRuns(null, [run({ busy: false })])
    expect(diffRuns(first.next, []).notices).toEqual([])
  })

  test("a wait kind is announced once when it appears, not on every poll", () => {
    const first = diffRuns(null, [run({ busy: true })])
    const second = diffRuns(first.next, [run({ busy: true, waitingKinds: ["question"] })])
    expect(second.notices).toEqual([{ kind: "question", title: "Fix the build" }])
    expect(diffRuns(second.next, [run({ busy: true, waitingKinds: ["question"] })]).notices).toEqual([])
  })

  test("a new run that starts already waiting for approval is announced", () => {
    const first = diffRuns(null, [])
    const second = diffRuns(first.next, [run({ busy: true, waitingKinds: ["permission"] })])
    expect(second.notices).toEqual([{ kind: "permission", title: "Fix the build" }])
  })
})
