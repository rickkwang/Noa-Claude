# Auto Mode Classifier — Design

## Problem

Shift+Tab in official Claude Code cycles `default → acceptEdits → plan → bypassPermissions → auto → default`. noa already ported this entire state machine faithfully — keybinding, cycle order, the 800ms-debounced opt-in dialog, denial tracking, settings schema, telemetry call sites, and a complete classifier-calling pipeline (`src/utils/permissions/yoloClassifier.ts`, tool-based + 2-stage XML variant) — all gated behind `feature('TRANSCRIPT_CLASSIFIER')`, which is hardcoded `false` in every build. `FEATURES.md`/`CLAUDE.md` document this as intentionally inert because "modules absent from this fork" would fail bundle resolution.

Investigation in this session found the gap is narrower than that description: the classifier *logic* is fully implemented and wired into `permissions.ts:694`. The only things actually missing are two `require()`d prompt text files:

- `src/utils/permissions/yolo-classifier-prompts/auto_mode_system_prompt.txt`
- `src/utils/permissions/yolo-classifier-prompts/permissions_external.txt`

(A third, `permissions_anthropic.txt`, only loads when `process.env.USER_TYPE === 'ant'` — not relevant to noa's users and out of scope.)

## Goal

Write these two prompt files ourselves (not Anthropic's proprietary wording — unrecoverable from the binary, but structurally aligned with the category taxonomy and config schema we *did* recover), then unlock `TRANSCRIPT_CLASSIFIER` for the experimental build so Shift+Tab can actually reach and use `auto` mode, functioning equivalently to official Claude Code's auto mode.

## Evidence grounding the prompt content

- `settings.ts` (`getAutoModeConfig`) and the Zod schema descriptions recovered from the official binary establish four conceptual sections: `allow`, `soft_deny` ("destructive/irreversible actions user intent can clear"), `hard_deny` ("security boundaries user intent does NOT clear"), `environment`.
- noa's own `POWERSHELL_DENY_GUIDANCE` (`yoloClassifier.ts:1403-1412`) already references four category names as if they pre-exist in the base prompt: **Code from External**, **Irreversible Local Destruction**, **Unauthorized Persistence**, **Security Weaken**. The new prompt must define these categories (not invent parallel/renamed ones) so the existing PowerShell guidance strings correctly slot in when `POWERSHELL_AUTO_MODE` is also enabled.
- `yoloClassifier.ts` imposes hard format contracts we must match exactly:
  - Base prompt must contain the literal placeholder `<permissions_template>` (substituted with the external template).
  - Base prompt must end its output-format instructions with the literal line `Use the classify_result tool to report your classification.` — `replaceOutputFormatWithXml()` string-matches this exact line to swap in XML-tag instructions when the (dormant-by-default) 2-stage classifier is enabled. No extra work needed to support XML mode — reusing this exact line makes it work "for free."
  - Permissions template must contain three tag pairs: `<user_allow_rules_to_replace>`, `<user_deny_rules_to_replace>`, `<user_environment_to_replace>`, each wrapping bullet-list defaults (`- item` per line) — user settings *replace* (not append to) these defaults, per the external-template contract in `buildYoloSystemPrompt()`.
  - No `<user_hard_deny_to_replace>` tag: noa's `getAutoModeConfig()` deliberately omits `hard_deny` from user/policy-mergeable fields (unlike the official schema, which allows policy-tier overrides). This is an existing, intentional divergence we're keeping — hard_deny rules are static text in the base prompt, not configurable by any settings source.
  - Response contract for the default (non-XML) path: a `classify_result` tool call with `{ thinking: string, shouldBlock: boolean, reason: string }` (see `YOLO_CLASSIFIER_TOOL_SCHEMA`).

## Deliverables

1. **`auto_mode_system_prompt.txt`** — system prompt instructing the classifier model to evaluate the next tool call (last block of the transcript) against the embedded permissions template, output via the `classify_result` tool. Defines the four categories above (used for both soft_deny bullets — user-extendable — and hard_deny — static, non-extendable, e.g. secrets exfiltration, disabling security tooling, destructive actions outside the project directory). Contains the `<permissions_template>` placeholder and ends with the exact tool-use instruction line.
2. **`permissions_external.txt`** — the three tagged default sections (allow / soft_deny / environment) with a reasonable, conservative default rule set (e.g. allow: read-only commands, local test/build/lint runs; soft_deny: destructive filesystem/git operations, package installs, network egress; environment: none by default, user-populated).
3. **`build.ts`** — move `TRANSCRIPT_CLASSIFIER` from "referenced but omitted" into `fullExperimentalFeatures` (alphabetically between `TOKEN_BUDGET` and `TREE_SITTER_BASH`); update the comment block at the top (lines 21-32) to drop it from the "modules missing" list, leaving only `COORDINATOR_MODE` there.
4. **`FEATURES.md`** — move the `TRANSCRIPT_CLASSIFIER` entry out of "Not Unlockable in This Build" into the normal experimental-features section (documenting it now requires `--feature-set=dev-full`).
5. **`CLAUDE.md`** — update the "Feature flags" section's mention of `TRANSCRIPT_CLASSIFIER` as inert, since it's no longer accurate.

## Explicitly out of scope

- `COORDINATOR_MODE` — untouched, still inert (unrelated feature).
- `permissions_anthropic.txt` / ant-only code paths — not created; `USER_TYPE==='ant'` branches remain dead for noa's user base.
- Promoting to baseline (`defaultFeatures`) — this stays `build:dev:full`-only. It's a safety-boundary feature (decides whether tool calls execute without asking); it should not default on.
- `BASH_CLASSIFIER` content (separate flag, separately stubbed in `bashClassifier.ts` as ANT-ONLY) — not part of this work.
- Changing the existing hard_deny-not-configurable behavior — kept as-is (see above).

## Testing plan

1. `bun run typecheck` and `bun run build:dev:full` — confirms the `require()` calls resolve and nothing else breaks at bundle time.
2. `bun test` for existing classifier-related tests (if any reference `TRANSCRIPT_CLASSIFIER` or `yoloClassifier.ts`).
3. Manual run (`bun run dev` with `--feature-set=dev-full` or equivalent env): confirm Shift+Tab cycles all the way to `auto` and the opt-in dialog appears.
4. Manual adversarial check: after enabling auto mode, issue a handful of known-dangerous actions (e.g. `rm -rf` outside a scratch dir, `curl ... | bash`, writing to `~/.bashrc` / shell profile, disabling a security tool) and confirm the classifier's `shouldBlock` actually comes back `true` with a sensible `reason` — not just that the call completes.
5. Confirm a clearly-safe action (e.g. `ls`, reading a file) is allowed without unnecessary friction.

## Risks / open items

- Prompt quality is inherently approximate — we're writing original content, not Anthropic's tuned prompt. Testing step 4 above is the real acceptance bar, not just "it builds."
- The classifier makes a real API call per non-allowlisted tool call — noticeable latency/cost. This matches official behavior and isn't something to fix here.

## Explicit decision: do not copy verbatim official prompt text

Further verification against the official binary found that Bun's build inlines `.txt` files as string literals in the compiled bundle (same technique documented for noa's own `build.ts`), which means substantial verbatim fragments of Anthropic's actual `auto_mode_system_prompt.txt` are recoverable by string extraction — not just category names, but full rule paragraphs (e.g. the complete "Irreversible Local Destruction" and "Code from External" category text, output-format constraints, additional template placeholders like `<settings_deny_rules>` and `<cross_session_messages_rule>` that noa's current port doesn't have).

Decision (confirmed with the user): **do not reproduce this text verbatim.** Reusing category *names* and the overall allow/soft_deny/hard_deny/environment framing (functional facts, not creative expression) is fine and is what the earlier "Evidence" section already relies on. Copying Anthropic's actual multi-paragraph rule prose into this repo is a different act — likely a Claude Code ToS violation and a real copyright concern for a decompiled, unreleased, substantial creative/technical text — and is out of scope for this work. The two prompt files remain original writing, informed only by the taxonomy and format contract, not the official wording.
