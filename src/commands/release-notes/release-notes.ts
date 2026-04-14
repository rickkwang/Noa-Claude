// @ts-nocheck
import type { LocalCommandResult } from '../../types/command.js'
import {
  getAllReleaseNotes,
  getStoredChangelog,
} from '../../utils/releaseNotes.js'
import { PRODUCT_RELEASE_NOTES_URL } from '../../constants/docs.js'

function formatReleaseNotes(notes: Array<[string, string[]]>): string {
  return notes
    .map(([version, notes]) => {
      const header = `Version ${version}:`
      const bulletPoints = notes.map(note => `· ${note}`).join('\n')
      return `${header}\n${bulletPoints}`
    })
    .join('\n\n')
}

export async function call(): Promise<LocalCommandResult> {
  const notes = getAllReleaseNotes(await getStoredChangelog())
  if (notes.length > 0) {
    return { type: 'text', value: formatReleaseNotes(notes) }
  }

  return {
    type: 'text',
    value: `See the bundled release notes at: ${PRODUCT_RELEASE_NOTES_URL}`,
  }
}
