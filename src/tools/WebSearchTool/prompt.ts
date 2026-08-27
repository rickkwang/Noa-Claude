// @ts-nocheck
import { getLocalMonthYear } from 'src/constants/common.js'
import { shouldUseCompactSystemPrompt } from '../../constants/systemPromptCompact.js'

export const WEB_SEARCH_TOOL_NAME = 'WebSearch'

export function getWebSearchPrompt(model?: string): string {
  const currentMonthYear = getLocalMonthYear()
  if (shouldUseCompactSystemPrompt(model)) {
    // Ported verbatim from upstream's lean variant. "US-only" holds here too:
    // this tool is Anthropic's server-side web search — `web_search_20250305`,
    // or `web_search_20260209` on models that take it (see
    // modelSupportsWebSearchDynamicFiltering) — the same backend upstream
    // describes, and the two variants differ only in dynamic filtering. The
    // mandatory "Sources:" list is stricter than our verbose text, which no
    // lean model ever sees.
    return `Search the web. Returns result blocks with titles and URLs. US-only.

- The current month is ${currentMonthYear} — use this when searching for recent information.
- \`allowed_domains\` / \`blocked_domains\` filter results.
- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.`
  }
  return `
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call

Citation guidance:
  - When web results materially support your answer, cite the relevant URLs as markdown hyperlinks
  - Include a "Sources:" section when links help the user verify the answer or continue the task
  - If the answer is short and naturally includes inline links, a separate Sources section is optional
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
  - Domain filtering is supported to include or block specific websites

Query guidance:
  - The current month is ${currentMonthYear}. Use current-date terms when the user is asking about recent information, current events, release status, or other time-sensitive topics
  - Do not force the current year into evergreen documentation or stable reference searches when it would reduce result quality
  - Example: for "latest React docs", using the current year may help; for a stable API or RFC lookup, it may be unnecessary
`
}
