import { describe, expect, test } from "bun:test"
import type { AppSettings } from "../src/types"
import type { ProviderInfo } from "../src/agent/protocol"
import { composerShortcutRows } from "../src/lib/shortcuts"
import { buildSettingsSearchIndex, filterSettingsSearch } from "../src/components/settings/searchIndex"
import { defaultSettings, isDefaultAppearance } from "../src/theme/settings"

const sampleProviders: ProviderInfo[] = [
  { id: "__anthropic__", name: "Anthropic", type: "anthropic", active: true },
  { id: "p-openai", name: "Work OpenAI", type: "openai", active: false, model: "gpt-4o", hasKey: true },
]

describe("settings search index", () => {
  test("includes previously missing settings across General, Appearance, and Providers", () => {
    const index = buildSettingsSearchIndex({
      soundEnabled: false,
      supportsSidebarTranslucency: true,
      providers: sampleProviders,
    })

    for (const query of [
      "Bypass permissions",
      "Follow-up behavior",
      "Composer mascot",
      "Default terminal location",
      "Terminal font",
      "Default transcript view",
      "Translucent sidebar",
      "Ollama",
      "Work OpenAI",
    ]) {
      expect(filterSettingsSearch(index, query).length).toBeGreaterThan(0)
    }

    const apiKeyMatches = filterSettingsSearch(index, "API key")
    expect(apiKeyMatches.some((match) => match.page.key === "providers" && match.target === "Work OpenAI")).toBe(true)
    expect(apiKeyMatches.some((match) => match.page.key === "providers" && match.target === "Custom endpoint")).toBe(true)
  })

  test("falls back Sound volume and Sound preset targets to Streaming sound when disabled", () => {
    const disabledIndex = buildSettingsSearchIndex({
      soundEnabled: false,
      supportsSidebarTranslucency: false,
      providers: [],
    })
    const volumeDisabled = filterSettingsSearch(disabledIndex, "Sound volume")
    expect(volumeDisabled[0]?.target).toBe("Streaming sound")

    const enabledIndex = buildSettingsSearchIndex({
      soundEnabled: true,
      supportsSidebarTranslucency: false,
      providers: [],
    })
    const volumeEnabled = filterSettingsSearch(enabledIndex, "Sound volume")
    expect(volumeEnabled[0]?.target).toBe("Sound volume")

    expect(filterSettingsSearch(disabledIndex, "Translucent sidebar")).toEqual([])
  })
})

describe("composer shortcut rows", () => {
  test("reflects Enter, Modifier+Enter, and multiline send shortcuts accurately", () => {
    expect(composerShortcutRows("enter", true).slice(0, 2)).toEqual([
      { label: "Run instruction", keys: ["Enter"] },
      { label: "New line", keys: ["Shift", "Enter"] },
    ])

    expect(composerShortcutRows("modifier-enter", true).slice(0, 2)).toEqual([
      { label: "Run instruction", keys: ["⌘", "Enter"] },
      { label: "New line", keys: ["Enter"] },
    ])

    expect(composerShortcutRows("modifier-enter-multiline", false).slice(0, 2)).toEqual([
      {
        label: "Run instruction",
        keys: ["Ctrl", "Enter"],
        description: "Enter sends single-line prompts; Ctrl Enter sends multiline prompts.",
      },
      { label: "New line", keys: ["Shift", "Enter"] },
    ])
  })
})

describe("isDefaultAppearance", () => {
  test("returns true for default appearance and equivalent cleared theme overrides", () => {
    expect(isDefaultAppearance(defaultSettings.appearance)).toBe(true)
    expect(
      isDefaultAppearance({
        ...defaultSettings.appearance,
        lightChromeTheme: { presetId: "noa" },
        darkChromeTheme: { presetId: "noa", codeThemeId: "codex" },
      }),
    ).toBe(true)
  })

  test("returns false when appearance deviates from defaults", () => {
    expect(
      isDefaultAppearance({
        ...defaultSettings.appearance,
        theme: "dark",
      }),
    ).toBe(false)

    expect(
      isDefaultAppearance({
        ...defaultSettings.appearance,
        lightChromeTheme: { presetId: "noa", accent: "#339CFF" },
      }),
    ).toBe(false)

    expect(
      isDefaultAppearance({
        ...defaultSettings.appearance,
        contrast: { ...defaultSettings.appearance.contrast, light: 65 },
      }),
    ).toBe(false)
  })

  test("handles missing or legacy null contrast and translucentSidebar fields safely", () => {
    const legacy = {
      ...defaultSettings.appearance,
      contrast: null,
      translucentSidebar: undefined,
    } as unknown as AppSettings["appearance"]
    expect(isDefaultAppearance(legacy)).toBe(true)

    const partialContrast = {
      ...defaultSettings.appearance,
      contrast: { light: 45 },
    } as unknown as AppSettings["appearance"]
    expect(isDefaultAppearance(partialContrast)).toBe(true)
  })
})
