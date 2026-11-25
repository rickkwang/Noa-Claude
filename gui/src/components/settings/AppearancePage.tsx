import { useEffect, useState } from "react"
import type { AppSettings, SemanticColors, ThemeFontFace, ThemeFonts } from "../../types"
import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from "../../lib/fontFamily"
import { faceStyle, isRegularFace, loadFontFamilies, type LocalFontFamily } from "../../lib/localFonts"
import { DEFAULT_CODE_THEME_ID, getCodeThemeOptions, resolveCodeTheme } from "../../lib/codeThemes"
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
import { defaultSettings, isDefaultAppearance } from "../../theme/settings"
import { useConfirm } from "../ConfirmDialog"
import { NumberField, Row, Section, Segmented, Select, Slider, Toggle, actionButton, dangerButton, fieldInput, primaryButton, type SelectOption } from "./controls"

// Icon-only theme choices, drawn from a 1000-unit grid.
const themeIcon = (d: string) => (
  <svg width={16} height={16} viewBox="0 0 1000 1000" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
)
const THEME_ICONS = {
  system: themeIcon("M749 152 800 153 822 156 841 163Q871 178 887 209L894 228L897 249L898 273V549L897 601L894 622L887 641Q871 672 841 687L822 694L800 697L777 698H251L200 697L178 694L159 687Q129 672 113 641L106 621L103 601L102 577V301L103 249L106 228L113 209Q129 178 159 163L178 156L200 153L223 152ZM749 210H224L192 213L185 216Q172 222 165 235L161 254V596L165 615Q172 628 185 634L186 635L204 639L776 640L808 637L815 634Q828 628 835 615L839 596V254L835 235Q828 222 815 216L814 215L796 211ZM352 669H411V790H589V669H648V819Q648 831 639.5 839.5Q631 848 619 848H381Q369 848 360.5 839.5Q352 831 352 819Z"),
  light: themeIcon("M673 500Q673 535 659.5 566.5Q646 598 622.0 622.0Q598 646 566.5 659.5Q535 673 500 673Q465 673 433.5 659.5Q402 646 378.0 622.0Q354 598 340.5 566.5Q327 535 327 500Q327 465 340.5 433.5Q354 402 378.0 378.0Q402 354 433.5 340.5Q465 327 500 327Q535 327 566.5 340.5Q598 354 622.0 378.0Q646 402 659.5 433.5Q673 465 673 500ZM615 500Q615 469 599.0 443.0Q583 417 557.0 401.0Q531 385 500 385Q469 385 443.0 401.0Q417 417 401.0 443.0Q385 469 385 500Q385 531 401.0 557.0Q417 583 443.0 599.0Q469 615 500 615Q531 615 557.0 599.0Q583 583 599.0 557.0Q615 531 615 500ZM806 529Q794 529 785.5 520.5Q777 512 777 500Q777 488 785.5 479.5Q794 471 806 471H869Q881 471 889.5 479.5Q898 488 898 500Q898 512 889.5 520.5Q881 529 869 529ZM696 737Q687 729 687.0 716.5Q687 704 696 696Q704 687 716.5 687.0Q729 687 737 696L781 740Q790 748 790.0 760.5Q790 773 782 781Q773 790 761.0 790.0Q749 790 740 781ZM471 806Q471 794 479.5 785.5Q488 777 500 777Q512 777 520.5 785.5Q529 794 529 806V869Q529 881 520.5 889.5Q512 898 500 898Q488 898 479.5 889.5Q471 881 471 869ZM263 696Q271 687 283.5 687.0Q296 687 304 696Q313 704 313.0 716.5Q313 729 304 737L260 781Q251 790 239.0 790.0Q227 790 218 781Q210 773 210.0 760.5Q210 748 219 740ZM194 471Q206 471 214.5 479.5Q223 488 223 500Q223 512 214.5 520.5Q206 529 194 529H131Q119 529 110.5 520.5Q102 512 102 500Q102 488 110.5 479.5Q119 471 131 471ZM304 263Q313 271 313.0 283.5Q313 296 304 304Q296 313 283.5 313.0Q271 313 263 304L219 260Q210 252 210.0 239.5Q210 227 218 219Q227 210 239.0 210.0Q251 210 260 219ZM529 194Q529 206 520.5 214.5Q512 223 500 223Q488 223 479.5 214.5Q471 206 471 194V131Q471 119 479.5 110.5Q488 102 500 102Q512 102 520.5 110.5Q529 119 529 131ZM737 304Q729 313 716.5 313.0Q704 313 696 304Q687 296 687.0 283.5Q687 271 696 263L740 219Q749 210 761.0 210.0Q773 210 782 219Q790 227 790.0 239.5Q790 252 781 260Z"),
  dark: themeIcon("M134 344Q165 270 222.0 215.0Q279 160 352.5 130.5Q426 101 507 102Q518 102 525.0 108.0Q532 114 534.5 123.0Q537 132 534.5 141.0Q532 150 523 156Q483 182 457.5 220.0Q432 258 422.5 303.0Q413 348 423 394Q432 441 457.5 479.0Q483 517 521.0 542.5Q559 568 606 577Q652 587 697.0 577.5Q742 568 780.0 542.5Q818 517 844 477Q850 468 859.0 465.5Q868 463 877.0 465.5Q886 468 892.0 475.0Q898 482 898 493Q899 574 869.5 647.5Q840 721 785.0 778.0Q730 835 656 866Q581 898 502.0 898.0Q423 898 349.5 868.5Q276 839 219 781Q161 724 131.5 650.5Q102 577 102.0 498.0Q102 419 134 344ZM188 367Q160 431 160.0 498.5Q160 566 185.5 628.5Q211 691 260 740Q309 789 371.5 814.5Q434 840 501.5 840.0Q569 840 633 812Q696 785 743.0 736.5Q790 688 815.5 625.5Q841 563 839 494Q840 505 846.0 512.0Q852 519 860.5 521.5Q869 524 878.0 521.5Q887 519 893 510Q861 559 813.0 591.0Q765 623 708.5 634.5Q652 646 594 635Q536 623 488.5 591.0Q441 559 409.0 511.5Q377 464 365 406Q354 348 365.5 291.5Q377 235 409.0 187.0Q441 139 490 107Q481 113 478.5 122.0Q476 131 478.5 139.5Q481 148 488.0 154.0Q495 160 506 161Q437 159 374.5 184.5Q312 210 263.5 257.0Q215 304 188 367Z"),
}

