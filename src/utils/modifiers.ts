// @ts-nocheck
export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

/**
 * No-op: no native modifier-key inspection module is shipped in this build.
 */
export function prewarmModifiers(): void {}

/**
 * Always returns false because no native modifier-key module is shipped.
 */
export function isModifierPressed(_modifier: ModifierKey): boolean {
  return false
}
