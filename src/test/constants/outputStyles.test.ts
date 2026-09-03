import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { buildDynamicSystemPromptSections } from '../../constants/systemPromptAssemblyHelpers.js'
import {
  clearSystemPromptSectionCache,
  resolveSystemPromptSections,
} from '../../constants/systemPromptSections.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  OUTPUT_STYLE_CONFIG,
} from '../../constants/outputStyles.js'
import { getOutputStyleSection } from '../../constants/systemPromptDynamicSections.js'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

describe('Proactive output style', () => {
  const proactive = OUTPUT_STYLE_CONFIG.Proactive

  test('is registered as a built-in style', () => {
    expect(proactive).toBeTruthy()
    expect(proactive?.source).toBe('built-in')
    expect(proactive?.name).toBe('Proactive')
    expect(proactive?.keepCodingInstructions).toBe(true)
  })

  // Verbatim port from upstream Claude Code 2.1.237 (`Oke.Proactive`). Same
  // rule as below: a digest failure means the port was reworded, so re-verify
  // upstream rather than refreshing the digest.
  test('prompt matches the pinned upstream port', () => {
    expect(sha256(proactive!.prompt)).toBe(
      'a8402e1396f828e5c86faad0ae6aa7790379c007475a412084dcabba1d236ac8',
    )
  })

  test('turn reminder matches the pinned upstream port', () => {
    expect(sha256(proactive!.turnReminder!)).toBe(
      '35d4cfdfe7e68d2f56f2ab08cf25a2edbde2803fa171504deb234b2696f9f8c0',
    )
  })

  // The two safety rails are what keep "execute immediately" from reading as a
  // license to delete data or leak secrets. Autonomy wording may be rephrased;
  // these two must survive.
  test('prompt keeps the destructive-action and exfiltration rails', () => {
    expect(proactive!.prompt).toContain(
      '5. **Do not take overly destructive actions**',
    )
    expect(proactive!.prompt).toContain('6. **Avoid data exfiltration**')
  })
})

describe('Concise output style', () => {
  const concise = OUTPUT_STYLE_CONFIG.Concise

  test('is registered as a built-in style', () => {
    expect(concise).toBeTruthy()
    expect(concise?.source).toBe('built-in')
    expect(concise?.name).toBe('Concise')
    expect(concise?.keepCodingInstructions).toBe(true)
  })

  // Verbatim port from upstream Claude Code 2.1.237 (`Oke.Concise`). A digest
  // failure means someone reworded the port: re-verify against upstream and
  // update the digest, never the other way round.
  test('prompt matches the pinned upstream port', () => {
    expect(sha256(concise!.prompt)).toBe(
      'd161e375b32fbd0396ba8110b735f8099e7aa7f72dff40e82ad3b503e467054a',
    )
  })

  test('turn reminder matches the pinned upstream port', () => {
    expect(sha256(concise!.turnReminder!)).toBe(
      '830941eabb16069c8f1984bcbd09049b29a9d3276b5389d9f3d28d227c60a8f9',
    )
  })

  test('prompt carries the style header and the six numbered rules', () => {
    expect(concise!.prompt).toContain('# Concise Style Active')
    for (const rule of [
      '1. **Lead with the result**',
      '2. **Cut narration, keep substance**',
      '3. **Short by default**',
      '4. **State things plainly**',
      '5. **Give full detail on request**',
      '6. **Never trade correctness for brevity**',
    ]) {
      expect(concise!.prompt).toContain(rule)
    }
  })
})