type Theme = AppSettings["appearance"]["theme"]

function ColorDots({ colors }: { colors: string[] }) {
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1" aria-hidden="true">
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="size-2.5 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  )
}

function ColorSwatchPill({
  ariaLabel,
  color,
  label,
  mono = false,
  onChange,
}: {
  ariaLabel: string
  color: string
  label: string
  mono?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="relative inline-flex h-7 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 transition-colors hover:border-[var(--border-strong)]">
      <input
        type="color"
        aria-label={ariaLabel}
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden="true"
        className="size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20"
        style={{ backgroundColor: color }}
      />
      <span className={`text-caption text-[var(--text-primary)] select-none ${mono ? "font-mono uppercase" : ""}`}>
        {label}
      </span>
    </label>
  )
}

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
  const translucent = activeTranslucency(appearance.translucentSidebar, isDark)
  const [fontFamilies, setFontFamilies] = useState<LocalFontFamily[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [importDraft, setImportDraft] = useState("")
  const [importError, setImportError] = useState<string | null>(null)
  const [copiedTheme, setCopiedTheme] = useState(false)
  const { confirm, dialog } = useConfirm()

  const change = (patch: Partial<AppSettings["appearance"]>) =>
    onChange({ ...settings, appearance: { ...appearance, ...patch } })
  const resolvedTheme = resolveChromeTheme(appearance, isDark)
  const resolvedCodeThemeId = resolveCodeThemeId(appearance, isDark)
  const resolvedCodeColors = resolveCodeTheme(resolvedCodeThemeId, variant).colors
  const resolvedSemantics = resolveSemanticColors(appearance, isDark)
  const defaultSemantics = DEFAULT_SEMANTIC_COLORS[variant]
  const presetOptions: SelectOption[] = presetsForVariant(variant).map((preset) => {
    const tokens = getPresetTokens(preset.id, variant)
    return {
      value: preset.id,
      label: preset.label,
      leading: <ColorDots colors={[tokens.surface, tokens.ink, tokens.accent]} />,
    }
  })
  const codeThemeOptions: SelectOption[] = getCodeThemeOptions(variant).map(([id, label]) => {
    const c = resolveCodeTheme(id, variant).colors
    return {
      value: id,
      label,
      leading: <ColorDots colors={[c.keyword, c.string, c.type]} />,
    }
  })
  const chromeKey = isDark ? "darkChromeTheme" : "lightChromeTheme"
  const activeChrome = appearance[chromeKey]
  const presetBase = getPresetTokens(resolvedTheme.presetId, variant)
  const hasCustomAccent = Boolean(activeChrome?.accent && activeChrome.accent !== presetBase.accent)
  const hasCustomSemantics = Boolean(
    activeChrome?.semanticColors &&
      (activeChrome.semanticColors.diffAdded || activeChrome.semanticColors.diffRemoved || activeChrome.semanticColors.skill),
  )
  const isDefault = isDefaultAppearance(appearance)

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
  const serifFamilyOptions = withStoredFamily(
    [[SYSTEM_DEFAULT_FONT, "System serif"], ...fontFamilies.map((f) => familyOption(f.family))],
    appearance.serifFont ?? SYSTEM_DEFAULT_FONT,
  )
  const responseFamilyOptions = withStoredFamily(
    [[CONTENT_SAME_AS_UI, "Same as Content font"], [SYSTEM_DEFAULT_FONT, "System default"], ...fontFamilies.map((f) => familyOption(f.family))],
    appearance.responseFont ?? CONTENT_SAME_AS_UI,
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
      label={`${role} font style`}
      onChange={(postscriptName) => chooseFace(role, postscriptName)}
    />
  )
  const fontPair = ({ role, label, family, face, options }: { role: "ui" | "content" | "code"; label: string; family: string; face?: ThemeFontFace; options: [string, string][] }) => {
    const showFace = family !== SYSTEM_DEFAULT_FONT && family !== CONTENT_SAME_AS_UI && facesFor(family).length > 1
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Select
          value={family}
          options={options}
          label={label}
          searchable
          searchPlaceholder="Search fonts…"
          onChange={(next) => chooseFamily(role, next)}
        />
        {showFace && faceSelect({ role, family, face })}
      </div>
    )
  }

  useEffect(() => {
    let cancelled = false
    loadFontFamilies()
      .then((families) => { if (!cancelled) setFontFamilies(families) })
      .catch(() => { if (!cancelled) setFontFamilies([]) })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-card,#FFFFFF)_30%,transparent)] p-4">
        <div className="flex items-center justify-between text-caption text-[var(--sidebar-text-muted)]">
          <span>Preview · {isDark ? "Dark" : "Light"}</span>
          {appearance.theme === "system" && <span>Following system</span>}
        </div>
        <p
          className="m-0 text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-content)", fontSize: "var(--transcript-text-size)", lineHeight: 1.5 }}
        >
          Run <span className="font-medium" style={{ color: "var(--skill-color)" }}>/review</span> before merging —{" "}
          <span className="font-medium" style={{ color: "var(--accent-color)" }}>2 files</span> updated cleanly.
        </p>
        <pre
          className="m-0 overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 leading-relaxed"
          style={{ fontFamily: "var(--font-mono)", fontSize: "var(--code-font-size)" }}
        >
          <code className="block">
            <span className="block" style={{ color: "var(--hljs-comment)", fontStyle: "var(--hljs-comment-style)" }}>
              {"// Live theme & font preview"}
            </span>
            <span className="block">
              <span style={{ color: "var(--hljs-keyword)" }}>const</span>{" "}
              <span style={{ color: "var(--hljs-title)" }}>status</span> ={" "}
              <span style={{ color: "var(--hljs-string)" }}>&quot;ready&quot;</span>;{" "}
              <span style={{ color: "var(--hljs-number)" }}>42</span>
            </span>
            <span
              className="mt-1 block rounded-[4px] px-1.5"
              style={{
                color: "var(--diff-removed)",
                backgroundColor: "color-mix(in srgb, var(--diff-removed) 10%, transparent)",
              }}
            >
              - timeoutMs: 3000
            </span>
            <span
              className="block rounded-[4px] px-1.5"
              style={{
                color: "var(--diff-added)",
                backgroundColor: "color-mix(in srgb, var(--diff-added) 10%, transparent)",
              }}
            >
              + timeoutMs: 5000
            </span>
          </code>
        </pre>
      </div>

      <Section title="Visual style">
        <Row label="Mode" description="Follow the system or pick a fixed appearance.">
          <Segmented
            value={appearance.theme}
            options={[
              ["system", "System", THEME_ICONS.system],
              ["light", "Light", THEME_ICONS.light],
              ["dark", "Dark", THEME_ICONS.dark],
            ]}
            onChange={(theme) => change({ theme: theme as Theme })}
          />
        </Row>
        <Row label="Theme" description={`Palette for ${variant} mode; light and dark keep separate presets.`}>
          <Select
            value={resolvedTheme.presetId}
            options={presetOptions}
            label="Theme"
            triggerLeading={<ColorDots colors={[resolvedTheme.surface, resolvedTheme.ink, resolvedTheme.accent]} />}
            onChange={selectPreset}
          />
        </Row>
        <Row label="Code theme" description={`Syntax highlighting theme for ${variant} mode.`}>
          <Select
            value={resolvedCodeThemeId}
            options={codeThemeOptions}
            label="Code theme"
            searchable
            searchPlaceholder="Search code themes…"
            triggerLeading={<ColorDots colors={[resolvedCodeColors.keyword, resolvedCodeColors.string, resolvedCodeColors.type]} />}
            onChange={updateCodeTheme}
          />
        </Row>
        <Row label="Accent" description={`Accent color for ${variant} mode.`}>
          <div className="flex shrink-0 items-center gap-2">
            <ColorSwatchPill
              ariaLabel="Accent color"
              color={resolvedTheme.accent}
              label={resolvedTheme.accent}
              mono
              onChange={updateAccent}
            />
            {hasCustomAccent && (
              <button type="button" className={actionButton} onClick={() => updateAccent(presetBase.accent)}>
                Reset
              </button>
            )}
          </div>
        </Row>
        <Row label="Semantic colors" description={`Diff added, diff removed, and skill highlight colors for ${variant} mode.`}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(
              [
                ["diffAdded", "Added", resolvedSemantics.diffAdded],
                ["diffRemoved", "Removed", resolvedSemantics.diffRemoved],
                ["skill", "Skill", resolvedSemantics.skill],
              ] as const
            ).map(([key, shortLabel, colorValue]) => (
              <ColorSwatchPill
                key={key}
                ariaLabel={`${shortLabel} semantic color`}
                color={colorValue}
                label={shortLabel}
                onChange={(next) => updateSemanticColor(key, next)}
              />
            ))}
            {hasCustomSemantics && (
              <button type="button" className={actionButton} onClick={resetSemanticColors}>
                Reset
              </button>
            )}
          </div>
        </Row>
        <div>
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
                  autoFocus
                  type="text"
                  value={importDraft}
                  onChange={(e) => { setImportDraft(e.target.value); setImportError(null) }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    if (e.key === "Enter" && importDraft.trim()) applyImport()
                    else if (e.key === "Escape") {
                      e.preventDefault()
                      e.stopPropagation()
                      setImportOpen(false)
                      setImportError(null)
                    }
                  }}
                  placeholder="Paste codex-theme-v1:{...}"
                  className={`${fieldInput} h-7 flex-1 font-mono text-caption`}
                />
                <button type="button" disabled={!importDraft.trim()} className={primaryButton} onClick={applyImport}>
                  Apply
                </button>
              </div>
              {importError && <p className="mt-1 text-caption text-[var(--text-danger)]">{importError}</p>}
            </div>
          )}
        </div>
        {supportsSidebarTranslucency() && (
          <Row label="Translucent sidebar" description="Let the desktop material show behind the sidebar, in both light and dark.">
            <Toggle
              checked={translucent}
              onChange={(enabled) => change({ translucentSidebar: { light: enabled, dark: enabled } })}
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
        <Row label="UI font" description={`Typeface for the interface in ${variant} mode.`}>
          {fontPair({ role: "ui", label: "UI font", family: activeFonts.ui, face: activeFonts.uiFace, options: uiFamilyOptions })}
        </Row>
        <Row label="Content font" description={`Typeface for messages and page content in ${variant} mode.`}>
          {fontPair({ role: "content", label: "Content font", family: activeFonts.content, face: activeFonts.contentFace, options: contentFamilyOptions })}
        </Row>
        <Row label="Response font" description="Typeface for assistant replies.">
          <Select
            value={appearance.responseFont ?? CONTENT_SAME_AS_UI}
            options={responseFamilyOptions}
            label="Response font"
            searchable
            searchPlaceholder="Search fonts…"
            onChange={(responseFont) => change({ responseFont })}
          />
        </Row>
        <Row label="Code font" description={`Typeface for code blocks and diffs in ${variant} mode.`}>
          {fontPair({ role: "code", label: "Code font", family: activeFonts.code, face: activeFonts.codeFace, options: codeFamilyOptions })}
        </Row>
        <Row label="Serif font" description="Typeface for page titles and the new task heading.">
          <Select
            value={appearance.serifFont ?? SYSTEM_DEFAULT_FONT}
            options={serifFamilyOptions}
            label="Serif font"
            searchable
            searchPlaceholder="Search fonts…"
            onChange={(serifFont) => change({ serifFont })}
          />
        </Row>
        <Row label="UI font size" description="Base size for interface text (11–16 px).">
          <NumberField label="UI font size" value={appearance.uiFontSize} min={11} max={16} onChange={(uiFontSize) => change({ uiFontSize })} />
        </Row>
        <Row label="Code font size" description="Size for code blocks (8–24 px).">
          <NumberField label="Code font size" value={appearance.codeFontSize} min={8} max={24} onChange={(codeFontSize) => change({ codeFontSize })} />
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
        <Row label="Default transcript view" description="The view sessions open in. Picking a view from a session’s menu changes only that session.">
          <Segmented
            value={appearance.transcriptView}
            options={[
              ["normal", "Normal"],
              ["thinking", "Thinking"],
              ["verbose", "Verbose"],
            ]}
            onChange={(transcriptView) => change({ transcriptView: transcriptView as AppSettings["appearance"]["transcriptView"] })}
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
      </Section>

      <div data-settings-label="Reset appearance" className="flex items-center justify-between gap-4 px-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-chat-sm leading-[18px] font-medium">Reset appearance</span>
          <span className="text-caption leading-4 text-[var(--sidebar-text-muted)]">Restore the default fonts, colors, and layout.</span>
        </div>
        <button
          type="button"
          disabled={isDefault}
          className={dangerButton}
          onClick={async () => {
            if (await confirm({
              title: "Reset appearance to defaults?",
              description: "This restores the default light and dark themes, custom colors, fonts, and layout.",
              confirmLabel: "Reset",
              danger: true,
            })) {
              onChange({ ...settings, appearance: { ...defaultSettings.appearance } })
            }
          }}
        >
          Reset to default
        </button>
      </div>
      {dialog}
    </>
  )
}
