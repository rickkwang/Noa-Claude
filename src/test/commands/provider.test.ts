import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'

const readSource = () => readFile('src/commands/provider/provider.tsx', 'utf8')

describe('/provider command', () => {
  test('successful switch does not pollute model context', async () => {
    const source = await readSource()
    // display: 'skip' is required — SystemLocalCommandMessage is wrapped
    // as a user message by normalizeMessagesForAPI, so 'system' or the
    // default 'user' would ship the switch string to the model.
    expect(source).toContain("onDone(text, { display: 'skip' });")
  })

  test('successful switch still surfaces feedback via notification', async () => {
    const source = await readSource()
    // Picker dismissal must not be silent — addNotification replaces the
    // transcript entry that display: 'skip' suppresses.
    //
    // The trailing `priority:` is what keeps the lazy match inside the
    // notification object. Without it, `\btext,` escapes the object and
    // matches `onDone(text,` further down, so the pin would still pass after
    // someone deleted `text` from the notification — a pin that never bites.
    expect(source).toMatch(
      /addNotification\?\.\(\s*\{[\s\S]*?\btext,[\s\S]*?priority:/,
    )
  })

  test('--bare reports the switch as saved rather than applied', async () => {
    const source = await readSource()
    // applyActiveProviderProfileEnv is a no-op under --bare (the caller's env
    // is the entire auth/routing contract), so the selection is only written
    // to disk. Reporting "Switched" there would claim a change that this
    // session never made.
    expect(source).toMatch(
      /isBareMode\(\)\s*\?\s*`Saved provider \$\{profile\.name\}; not applied under --bare/,
    )
  })

  test('a profile that vanished from disk is reported as a failure', async () => {
    const source = await readSource()
    // setActiveProviderProfile resolves to null instead of throwing when the
    // id is missing, and the picker's list is a mount-time snapshot. Without
    // the guard the command re-applies the still-active profile and reports
    // the selected one as switched.
    expect(source).toMatch(
      /\.then\(\(activated\) => \{[\s\S]*?if \(!activated\) \{[\s\S]*?throw new Error\(/,
    )
  })

  test('--bare skips the post-switch cascade', async () => {
    const source = await readSource()
    // Credentials did not change under --bare, so onProviderSwitch would
    // clear the provider caches and drop the session model for nothing.
    expect(source).toContain(
      'if (applyNow && !isBareMode()) onProviderSwitch(context);',
    )
  })

  test('offers the stored Anthropic account as a first-class row', async () => {
    const source = await readSource()
    // A stored account is the common case, and it is what makes an immediate
    // switch safe: without this row /login was the only way back to it.
    expect(source).toMatch(
      /oauthAccount\s*\?\s*\[\s*\{\s*label: `Anthropic \(\$\{oauthAccount\.emailAddress\}\)/,
    )
    // Immediate, not deferred: switchToAnthropicAccount clears the profile env
    // from this process too, and announce() runs the post-switch cascade.
    expect(source).toMatch(
      /switchToAnthropicAccount\(\)\s*\.then\(\(\) => \{[\s\S]*?announce\(/,
    )
  })

  test('keeps the deferred row for sessions with no account to fall back to', async () => {
    const source = await readSource()
    // --bare and never-logged-in installs have no stored credential, so
    // clearing the profile's env in-process would strand the session. Those
    // keep the next-launch-only path.
    expect(source).toMatch(
      /!oauthAccount && activeProfile\s*\?\s*\[\{ label: 'None \(clear the active provider\)', value: NO_PROVIDER_VALUE \}\]/,
    )
    expect(source).toMatch(/deactivateProviderProfilesForNextLaunch\(\)/)
    expect(source).toContain('takes effect next session')
  })
})
