// No-op stub, same pattern as featureCheck.ts (isSkillSearchEnabled() is
// hardwired false in this distribution): SkillTool.ts requires this module
// under feature('EXPERIMENTAL_SKILL_SEARCH'), so it must resolve at bundle
// time, but every call site is additionally behind a USER_TYPE === 'ant'
// runtime guard (inlined to 'external' by build.ts) — local skill search
// (localSearch.ts, prefetch.ts) is unaffected.
//
// Upstream contract: returns the slug for `_canonical_<slug>` names, null
// otherwise — SkillTool.ts call sites branch on `slug !== null`. Always null
// here (no remote skills exist in this build); returning the name unchanged
// would instead route every skill through the remote path if the guard were
// ever satisfied (auto-allowing it in checkPermissions, then failing
// validateInput with "not discovered").
export function stripCanonicalPrefix(_name: string): string | null {
  return null
}

export function getDiscoveredRemoteSkill(
  _slug: string,
): { url: string } | undefined {
  return undefined
}
