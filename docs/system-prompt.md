# System prompt length

Newer Claude models (Opus 5/5.5, Fable 5/5.1, Mythos 5/5.1, and later) are trained on most of what a long system prompt spells out, so they get a compact prompt head and short tool descriptions. The replaced static head is roughly 90% shorter; total request savings vary with session-specific guidance and the active tool set. Older models (Sonnet, Haiku, Opus 4.7 and earlier, Claude 3.x) keep the long version, which they still need. The choice is automatic; nothing to configure.

**One case needs opting in.** The model id alone decides this, so it only works when that id is trustworthy. On customer-run Bedrock, Vertex or Foundry — and on Anthropic-compatible third-party endpoints — a configured id can be an inference profile, a custom ARN, a cross-region alias, or a proxy serving something else entirely, so those deployments keep the long prompt by default even when the id looks like a current Claude model.

If you know your deployment genuinely serves one, opt in by declaring the capability alongside the pin:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL='us.anthropic.claude-opus-5-5'
export ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES='lean_prompt'
```

`ANTHROPIC_DEFAULT_FABLE_MODEL`, `_OPUS_MODEL`, `_SONNET_MODEL`, `_HAIKU_MODEL`, and `ANTHROPIC_CUSTOM_MODEL_OPTION` each have the same capability pair. The `[1m]` context-window suffix is ignored when matching, so pinning either form covers both.

A second capability, `opus_5_prompt_bundle`, selects the companion sections that travel with the compact head (delivering-work, corrections, the shorter action-caution wording, one Bash bullet). It is deliberately not implied by `lean_prompt`: upstream declares it for Opus 5 only, so Opus 5.5, Fable 5/5.1, Opus 4.8 and Mythos 5/5.1 take the compact head *without* those sections. Declare it only if your pin genuinely serves Opus 5:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES='lean_prompt,opus_5_prompt_bundle'
```

First-party models need no configuration either way. For a pinned third-party model, the declaration is authoritative — a pin that lists `lean_prompt` alone gets the compact head without the bundle, even if the id looks like Opus 5, on the same reasoning that makes the pin necessary in the first place. The same rule covers EAP-looking ids and the Fable/Mythos companion section: third-party routes do not inherit those behaviors from the model name alone.

Advanced deployments that deliberately preserve Claude Code's model-name trust semantics can set `NOA_CLAUDE_THIRD_PARTY_PROMPT_POLICY=upstream`. In that mode EAP suffixes and built-in Opus/Fable/Mythos capability facts apply on third-party routes exactly as they do upstream. The default remains conservative.

To force the choice either way — for example to check whether a regression is prompt-related — set `NOA_CLAUDE_SIMPLE_SYSTEM_PROMPT=1` (compact) or `=0` (long).