describe('the output_style prompt section cache key', () => {
  // resolveSystemPromptSections memoizes on the section name and only clears on
  // /clear or /compact. Before the name carried the style, switching styles
  // mid-session left the first turn's section cached: switching away from
  // `default` kept the section absent while the per-turn reminder already
  // announced the style, so the model was told to follow guidelines it had
  // never been sent.
  function sectionName(
    outputStyleConfig: { name: string; prompt: string } | null,
  ): string {
    const sections = buildDynamicSystemPromptSections({
      enabledTools: new Set(['Bash']),
      skillToolCommands: [],
      model: 'claude-opus-4-1-20250805',
      outputStyleConfig,
    })
    const section = sections.find(s => s.name.startsWith('output_style'))
    expect(section).toBeTruthy()
    return section!.name
  }

  test('names the active style, so a switch misses the previous entry', () => {
    const none = sectionName(null)
    const concise = sectionName(OUTPUT_STYLE_CONFIG.Concise!)
    const proactive = sectionName(OUTPUT_STYLE_CONFIG.Proactive!)

    expect(none).toBe(`output_style:${DEFAULT_OUTPUT_STYLE_NAME}`)
    expect(concise).toBe('output_style:Concise')
    expect(proactive).toBe('output_style:Proactive')
    expect(new Set([none, concise, proactive]).size).toBe(3)
  })

  test('is stable for the same style', () => {
    expect(sectionName(OUTPUT_STYLE_CONFIG.Concise!)).toBe(
      sectionName(OUTPUT_STYLE_CONFIG.Concise!),
    )
  })
})

describe('the built-in style roster', () => {
  // Tripwire, not decoration: every built-in style name also has to appear in
  // FOREGROUND_529_RETRY_SOURCES (src/services/api/withRetry.ts) as
  // `repl_main_thread:outputStyle:<name>`, or sessions on that style silently
  // lose 529 retries. That module cannot be imported here (it calls feature(),
  // a build-time rewrite), so this pins the roster instead: if you add a style
  // and this fails, update the retry allowlist in the same change.
  test('is exactly default plus the four upstream styles', () => {
    expect(Object.keys(OUTPUT_STYLE_CONFIG)).toEqual([
      DEFAULT_OUTPUT_STYLE_NAME,
      'Proactive',
      'Concise',
      'Explanatory',
      'Learning',
    ])
  })
})

describe('the output style precedence clause', () => {
  test('is appended to styles that do not carry their own', () => {
    const section = getOutputStyleSection(OUTPUT_STYLE_CONFIG.Explanatory!)
    expect(section).toContain('# Output Style: Explanatory')
    expect(section).toContain('these rules win')
  })

  test('is not duplicated for styles that already carry it', () => {
    const section = getOutputStyleSection(OUTPUT_STYLE_CONFIG.Concise!)!
    expect(section.split('these rules win').length - 1).toBe(1)
  })
})

describe('resolving the output_style section across a mid-session switch', () => {
  // The behavioral half of the cache-key fix: the names differing is the
  // mechanism, this is the symptom it prevents. Exercises the real memo, so it
  // resolves only the output_style descriptor — resolving the whole set would
  // compute memory/env sections that read the filesystem.
  async function resolveOutputStyleSection(
    outputStyleConfig: { name: string; prompt: string } | null,
  ): Promise<string | null> {
    const sections = buildDynamicSystemPromptSections({
      enabledTools: new Set(['Bash']),
      skillToolCommands: [],
      model: 'claude-opus-4-1-20250805',
      outputStyleConfig,
    }).filter(s => s.name.startsWith('output_style'))
    const [text] = await resolveSystemPromptSections(sections)
    return text ?? null
  }

  test('a switch away from default stops serving the cached empty section', async () => {
    clearSystemPromptSectionCache()
    try {
      // Turn 1 on the default style: no section, and that null gets cached.
      expect(await resolveOutputStyleSection(null)).toBeNull()

      // Turn 2 after /config switches to Concise. Keyed on the bare name this
      // returned the cached null, leaving the per-turn reminder pointing at
      // guidelines that were never sent.
      const concise = await resolveOutputStyleSection(
        OUTPUT_STYLE_CONFIG.Concise!,
      )
      expect(concise).toContain('# Output Style: Concise')
      expect(concise).toContain('# Concise Style Active')

      // And on to a third style, then back to default.
      const proactive = await resolveOutputStyleSection(
        OUTPUT_STYLE_CONFIG.Proactive!,
      )
      expect(proactive).toContain('# Output Style: Proactive')
      expect(await resolveOutputStyleSection(null)).toBeNull()
    } finally {
      clearSystemPromptSectionCache()
    }
  })
})
