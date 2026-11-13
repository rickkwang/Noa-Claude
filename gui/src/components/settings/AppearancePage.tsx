import { useEffect, useState } from "react"
import type { AppSettings, SemanticColors, ThemeFontFace, ThemeFonts } from "../../types"
import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from "../../lib/fontFamily"
import { faceStyle, isRegularFace, loadFontFamilies, type LocalFontFamily } from "../../lib/localFonts"
import { DEFAULT_CODE_THEME_ID, getCodeThemeOptions } from "../../lib/codeThemes"
import { clampContrast } from "../../lib/contrast"
import { activeTranslucency, supportsSidebarTranslucency } from "../../lib/translucency"
import {
  DEFAULT_SEMANTIC_COLORS,
  exportCodexThemeString,
  getPresetDefaultCodeThemeId,
  getPresetTokens,
  normalizeHex,
  parseCodexThemeString,
  presetsForVariant,
  resolveChromeTheme,
  resolveCodeThemeId,
  resolveSemanticColors,
  resolveVariantFonts,
} from "../../lib/themePalette"
import { useIsDark } from "../../hooks/useIsDark"
import { defaultSettings } from "../../theme/settings"
import { NumberField, Row, Section, Segmented, Select, Slider, Toggle, actionButton } from "./controls"

type Theme = AppSettings["appearance"]["theme"]

