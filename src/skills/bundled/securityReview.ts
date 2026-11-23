import { registerBundledSkill } from '../bundledSkills.js'

const SECURITY_REVIEW_DESCRIPTION =
  'Complete a security review of the pending changes on the current branch'

const SECURITY_REVIEW_PROMPT = `# Security Review of Pending Branch Changes

Perform a focused, evidence-based security audit of the pending changes on the current branch (both uncommitted changes and commits ahead of the default branch).

## Step 1: Gather the Diff

1. Run \`git status\` and inspect both unstaged/staged diffs (\`git diff\`, \`git diff --cached\`) and branch commits relative to the base branch (\`git diff $(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD~1)...HEAD\`).
2. Read the surrounding context of every security-sensitive change — do not judge from isolated diff hunks alone.

## Step 2: Audit High-Risk Security Categories

Check every changed file against these classes of vulnerability:
- **Injection**: command/shell injection (\`exec\`, \`spawn\`, template interpolation), SQL/NoSQL injection, XSS / unsafe HTML rendering, template injection, argument injection.
- **Path & File Safety**: path traversal (\`../\`), symlink escape, unsafe temp-file handling, arbitrary file read/write/delete outside intended roots.
- **Auth, Access Control & Trust Boundaries**: missing or bypassed authentication/authorization checks, privilege escalation, SSRF (fetching untrusted URLs / internal network addresses), CSRF, insecure CORS or postMessage origins.
- **Secrets & Sensitive Data**: hardcoded tokens/keys/passwords, credentials logged to stdout/stderr/files, sensitive data leaking into error messages, URLs, or telemetry.
- **Cryptography & Input Validation**: weak randomness for security tokens, broken signature/TLS verification, unsafe deserialization, prototype pollution, ReDoS, unbounded resource consumption.

## Step 3: Report Only Real, Concrete Findings

- For each finding, state: **Severity** (\`Critical\` / \`High\` / \`Medium\` / \`Low\`), **Location** (\`path:line\`), **Exploit scenario** (how an attacker reaches and triggers it), and **Concrete fix**.
- Do not pad the report with speculative or purely theoretical concerns that are already blocked by callers or runtime boundaries.
- If no security issues are found, state clearly what was reviewed and confirm no actionable vulnerabilities were identified.
`

export function registerSecurityReviewSkill(): void {
  registerBundledSkill({
    name: 'security-review',
    description: SECURITY_REVIEW_DESCRIPTION,
    userInvocable: true,
    async getPromptForCommand(args: string) {
      const parts: string[] = [SECURITY_REVIEW_PROMPT.trimEnd()]
      if (args.trim()) {
        parts.push(`## Scope / Focus\n\n${args.trim()}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}
