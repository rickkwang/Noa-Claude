import type { AppState, AppStateStore } from './AppStateStore.js'

export type { AppState, AppStateStore } from './AppStateStore.js'

export function useAppState<T>(selector: (state: AppState) => T): T
export function useSetAppState(): AppStateStore['setState']
export function useAppStateStore(): AppStateStore
export function useAppStateMaybeOutsideOfProvider<T>(
  selector: (state: AppState) => T,
): T | undefined
