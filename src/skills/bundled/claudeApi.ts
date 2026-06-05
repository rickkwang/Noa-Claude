// @ts-nocheck
import { readdir } from 'fs/promises'
import { getCwd } from '../../utils/cwd.js'
import { registerBundledSkill } from '../bundledSkills.js'

// claudeApiContent.js bundles ~250KB of .md strings. Lazy-load inside
// getPromptForCommand / files so they only enter memory when /claude-api is invoked.
type SkillContent = typeof import('./claudeApiContent.js')

type DetectedLanguage =
  | 'python'
  | 'typescript'
  | 'java'
  | 'go'
  | 'ruby'
  | 'csharp'
  | 'php'
  | 'curl'

const LANGUAGE_INDICATORS: Record<DetectedLanguage, string[]> = {
  python: ['.py', 'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  typescript: ['.ts', '.tsx', 'tsconfig.json', 'package.json'],
  java: ['.java', 'pom.xml', 'build.gradle'],
  go: ['.go', 'go.mod'],
  ruby: ['.rb', 'Gemfile'],
  csharp: ['.cs', '.csproj'],
  php: ['.php', 'composer.json'],
  curl: [],
}

async function detectLanguage(): Promise<DetectedLanguage | null> {
  const cwd = getCwd()
  let entries: string[]
  try {
    entries = await readdir(cwd)
  } catch {
    return null
  }

  for (const [lang, indicators] of Object.entries(LANGUAGE_INDICATORS) as [
    DetectedLanguage,
    string[],
  ][]) {
    if (indicators.length === 0) continue
    for (const indicator of indicators) {
      if (indicator.startsWith('.')) {
        if (entries.some(e => e.endsWith(indicator))) return lang
      } else {
        if (entries.includes(indicator)) return lang
      }
    }
  }
  return null
}

// Core shared docs that are small and high-frequency enough to inline on every
// invocation. Larger/lower-frequency docs (managed-agents*, model-migration,
// agent-design, anthropic-cli, claude-platform-on-aws) are NOT inlined — they
// are extracted to the skill's base directory and Read on demand.
const INLINE_SHARED: ReadonlySet<string> = new Set([
  'shared/models.md',
  'shared/error-codes.md',
  'shared/prompt-caching.md',
  'shared/tool-use-concepts.md',
  'shared/live-sources.md',
])

// Files inlined for a detected language: that language's core claude-api docs
// plus the core shared docs above. Everything else is reachable via Read from
// the base directory.
function getInlineFilesForLanguage(
  lang: DetectedLanguage,
  content: SkillContent,
): string[] {
  return Object.keys(content.SKILL_FILES).filter(
    path => path.startsWith(`${lang}/claude-api/`) || INLINE_SHARED.has(path),
  )
}

function processContent(md: string, content: SkillContent): string {
  // Strip HTML comments. Loop to handle nested comments.
  let out = md
  let prev
  do {
    prev = out
    out = out.replace(/<!--[\s\S]*?-->\n?/g, '')
  } while (out !== prev)

  out = out.replace(
    /\{\{(\w+)\}\}/g,
    (match, key: string) =>
      (content.SKILL_MODEL_VARS as Record<string, string>)[key] ?? match,
  )
  return out
}

function buildInlineReference(
  filePaths: string[],
  content: SkillContent,
): string {
  const sections: string[] = []
  for (const filePath of filePaths.sort()) {
    const md = content.SKILL_FILES[filePath]
    if (!md) continue
    sections.push(
      `<doc path="${filePath}">\n${processContent(md, content).trim()}\n</doc>`,
    )
  }
  return sections.join('\n\n')
}

const INLINE_READING_GUIDE = `## Reference Documentation

Core docs for your detected language are inlined below in \`<doc>\` tags (each tag's \`path\` attribute shows its original file path). The **full documentation library** lives under the skill's base directory (shown at the very top of this prompt) — use the Read tool to open any path below on demand. Inlined docs are also on disk, so you can Read them too if you need the untrimmed file.

### Quick Task Reference

**Single text classification/summarization/extraction/Q&A:**
→ \`{lang}/claude-api/README.md\` (inlined)

**Chat UI or real-time response display:**
→ \`{lang}/claude-api/README.md\` + \`{lang}/claude-api/streaming.md\` (inlined)

**Long-running conversations (may exceed context window):**
→ \`{lang}/claude-api/README.md\` — see Compaction section (inlined)

**Prompt caching / optimize caching / "why is my cache hit rate low":**
→ \`shared/prompt-caching.md\` + \`{lang}/claude-api/README.md\` (Prompt Caching section) (inlined)

**Function calling / tool use / custom agents:**
→ \`{lang}/claude-api/README.md\` + \`shared/tool-use-concepts.md\` + \`{lang}/claude-api/tool-use.md\` (inlined)

**Batch processing (non-latency-sensitive):**
→ \`{lang}/claude-api/README.md\` + \`{lang}/claude-api/batches.md\` (inlined)

**File uploads across multiple requests:**
→ \`{lang}/claude-api/README.md\` + \`{lang}/claude-api/files-api.md\` (inlined)

**Server-managed stateful agents with a hosted workspace (Managed Agents):**
→ Read \`shared/managed-agents-overview.md\` and \`shared/managed-agents-core.md\` first, then the relevant \`shared/managed-agents-*.md\` concept files (events, environments, tools, memory, multiagent, webhooks, outcomes, self-hosted-sandboxes, api-reference, client-patterns). Language-specific code: \`python/managed-agents/README.md\`, \`typescript/managed-agents/README.md\`, or \`curl/managed-agents.md\` for the wire-level reference. Onboarding flow: \`shared/managed-agents-onboarding.md\`.

**Designing an agent (whether/when to build one):**
→ Read \`shared/agent-design.md\`

**Migrating existing code to a newer Claude model:**
→ Read \`shared/model-migration.md\`

**Provisioning agents/environments from YAML (Anthropic CLI):**
→ Read \`shared/anthropic-cli.md\`

**Cloud-provider availability (AWS / Bedrock / Vertex / Foundry):**
→ Read \`shared/claude-platform-on-aws.md\`

**Error handling:**
→ \`shared/error-codes.md\` (inlined)

**Latest docs via WebFetch:**
→ \`shared/live-sources.md\` (inlined)`

function buildPrompt(
  lang: DetectedLanguage | null,
  args: string,
  content: SkillContent,
): string {
  // Take the SKILL.md content up to the "Reading Guide" section
  const cleanPrompt = processContent(content.SKILL_PROMPT, content)
  const readingGuideIdx = cleanPrompt.indexOf('## Reading Guide')
  const basePrompt =
    readingGuideIdx !== -1
      ? cleanPrompt.slice(0, readingGuideIdx).trimEnd()
      : cleanPrompt

  const parts: string[] = [basePrompt]

  if (lang) {
    const filePaths = getInlineFilesForLanguage(lang, content)
    parts.push(INLINE_READING_GUIDE.replace(/\{lang\}/g, lang))
    parts.push(
      '---\n\n## Included Documentation\n\n' +
        buildInlineReference(filePaths, content),
    )
  } else {
    // No language detected — inline only core shared docs and let the model
    // ask, then Read the language-specific docs from the base directory.
    parts.push(INLINE_READING_GUIDE.replace(/\{lang\}/g, 'unknown'))
    parts.push(
      'No project language was auto-detected. Ask the user which language they are using, then Read the matching docs (e.g. `python/claude-api/README.md`) from the base directory.',
    )
    const sharedOnly = Object.keys(content.SKILL_FILES).filter(p =>
      INLINE_SHARED.has(p),
    )
    parts.push(
      '---\n\n## Included Documentation\n\n' +
        buildInlineReference(sharedOnly, content),
    )
  }

  // Preserve the "When to Use WebFetch" and "Common Pitfalls" sections
  const webFetchIdx = cleanPrompt.indexOf('## When to Use WebFetch')
  if (webFetchIdx !== -1) {
    parts.push(cleanPrompt.slice(webFetchIdx).trimEnd())
  }

  if (args) {
    parts.push(`## User Request\n\n${args}`)
  }

  return parts.join('\n\n')
}

export function registerClaudeApiSkill(): void {
  registerBundledSkill({
    name: 'claude-api',
    description:
      'Build apps with the Claude API or Anthropic SDK.\n' +
      'TRIGGER when: code imports `anthropic`/`@anthropic-ai/sdk`/`claude_agent_sdk`, or user asks to use Claude API, Anthropic SDKs, or Agent SDK.\n' +
      'DO NOT TRIGGER when: code imports `openai`/other AI SDK, general programming, or ML/data-science tasks.',
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch'],
    userInvocable: true,
    // Extract the full doc library to disk (with {{VAR}} substituted) so the
    // model can Read any file on demand. Lazy thunk keeps the ~250KB bundle out
    // of memory until first invocation. registerBundledSkill prepends a
    // "Base directory for this skill: <dir>" line to the prompt.
    files: async () => {
      const content = await import('./claudeApiContent.js')
      const out: Record<string, string> = {}
      for (const [path, md] of Object.entries(content.SKILL_FILES)) {
        out[path] = processContent(md, content)
      }
      return out
    },
    async getPromptForCommand(args) {
      const content = await import('./claudeApiContent.js')
      const lang = await detectLanguage()
      const prompt = buildPrompt(lang, args, content)
      return [{ type: 'text', text: prompt }]
    },
  })
}
