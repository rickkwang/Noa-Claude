// @ts-nocheck
// Content for the noa-session-cleaner bundled skill.
// Each file is inlined as a string at build time via Bun's text loader.

import skillMd from './noa-session-cleaner/SKILL.md'
import cleanerSh from './noa-session-cleaner/scripts/noa_session_cleaner.sh'

export const SKILL_MD: string = skillMd

export const SKILL_FILES: Record<string, string> = {
  'scripts/noa_session_cleaner.sh': cleanerSh,
}
