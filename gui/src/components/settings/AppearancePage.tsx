import { useEffect, useState } from "react"
import type { AppSettings, ThemeFontFace, ThemeFonts } from "../../types"
import { ChevronDown } from "../../lib/icons"
import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from "../../lib/fontFamily"
import { faceStyle, isRegularFace, loadFontFamilies, type LocalFontFamily } from "../../lib/localFonts"
import { clampContrast } from "../../lib/contrast"
import { activeTranslucency, supportsSidebarTranslucency } from "../../lib/translucency"
import { useIsDark } from "../../hooks/useIsDark"
import { defaultSettings } from "../../theme/settings"
import { NumberField, Row, Section, Segmented, Select, Slider, Toggle, actionButton } from "./controls"

type Theme = AppSettings["appearance"]["theme"]

export function AppearancePage({
  settings,
  showAdvanced,
  onToggleAdvanced,
  onChange,
}: {
  settings: AppSettings
  showAdvanced: boolean
  onToggleAdvanced: () => void
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
  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const activeFonts = appearance.fonts ?? defaultSettings.appearance.fonts
  const updateFonts = (patch: Partial<ThemeFonts>) => change({ fonts: { ...activeFonts, ...patch } })
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
        <Row label="Font" description="Family for the interface.">
          <Select value={activeFonts.ui} options={uiFamilyOptions} onChange={(family) => chooseFamily("ui", family)} />
        </Row>
      </Section>

      <div className="flex flex-col">
        <button
          type="button"
          aria-expanded={showAdvanced}
          onClick={onToggleAdvanced}
          className="flex min-h-10 w-fit cursor-pointer items-center gap-1 pb-1.5 text-body font-medium text-[var(--sidebar-text-muted)] hover:text-[var(--text-primary)]"
        >
          Advanced
          <ChevronDown size={14} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        </button>
        {showAdvanced && (
          <div className="flex flex-col gap-6">
            <Section title={`${isDark ? "Dark" : "Light"} theme`}>
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
          </div>
        )}
      </div>

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
