import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { checkWorktreeEscape } from '../../utils/worktreeEscape.js'

// `isolation: "worktree"` is only a real boundary if writes are held to it.
// The agent runs under a cwd override (AgentTool wraps its execution in
// runWithCwdOverride), but nothing stopped it from naming an absolute path
// back in the shared checkout — which silently undoes the isolation the
// caller asked for. These pin the shape of that guard.
describe('checkWorktreeEscape', () => {
  const shared = '/repo'
  // Worktrees live at `.noa/worktrees/<slug>`, i.e. *inside* the shared
  // checkout. The containment checks must therefore be ordered innermost
  // first, or every worktree path reads as a shared-checkout path.
  const worktree = join(shared, '.noa', 'worktrees', 'agent-1234abcd')

  test('no cwd override means no guard', () => {
    expect(
      checkWorktreeEscape(join(shared, 'src/a.ts'), undefined, shared),
    ).toBe(null)
  })

  // The reason this keys on the override rather than on
  // `getCwd() !== getOriginalCwd()`: a `cd` in the shell moves the cwd for
  // the whole session, and reading that as an isolation boundary would
  // refuse every ordinary write from then on.
  test('a plain cd in the shell is not a boundary', () => {
    expect(
      checkWorktreeEscape(join(shared, 'README.md'), undefined, shared),
    ).toBe(null)
  })

  test('paths inside the worktree are allowed', () => {
    expect(
      checkWorktreeEscape(join(worktree, 'src/a.ts'), worktree, shared),
    ).toBe(null)
    expect(checkWorktreeEscape(worktree, worktree, shared)).toBe(null)
  })

  test('paths in the shared checkout are refused', () => {
    const message = checkWorktreeEscape(
      join(shared, 'src/a.ts'),
      worktree,
      shared,
    )
    expect(message).toBeString()
    // The message has to carry the worktree path: the agent's only way out is
    // to retarget the write, and it cannot do that without being told where.
    expect(message).toContain(worktree)
  })

  test('the worktree parent chain is still refused', () => {
    // `.noa/worktrees` and `.noa` sit between the worktree and the checkout
    // root. They are outside the worktree, so they are shared state.
    expect(
      checkWorktreeEscape(join(shared, '.noa', 'settings.json'), worktree, shared),
    ).toBeString()
  })

  test('paths outside the shared checkout are not our business', () => {
    // Scratch space is a legitimate destination and never a lost update in
    // the repo. Guarding it would be a sandbox, which this is not.
    expect(checkWorktreeEscape('/tmp/scratch.txt', worktree, shared)).toBe(null)
    expect(checkWorktreeEscape('/other/repo/a.ts', worktree, shared)).toBe(null)
  })

  test('traversal out of the worktree is refused', () => {
    expect(
      checkWorktreeEscape(join(worktree, '..', '..', '..', 'src/a.ts'), worktree, shared),
    ).toBeString()
  })

  test('an explicit cwd override outside the checkout still guards', () => {
    // AgentTool sets the same override for an explicit `cwd` argument, not
    // just worktrees, so the guard must not assume containment either way.
    const elsewhere = '/somewhere/else'
    expect(
      checkWorktreeEscape(join(elsewhere, 'a.ts'), elsewhere, shared),
    ).toBe(null)
    expect(
      checkWorktreeEscape(join(shared, 'src/a.ts'), elsewhere, shared),
    ).toBeString()
  })
})
