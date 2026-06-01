import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'

describe('/provider command', () => {
  test('successful switch does not pollute model context', async () => {
    const source = await readFile('src/commands/provider/provider.tsx', 'utf8')
    // display: 'skip' is required — SystemLocalCommandMessage is wrapped
    // as a user message by normalizeMessagesForAPI, so 'system' or the
    // default 'user' would ship the switch string to the model.
    expect(source).toContain(
      "onDone(`Switched to provider ${profile.name}`, { display: 'skip' });",
    )
  })

  test('successful switch still surfaces feedback via notification', async () => {
    const source = await readFile('src/commands/provider/provider.tsx', 'utf8')
    // Picker dismissal must not be silent — addNotification replaces the
    // transcript entry that display: 'skip' suppresses.
    expect(source).toMatch(
      /context\.addNotification\?\.?\(\s*\{[\s\S]*?text:\s*`Switched to provider \$\{profile\.name\}`/,
    )
  })
})
