import { describe, expect, test } from 'bun:test'
import {
  getDiscoveredRemoteSkill,
  stripCanonicalPrefix,
} from '../../../services/skillSearch/remoteSkillState.js'

describe('remote skill state stub', () => {
  test('does not classify local skill names as remote canonical skills', () => {
    expect(stripCanonicalPrefix('imagegen')).toBeNull()
    expect(stripCanonicalPrefix('brainstorming')).toBeNull()
  })

  test('does not expose discovered remote skills in this build', () => {
    expect(stripCanonicalPrefix('_canonical_example')).toBeNull()
    expect(getDiscoveredRemoteSkill('example')).toBeUndefined()
  })
})
