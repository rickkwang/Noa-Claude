import { describe, expect, test } from 'bun:test'
import { isStrictSearchSelectionApp } from '../../utils/computerUse/appIdentity.js'

describe('isStrictSearchSelectionApp — strict bundleId/displayName matching', () => {
  test('real IM apps trigger strict search-selection state', () => {
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.tencent.xinWeChat',
        displayName: 'WeChat',
      }),
    ).toBe(true)
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.tinyspeck.slackmacgap',
        displayName: 'Slack',
      }),
    ).toBe(true)
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.apple.MobileSMS',
        displayName: 'Messages',
      }),
    ).toBe(true)
  })

  test('IM aliases resolve by displayName when bundleId is unknown', () => {
    // Some launchers report a different bundleId but the canonical name; the
    // alias index should still recognize the app via its registered names.
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'unknown.bundle.id',
        displayName: 'Weixin',
      }),
    ).toBe(true)
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'unknown.bundle.id',
        displayName: '微信',
      }),
    ).toBe(true)
  })

  test('non-IM app whose name contains "line" substring must NOT trigger', () => {
    // Regression: the previous substring-based check fired on any name/bundleId
    // containing 'line' (Outline, Mainline, Streamline, Skyline, …) and that
    // wrongly activated the search-selection state machine for normal apps.
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'co.brushedtype.Outline',
        displayName: 'Outline',
      }),
    ).toBe(false)
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'org.mainline.Mainline',
        displayName: 'Mainline',
      }),
    ).toBe(false)
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.example.Streamline',
        displayName: 'Streamline',
      }),
    ).toBe(false)
  })

  test('non-IM app whose name contains "teams" substring must NOT trigger', () => {
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.example.TeamSpeak',
        displayName: 'TeamSpeak',
      }),
    ).toBe(false)
  })

  test('unrelated random app does not trigger', () => {
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.apple.TextEdit',
        displayName: 'TextEdit',
      }),
    ).toBe(false)
    expect(
      isStrictSearchSelectionApp({
        bundleId: 'com.apple.calculator',
        displayName: 'Calculator',
      }),
    ).toBe(false)
  })
})
