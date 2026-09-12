import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'

import type { LocalJSXCommandContext } from '../../types/command.js'

import {
  APPLIES_ON_CLOSE_HINT,
  decideMenuAutoReload,
  RELOAD_COMMAND,
  withQueuedNote,
} from '../../commands/plugin/autoReload.js'

describe('decideMenuAutoReload', () => {
  test('an untouched menu closes without queueing anything', () => {
    expect(
      decideMenuAutoReload({
        dirty: false,
        needsRefresh: false,
        midTurn: false,
      }),
    ).toBe('none')
  })

  test('a changed menu queues the reload when the loop is idle', () => {
    expect(
      decideMenuAutoReload({ dirty: true, needsRefresh: true, midTurn: false }),
    ).toBe('queued')
  })

  test('a changed menu defers the reload behind a live response', () => {
    expect(
      decideMenuAutoReload({ dirty: true, needsRefresh: true, midTurn: true }),
    ).toBe('deferred')
  })

  test('a refresh consumed elsewhere is not queued again', () => {
    // /reload-plugins ran from the prompt while the dialog was open, so the
    // session already has the new plugin set.
    expect(
      decideMenuAutoReload({ dirty: true, needsRefresh: false, midTurn: false }),
    ).toBe('none')
  })

  test('needsRefresh alone is not enough — this menu must have changed it', () => {
    // Set by a disk watcher, not by the menu; useManagePlugins owns that
    // notification and the user decides when to reload.
    expect(
      decideMenuAutoReload({ dirty: false, needsRefresh: true, midTurn: false }),
    ).toBe('none')
  })
})

describe('withQueuedNote', () => {
  test('keeps the menu message and adds the note on its own line', () => {
    const note = withQueuedNote(undefined)
    expect(withQueuedNote('✓ Enabled foo.')).toBe(`✓ Enabled foo.\n${note}`)
  })

  test('a silent close still reports the queued reload', () => {
    expect(withQueuedNote(undefined)).toContain(RELOAD_COMMAND)
    expect(withQueuedNote('')).toBe(withQueuedNote(undefined))
  })
})

describe('user-facing strings', () => {
  test('the queued note names the command that is actually submitted', () => {
    expect(withQueuedNote(undefined)).toContain(RELOAD_COMMAND)
    expect(RELOAD_COMMAND).toBe('/reload-plugins')
  })

  test('the staged-change hint does not tell the user to run anything', () => {
    expect(APPLIES_ON_CLOSE_HINT).not.toContain('/reload-plugins')
  })
})

describe('the /plugin dialog gets told whether a turn is in flight', () => {
  // The immediate-command dispatcher is only reachable with a turn active, so
  // it is the whole signal behind the "queued" wording. If this plumbing
  // breaks, a mid-turn close goes silent instead of saying the reload waits.
  async function openDialog(
    context: unknown,
  ): Promise<ReactElement<{ midTurn?: boolean }>> {
    const { call } = await import('../../commands/plugin/plugin.js')
    const node = await call(
      () => {},
      context as LocalJSXCommandContext,
      '',
    )
    return node as ReactElement<{ midTurn?: boolean }>
  }

  test('call() forwards dispatchedAsImmediate as midTurn', async () => {
    expect((await openDialog({ dispatchedAsImmediate: true })).props.midTurn).toBe(true)
    expect((await openDialog({})).props.midTurn).toBe(false)
  })

  test('call() survives a context that never set the flag', async () => {
    expect((await openDialog(undefined)).props.midTurn).toBe(false)
  })
})
