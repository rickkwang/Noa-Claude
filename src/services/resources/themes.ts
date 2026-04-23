// @ts-nocheck
import { THEME_NAMES, THEME_SETTINGS } from '../../utils/theme.js';

export function getThemeResources(): {
  names: readonly string[];
  settings: readonly string[];
} {
  return {
    names: THEME_NAMES,
    settings: THEME_SETTINGS,
  };
}
