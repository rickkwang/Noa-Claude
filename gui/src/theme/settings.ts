import { clampContrast } from '../lib/contrast'
import { SYSTEM_DEFAULT_FONT, CONTENT_SAME_AS_UI } from '../lib/fontFamily'
import { activeTranslucency } from '../lib/translucency'
import type { AppSettings, ChromeThemeConfig, ThemeFonts } from '../types'
import { defaultShortcuts } from '../lib/shortcuts'

const defaultFonts = (): ThemeFonts => ({
  ui: SYSTEM_DEFAULT_FONT,
  content: CONTENT_SAME_AS_UI,
  code: SYSTEM_DEFAULT_FONT,
})

export const defaultSettings: AppSettings = {
  appearance: {
    theme: 'system',
    fonts: defaultFonts(),
    contrast: { light: 45, dark: 60 },
    maxWidth: 800,
    usePointerCursors: true,
    translucentSidebar: { light: false, dark: false },
    motion: 'system',
    uiFontSize: 14,
    transcriptTextSize: 'medium',
    transcriptView: 'normal',
    codeFontSize: 12,
    serifFont: SYSTEM_DEFAULT_FONT,
    fontSmoothing: true,
  },
  composer: { sendShortcut: 'enter', followUpMode: 'queue', showFullAccess: true, showContextUsage: true, systemCaret: false, streamSound: { enabled: false, preset: 'classic', volume: 100 }, mascot: 'clawd' },
  terminal: { defaultLocation: 'bottom', fontFamily: '' },
  shortcuts: defaultShortcuts,
  agent: {
    permissionDefault: 'inherit',
    outputStyle: 'inherit',
  },
  notifications: { turnMode: 'unfocused', sound: 'default', permissions: true, questions: true, dot: true },
};

function isDefaultChromeFonts(fonts: Partial<ThemeFonts> | undefined): boolean {
  if (!fonts) return true;
  return (
    (!fonts.ui || fonts.ui === SYSTEM_DEFAULT_FONT) &&
    !fonts.uiFace &&
    (!fonts.content || fonts.content === CONTENT_SAME_AS_UI) &&
    !fonts.contentFace &&
    (!fonts.code || fonts.code === SYSTEM_DEFAULT_FONT) &&
    !fonts.codeFace
  );
}

function isDefaultChromeTheme(chrome: ChromeThemeConfig | undefined): boolean {
  if (!chrome) return true;
  return (
    (!chrome.presetId || chrome.presetId === 'noa') &&
    !chrome.surface &&
    !chrome.ink &&
    !chrome.accent &&
    (!chrome.codeThemeId || chrome.codeThemeId === 'codex') &&
    !chrome.semanticColors &&
    isDefaultChromeFonts(chrome.fonts)
  );
}

export function isDefaultAppearance(appearance: AppSettings['appearance']): boolean {
  const def = defaultSettings.appearance;
  return (
    appearance.theme === def.theme &&
    clampContrast(appearance.contrast?.light, 'light') === def.contrast.light &&
    clampContrast(appearance.contrast?.dark, 'dark') === def.contrast.dark &&
    appearance.maxWidth === def.maxWidth &&
    appearance.usePointerCursors === def.usePointerCursors &&
    activeTranslucency(appearance.translucentSidebar, false) === def.translucentSidebar.light &&
    activeTranslucency(appearance.translucentSidebar, true) === def.translucentSidebar.dark &&
    appearance.motion === def.motion &&
    appearance.uiFontSize === def.uiFontSize &&
    appearance.codeFontSize === def.codeFontSize &&
    (appearance.serifFont ?? SYSTEM_DEFAULT_FONT) === def.serifFont &&
    appearance.transcriptTextSize === def.transcriptTextSize &&
    appearance.transcriptView === def.transcriptView &&
    appearance.fontSmoothing === def.fontSmoothing &&
    isDefaultChromeFonts(appearance.fonts) &&
    isDefaultChromeTheme(appearance.lightChromeTheme) &&
    isDefaultChromeTheme(appearance.darkChromeTheme)
  );
}
