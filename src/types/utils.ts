/**
 * Recursively marks all properties of `T` as readonly.
 *
 * Preserves `Map`/`Set` (as their `Readonly*` variants, which still expose
 * `.has`/`.get`/iteration) and passes functions through untouched. Used by
 * `ToolPermissionContext` and `AppState` to make state snapshots immutable to
 * consumers while keeping map lookups and callables available.
 */
export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepImmutable<U>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
      : T extends Set<infer M>
        ? ReadonlySet<DeepImmutable<M>>
        : T extends object
          ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
          : T

/**
 * Union of every ordered tuple containing each member of the string union `T`
 * exactly once. Used with `satisfies` to enforce exhaustiveness — an array
 * literal asserted `satisfies Permutations<U>` must list every member of `U`.
 */
export type Permutations<
  T extends string,
  U extends string = T,
> = [T] extends [never]
  ? []
  : T extends T
    ? [T, ...Permutations<Exclude<U, T>>]
    : never
