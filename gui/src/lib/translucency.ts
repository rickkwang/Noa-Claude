import type { AppSettings } from '../types';

/** Whether the native material should show behind the sidebar. Stored per variant, like the other theme colours. */
export function activeTranslucency(value: AppSettings['appearance']['translucentSidebar'] | undefined, isDark: boolean): boolean {
  return Boolean(isDark ? value?.dark : value?.light);
}

/** The desktop shell reports whether the platform can render a window material at all. */
export function supportsSidebarTranslucency(): boolean {
  return window.noaDesktop?.appearance?.supportsSidebarTranslucency === true;
}
