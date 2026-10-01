import type { Attachment } from '../../utils/attachments.js'

// Inert stand-in: remote skill search is absent from this fork, but
// EXPERIMENTAL_SKILL_SEARCH still builds, so every function the gated call
// sites in query.ts and utils/attachments.ts reach must exist here.
export const getTurnZeroSkillDiscovery = async (
  ..._args: unknown[]
): Promise<Attachment[] | null> => null

// Returns the pending handle the query loop later awaits; null means nothing
// was started and collectSkillDiscoveryPrefetch is never called.
export const startSkillDiscoveryPrefetch = (
  ..._args: unknown[]
): Promise<Attachment[]> | null => null

export const collectSkillDiscoveryPrefetch = async (
  pending: Promise<Attachment[]>,
): Promise<Attachment[]> => pending
