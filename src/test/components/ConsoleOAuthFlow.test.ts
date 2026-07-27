import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'

const readSource = () =>
  readFile('src/components/ConsoleOAuthFlow.tsx', 'utf8')

// Source pins rather than rendered-output assertions: the wizard sits inside a
// large Ink component tree that pulls in the OAuth service and model discovery
// on import, so exercising it would need a full TUI harness. The invariant
// worth guarding is narrow enough for a text pin — which of two messages the
// completion callback reports.
describe('provider setup wizard', () => {
  test('--bare reports the preset as saved rather than active', async () => {
    const source = await readSource()
    // activateProviderPreset persists the profile, but the
    // applyActiveProviderProfileEnv it calls is a no-op under --bare, so the
    // preset is not in effect for this session.
    expect(source).toMatch(
      /isBareMode\(\)\s*\?\s*`✓ \$\{result\.presetName\} preset saved\. Not applied under --bare/,
    )
  })

  test('outside --bare the preset is reported as active', async () => {
    const source = await readSource()
    expect(source).toMatch(
      /:\s*`✓ \$\{result\.presetName\} preset is active\./,
    )
  })
})