export function AppearancePage({
  settings,
  onChange,
}: {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}) {
  const appearance = settings.appearance
  const isDark = useIsDark(appearance.theme)
  const variant = isDark ? "dark" : "light"
  const contrast = clampContrast(appearance.contrast?.[variant], variant)
  const translucency = {
    light: activeTranslucency(appearance.translucentSidebar, false),
    dark: activeTranslucency(appearance.translucentSidebar, true),
  }
  const [fontFamilies, setFontFamilies] = useState<LocalFontFamily[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState("")
  const [importError, setImportError] = useState<string | null>(null)
  const [copiedTheme, setCopiedTheme] = useState(false)

  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const resolvedTheme = resolveChromeTheme(appearance, isDark)
  const resolvedCodeThemeId = resolveCodeThemeId(appearance, isDark)
  const resolvedSemantics = resolveSemanticColors(appearance, isDark)
  const defaultSemantics = DEFAULT_SEMANTIC_COLORS[variant]
  const presetOptions: [string, string][] = presetsForVariant(variant).map((preset) => [preset.id, preset.label])
  const codeThemeOptions = getCodeThemeOptions(variant)
  const chromeKey = isDark ? "darkChromeTheme" : "lightChromeTheme"
  const activeChrome = appearance[chromeKey]
  const presetBase = getPresetTokens(resolvedTheme.presetId, variant)
  const hasCustomAccent = Boolean(activeChrome?.accent && activeChrome.accent !== presetBase.accent)
  const hasCustomSemantics = Boolean(
    activeChrome?.semanticColors &&
      (activeChrome.semanticColors.diffAdded || activeChrome.semanticColors.diffRemoved || activeChrome.semanticColors.skill),
  )

  const selectPreset = (presetId: string) => {
    const pairedCodeThemeId = getPresetDefaultCodeThemeId(presetId, variant)
    change({
      [chromeKey]: {
        presetId,
        ...(pairedCodeThemeId !== DEFAULT_CODE_THEME_ID ? { codeThemeId: pairedCodeThemeId } : {}),
        ...(activeChrome?.semanticColors ? { semanticColors: activeChrome.semanticColors } : {}),
        ...(activeChrome?.fonts ? { fonts: activeChrome.fonts } : {}),
      },
    })
  }
  const updateAccent = (accent: string) => {
    const normalized = normalizeHex(accent)
    if (!normalized) return
    change({
      [chromeKey]: {
        ...activeChrome,
        presetId: resolvedTheme.presetId,
        accent: normalized === presetBase.accent ? undefined : normalized,
      },
    })
  }
  const updateCodeTheme = (codeThemeId: string) => {
    change({
      [chromeKey]: {
        ...activeChrome,
        presetId: resolvedTheme.presetId,
        codeThemeId: codeThemeId === DEFAULT_CODE_THEME_ID ? undefined : codeThemeId,
      },
    })
  }
  const updateSemanticColor = (key: keyof SemanticColors, value: string) => {
    const normalized = normalizeHex(value)
    if (!normalized) return
    const next: SemanticColors = {
      ...activeChrome?.semanticColors,
      [key]: normalized.toLowerCase() === defaultSemantics[key].toLowerCase() ? undefined : normalized,
    }
    if (!next.diffAdded) delete next.diffAdded
    if (!next.diffRemoved) delete next.diffRemoved
    if (!next.skill) delete next.skill
    change({
      [chromeKey]: {
        ...activeChrome,
        presetId: resolvedTheme.presetId,
        semanticColors: Object.keys(next).length > 0 ? next : undefined,
      },
    })
  }
  const resetSemanticColors = () => {
    change({
      [chromeKey]: {
        ...activeChrome,
        presetId: resolvedTheme.presetId,
        semanticColors: undefined,
      },
    })
  }
  const copyTheme = async () => {
    const text = exportCodexThemeString(appearance, isDark)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedTheme(true)
      setTimeout(() => setCopiedTheme(false), 1800)
    } catch {
      setImportDraft(text)
      setImportOpen(true)
    }
  }
  const applyImport = () => {
    const parsed = parseCodexThemeString(importDraft)
    if (!parsed) {
      setImportError("Invalid codex-theme-v1 string")
      return
    }
    const targetKey = parsed.variant === "dark" ? "darkChromeTheme" : "lightChromeTheme"
    change({
      theme: parsed.variant,
      [targetKey]: parsed.chromeTheme,
      ...(parsed.contrast !== undefined && {
        contrast: { ...appearance.contrast, [parsed.variant]: parsed.contrast },
      }),
    })
    setImportOpen(false)
    setImportDraft("")
    setImportError(null)
  }
  const activeFonts = resolveVariantFonts(appearance, isDark)
  const updateFonts = (patch: Partial<ThemeFonts>) =>
    change({
      [chromeKey]: {
        ...activeChrome,
        presetId: resolvedTheme.presetId,
        fonts: { ...activeChrome?.fonts, ...patch },
      },
    })
  const facesFor = (family: string) => fontFamilies.find((f) => f.family === family)?.faces ?? []
  const faceLabel = (face: ThemeFontFace) => faceStyle(face).replace(/([a-z])([A-Z])/g, "$1 $2")
  // Prefer the family's Regular face: the platform lists faces in an arbitrary order.
  const defaultFace = (faces: ThemeFontFace[]) => faces.find(isRegularFace) ?? faces[0]
  const familyOption = (family: string): [string, string] => [family, family]
  const withStoredFamily = (options: [string, string][], family: string) => {
    if (family && family !== SYSTEM_DEFAULT_FONT && family !== CONTENT_SAME_AS_UI && !options.some(([value]) => value === family))
      options.push(familyOption(family))
    return options
  }
  const uiFamilyOptions = withStoredFamily(
    [[SYSTEM_DEFAULT_FONT, "System default"], ...fontFamilies.map((f) => familyOption(f.family))],
    activeFonts.ui,
  )
  const contentFamilyOptions = withStoredFamily(
    [[CONTENT_SAME_AS_UI, "Same as UI font"], [SYSTEM_DEFAULT_FONT, "System default"], ...fontFamilies.map((f) => familyOption(f.family))],
    activeFonts.content,
  )
  const codeFamilyOptions = withStoredFamily(
    [[SYSTEM_DEFAULT_FONT, "System monospace"], ...fontFamilies.filter((f) => f.monospaced).map((f) => familyOption(f.family))],
    activeFonts.code,
  )
  const faceOptions = (family: string, face: ThemeFontFace | undefined, fallbackLabel: string): [string, string][] => {
    const faces = facesFor(family)
    if (!faces.length) return [["", fallbackLabel]]
    const options = faces.map((item): [string, string] => [item.postscriptName, faceLabel(item)])
    if (face && !faces.some((item) => item.postscriptName === face.postscriptName)) options.unshift([face.postscriptName, faceLabel(face)])
    return options
  }
  const faceValue = (family: string, face: ThemeFontFace | undefined) => {
    if (family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI) return ""
    return face?.postscriptName ?? defaultFace(facesFor(family))?.postscriptName ?? ""
  }
  const chooseFamily = (role: "ui" | "content" | "code", family: string) => {
    const face = family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI ? undefined : defaultFace(facesFor(family))
    if (role === "ui") updateFonts({ ui: family, uiFace: face })
    else if (role === "content") updateFonts({ content: family, contentFace: face })
    else updateFonts({ code: family, codeFace: face })
  }
  const chooseFace = (role: "ui" | "content" | "code", postscriptName: string) => {
    const face = facesFor(role === "ui" ? activeFonts.ui : role === "content" ? activeFonts.content : activeFonts.code)
      .find((item) => item.postscriptName === postscriptName)
    if (role === "ui") updateFonts({ uiFace: face })
    else if (role === "content") updateFonts({ contentFace: face })
    else updateFonts({ codeFace: face })
  }
  const faceSelect = ({ role, family, face }: { role: "ui" | "content" | "code"; family: string; face?: ThemeFontFace }) => (
    <Select
      value={faceValue(family, face)}
      options={faceOptions(family, face, "Regular")}
      disabled={family === SYSTEM_DEFAULT_FONT || family === CONTENT_SAME_AS_UI}
      onChange={(postscriptName) => chooseFace(role, postscriptName)}
    />
  )
  const fontPair = ({ role, family, face, options }: { role: "content" | "code"; family: string; face?: ThemeFontFace; options: [string, string][] }) => (
    <div className="flex shrink-0 items-center gap-2">
      <Select value={family} options={options} onChange={(next) => chooseFamily(role, next)} />
      {faceSelect({ role, family, face })}
    </div>
  )

  useEffect(() => {
    let cancelled = false
    loadFontFamilies()
      .then((families) => { if (!cancelled) setFontFamilies(families) })
      .catch(() => { if (!cancelled) setFontFamilies([]) })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <Section title="Visual style">
        <Row label="Mode" description="Follow the system or pick a fixed appearance.">
          <Segmented
            value={appearance.theme}
            options={[
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"],
            ]}
            onChange={(theme) => change({ theme: theme as Theme })}
          />
        </Row>
        <Row label="Theme" description={`Palette for ${variant} mode; light and dark keep separate presets.`}>
          <Select value={resolvedTheme.presetId} options={presetOptions} onChange={selectPreset} />
        </Row>
        <Row label="Code theme" description={`Syntax highlighting theme for ${variant} mode.`}>
          <Select value={resolvedCodeThemeId} options={codeThemeOptions} onChange={updateCodeTheme} />
        </Row>
        <Row label="Accent" description={`Accent color for ${variant} mode.`}>
          <div className="flex shrink-0 items-center gap-2">
            <input
              type="color"
              aria-label="Accent color"
              value={resolvedTheme.accent}
              onChange={(e) => updateAccent(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded border border-[var(--border-default)] bg-transparent p-0.5"
            />
            <span className="w-16 font-mono text-caption text-[var(--text-secondary)]">{resolvedTheme.accent}</span>
            {hasCustomAccent && (
              <button type="button" className={actionButton} onClick={() => updateAccent(presetBase.accent)}>
                Reset
              </button>
            )}
          </div>
        </Row>
        <Row label="Semantic colors" description={`Diff added, diff removed, and skill highlight colors for ${variant} mode.`}>
          <div className="flex shrink-0 items-center gap-2.5">
            {(
              [
                ["diffAdded", "Added", resolvedSemantics.diffAdded],
                ["diffRemoved", "Removed", resolvedSemantics.diffRemoved],
                ["skill", "Skill", resolvedSemantics.skill],
              ] as const
            ).map(([key, shortLabel, colorValue]) => (
              <label key={key} className="flex items-center gap-1 text-caption text-[var(--text-secondary)]">
                <input
                  type="color"
                  aria-label={`${shortLabel} semantic color`}
                  value={colorValue}
                  onChange={(e) => updateSemanticColor(key, e.target.value)}
                  className="h-6 w-7 cursor-pointer rounded border border-[var(--border-default)] bg-transparent p-0.5"
                />
                <span>{shortLabel}</span>
              </label>
            ))}
            {hasCustomSemantics && (
              <button type="button" className={actionButton} onClick={resetSemanticColors}>
                Reset
              </button>
            )}
          </div>
        </Row>
        <Row label="Share theme" description="Export or import a Codex-compatible theme string.">
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={actionButton} onClick={() => void copyTheme()}>
              {copiedTheme ? "Copied" : "Export"}
            </button>
            <button
              type="button"
              className={actionButton}
              onClick={() => { setImportOpen((open) => !open); setImportError(null) }}
            >
              {importOpen ? "Cancel" : "Import"}
            </button>
          </div>
        </Row>
        {importOpen && (
          <div className="px-4 pb-3 pt-1">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={importDraft}
                onChange={(e) => { setImportDraft(e.target.value); setImportError(null) }}
                placeholder="Paste codex-theme-v1:{...}"
                className="h-8 flex-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 font-mono text-caption text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
              />
              <button type="button" className={actionButton} onClick={applyImport}>
                Apply
              </button>
            </div>
            {importError && <p className="mt-1 text-caption text-[var(--text-danger)]">{importError}</p>}
          </div>
        )}
        {supportsSidebarTranslucency() && (
          <Row label="Translucent sidebar" description="Let the desktop material show behind the sidebar, per theme.">
            <Toggle
              checked={translucency[variant]}
              onChange={(enabled) => change({ translucentSidebar: { ...translucency, [variant]: enabled } })}
            />
          </Row>
        )}
        <Row label="Contrast" description="Divider and border contrast for the active theme; light and dark keep separate values.">
          <Slider
            label="Contrast"
            value={contrast}
            onChange={(value) => change({ contrast: { ...appearance.contrast, [variant]: value } })}
          />
        </Row>
      </Section>

      <Section title="Text">
        <Row label="UI font" description="Family for the interface.">
          <Select value={activeFonts.ui} options={uiFamilyOptions} onChange={(family) => chooseFamily("ui", family)} />
        </Row>
        <Row label="UI font style" description="Face of the selected family.">
          {faceSelect({ role: "ui", family: activeFonts.ui, face: activeFonts.uiFace })}
        </Row>
        <Row label="Content font" description="Typeface for messages and page content.">
          {fontPair({ role: "content", family: activeFonts.content, face: activeFonts.contentFace, options: contentFamilyOptions })}
        </Row>
        <Row label="Code font" description="Typeface for code blocks and diffs, separate from the interface font.">
          {fontPair({ role: "code", family: activeFonts.code, face: activeFonts.codeFace, options: codeFamilyOptions })}
        </Row>
        <Row label="UI font size" description="Base size for interface text (11–16 px).">
          <NumberField value={appearance.uiFontSize} min={11} max={16} onChange={(uiFontSize) => change({ uiFontSize })} />
        </Row>
        <Row label="Code font size" description="Size for code blocks (8–24 px).">
          <NumberField value={appearance.codeFontSize} min={8} max={24} onChange={(codeFontSize) => change({ codeFontSize })} />
        </Row>
        <Row label="Font smoothing" description="Smooth edges of text on screen.">
          <Toggle checked={appearance.fontSmoothing} onChange={(fontSmoothing) => change({ fontSmoothing })} />
        </Row>
      </Section>

      <Section title="Layout">
        <Row label="Transcript text size" description="Size of message text, relative to the interface font size.">
          <Segmented
            value={appearance.transcriptTextSize}
            options={[
              ["small", "Small"],
              ["medium", "Medium"],
              ["large", "Large"],
            ]}
            onChange={(transcriptTextSize) => change({ transcriptTextSize: transcriptTextSize as AppSettings["appearance"]["transcriptTextSize"] })}
          />
        </Row>
        <Row label="Output width" description="Three reading widths for messages and input. Fits smaller windows automatically.">
          <Segmented
            value={String(appearance.maxWidth)}
            options={[
              ["680", "Compact"],
              ["800", "Comfortable"],
              ["1040", "Wide"],
            ]}
            onChange={(maxWidth) => change({ maxWidth: Number(maxWidth) })}
          />
        </Row>
        <Row label="Reduce motion" description="System follows your computer's setting. Reduced turns off transitions and animations.">
          <Segmented
            value={appearance.motion}
            options={[
              ["system", "System"],
              ["reduced", "Reduced"],
            ]}
            onChange={(motion) => change({ motion: motion as AppSettings["appearance"]["motion"] })}
          />
        </Row>
        <Row label="Pointer cursors" description="Show a pointer over clickable controls.">
          <Toggle checked={appearance.usePointerCursors} onChange={(usePointerCursors) => change({ usePointerCursors })} />
        </Row>
        <Row label="Reset appearance" description="Restore the default fonts, colors, and layout."><button type="button" className={actionButton} onClick={() => onChange({ ...settings, appearance: { ...defaultSettings.appearance } })}>Reset to default</button></Row>
      </Section>
    </>
  )
}
