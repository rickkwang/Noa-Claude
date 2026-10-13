# Lean vs verbose prompt

`shouldUseCompactSystemPrompt(model)` in `src/constants/systemPromptCompact.ts` picks the compact prompt head + short tool descriptions (newer models) or the long ones (older models still need them).

- Most lean-branch text is a verbatim port of the upstream binary; `verify:ports` byte-diffs each port (listed in `src/test/constants/portedPromptRegistry.ts`) against the installed upstream binary. Re-verify any change to ported text.
- Intentional deviations are commented at their definition (`src/constants/systemPromptDynamicSections.ts`, `src/tools/AgentTool/prompt.ts`, `src/constants/systemPromptCompact.ts`) — keep them.
- Only `firstParty` is a trusted model identity. Bedrock/Vertex/Foundry and Anthropic-compatible third parties keep the verbose prompt and other first-party-only relaxations (e.g. `NOA_CLAUDE_WRITE_REQUIRE_READ`), since a configured id (inference profile, ARN, alias, proxy) proves nothing about the model. Opt in via `lean_prompt` in `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES`.
- `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1|0` forces either mode without a rebuild (bisect lean-prompt regressions).
