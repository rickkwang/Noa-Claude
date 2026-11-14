# Lean vs verbose prompt

`shouldUseCompactSystemPrompt(model)` in `src/constants/systemPromptCompact.ts` picks the compact prompt head + short tool descriptions (newer models) or the long ones (older models still need them).

- Most lean-branch text is a verbatim port of the upstream binary; `verify:ports` byte-diffs each port (listed in `src/test/constants/portedPromptRegistry.ts`) against the installed upstream binary. Re-verify any change to ported text.
- Intentional deviations are commented at their definition (`src/constants/systemPromptDynamicSections.ts`, `src/tools/AgentTool/prompt.ts`, `src/constants/systemPromptCompact.ts`) — keep them.
- Only `firstParty` is a trusted model identity. Bedrock/Vertex/Foundry and Anthropic-compatible third parties keep the verbose prompt and other first-party-only relaxations (e.g. `NOA_CLAUDE_WRITE_REQUIRE_READ`), since a configured id (inference profile, ARN, alias, proxy) proves nothing about the model. Opt in via `lean_prompt` in `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES`.
- `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1|0` forces either mode without a rebuild (bisect lean-prompt regressions).

## Deliberate deviations from upstream

Everything else in the lean and verbose prompts is meant to match the installed upstream binary (`verify:ports` checks the ports, the verbose memory prompt and every tool description). These differences are on purpose:

- Environment section: no "most recent Claude models" / fast-mode lines, and "available as a CLI in the terminal" only. Third-party models must not be told they are Claude (`src/test/constants/prompts.test.ts` asserts this).
- Not ported because upstream gates them on GrowthBook, which Noa does not fetch: the `<pasted_content>` Harness bullet and `user_privacy`. `task_continuity` is dead upstream (its predicate returns false) and `leanRewrite` is off for every catalog model.
- Noa-only tools and parameters, so their descriptions have no upstream text: `SendMessage` (continues subagents without agent teams), `EnterWorktree` `path`, `ExitWorktree`.
- Verbose `WebSearch`: softer Sources rule, and "US-only" only when Anthropic's search backs the call.
- Fable identity is limited to the known `claude-fable-5` / `-5-1` / `-5-2`; upstream also skips models whose catalog status is "described", which Noa cannot read.
- Brand and path renames (`Noa Claude`, `.noa/`); `verify:ports` maps them back before diffing.

