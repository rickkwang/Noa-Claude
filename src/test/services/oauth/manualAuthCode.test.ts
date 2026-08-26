import { describe, expect, test } from 'bun:test'
import { OAuthService } from '../../../services/oauth/index.js'

describe('manual auth code paste', () => {
  test('rejects a pasted state that does not match the request', async () => {
    const service = new OAuthService()
    try {
      // skipBrowserOpen keeps openBrowser out of the test; the rejection lands
      // before any token exchange, so nothing here reaches the network.
      await expect(
        service.startOAuthFlow(
          async () => {
            service.handleManualAuthCodeInput({
              authorizationCode: 'code-from-another-flow',
              state: 'not-the-state-we-issued',
            })
          },
          { skipBrowserOpen: true },
        ),
      ).rejects.toThrow('Invalid state parameter')
    } finally {
      service.cleanup()
    }
  })

  test('hands the caller both the manual and the localhost URL', async () => {
    const service = new OAuthService()
    const seen: Array<string | undefined> = []
    try {
      await expect(
        service.startOAuthFlow(
          async (manualUrl, automaticUrl) => {
            seen.push(manualUrl, automaticUrl)
            service.handleManualAuthCodeInput({
              authorizationCode: 'code',
              state: 'wrong',
            })
          },
          { skipBrowserOpen: true },
        ),
      ).rejects.toThrow('Invalid state parameter')
    } finally {
      service.cleanup()
    }

    const redirectOf = (url: string | undefined) =>
      new URL(url ?? '').searchParams.get('redirect_uri') ?? ''
    const [manualUrl, automaticUrl] = seen

    // The manual URL parks the code on a page the user copies from.
    expect(redirectOf(manualUrl)).toContain('/oauth/code/callback')
    // A CLI caller needs the second one to print a URL a same-host browser can
    // close on its own; before this it only ever received the manual URL.
    expect(redirectOf(automaticUrl)).toMatch(
      /^http:\/\/localhost:\d+\/callback$/,
    )
  })
})
