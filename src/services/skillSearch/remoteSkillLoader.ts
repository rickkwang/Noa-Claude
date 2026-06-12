// No-op stub — see remoteSkillState.ts for why this module exists.
// Unreachable in practice: executeRemoteSkill bails earlier because
// getDiscoveredRemoteSkill() always returns undefined.
export async function loadRemoteSkill(
  slug: string,
  _url: string,
): Promise<never> {
  throw new Error(`Remote skill loading is not available in this build: ${slug}`)
}
