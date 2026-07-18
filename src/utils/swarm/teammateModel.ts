// @ts-nocheck
import { getDefaultOpusModel, getMainLoopModel } from '../model/model.js'
import { getAPIProvider, isDirectFirstParty } from '../model/providers.js'

// When the user has never set teammateDefaultModel in /config, new teammates
// follow the same provider-aware Opus default as the main loop. This keeps
// Bedrock/Vertex/Foundry on the repository's deliberate 3P lag policy.
export function getDefaultTeammateModelFallback(): string {
  if (process.env.ANTHROPIC_DEFAULT_OPUS_MODEL) {
    return getDefaultOpusModel()
  }
  const provider = getAPIProvider()
  if (
    provider === 'openaiCompatible' ||
    (provider === 'firstParty' && !isDirectFirstParty())
  ) {
    return getMainLoopModel()
  }
  return getDefaultOpusModel()
}
