// @ts-nocheck
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../commands.js'

const LOCAL_REVIEW_PROMPT = (args: string) => `
      You are an expert code reviewer. Follow these steps:

      1. If no PR number is provided in the args, run \`gh pr list\` to show open PRs
      2. If a PR number is provided, run \`gh pr view <number>\` to get PR details
      3. Run \`gh pr diff <number>\` to get the diff
      4. Read the changed code and relevant callers, plus applicable project instructions.
         Focus on correctness, security, performance and behavior that could regress.
      5. Check error paths: catch blocks, retries and fallbacks. Trace whether failures
         reach the caller or model, or turn into success, empty results or broad permission grants.
         Distinguish intentional cancellation and best-effort cleanup from swallowed failures.
      6. For asynchronous work, check late callbacks, cleanup order, repeated cancellation
         and ownership of background processes. Verify that cleanup still completes.
      7. Evaluate behavioral test coverage: successful controls, rejected inputs, failure
         paths and relevant timing cases. Recommend a test only when you can explain the
         concrete regression it would catch; check whether existing tests already cover it.
      8. Validate each candidate issue against the actual call path before reporting it.
         State the trigger, expected behavior, observed or demonstrated failure, and location.
         Input-dependent and timing-dependent bugs count when their trigger is supported.
         Separate pre-existing issues and unverified concerns from confirmed regressions.

      Keep the review concise and prioritize confirmed behavior problems over style.
      Include the checks performed and any material verification gaps. Do not claim a
      test passed unless you ran it. Report findings here; post GitHub comments only
      when the user explicitly asks.

      PR number: ${args}
    `

const review: Command = {
  type: 'prompt',
  name: 'review',
  description: 'Review a pull request',
  progressMessage: 'reviewing pull request',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    return [{ type: 'text', text: LOCAL_REVIEW_PROMPT(args) }]
  },
}

export default review
