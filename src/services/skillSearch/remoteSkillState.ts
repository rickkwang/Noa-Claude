// No-op stub, same pattern as featureCheck.ts (isSkillSearchEnabled() is
// hardwired false in this distribution): SkillTool.ts requires this module
// under feature('EXPERIMENTAL_SKILL_SEARCH'), so it must resolve at bundle
// time, but every call site is behind the disabled remote-skill runtime
// check — local skill search (localSearch.ts, prefetch.ts) is unaffected.
export function stripCanonicalPrefix(name: string): string {
  return name
}

export function getDiscoveredRemoteSkill(
  _slug: string,
): { url: string } | undefined {
  return undefined
}
