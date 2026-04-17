# OpenClaude Comparison (2026-04)

## Scope

This note compares recent `Gitlawb/openclaude` updates against Noa Claude and records what we adopted in this cycle.

## Portable Changes Checklist

| Topic | Trigger Condition | Expected Behavior | Risk |
| --- | --- | --- | --- |
| OpenAI/Azure max token mapping | OpenAI-compatible mode with Azure deployments | Use `max_completion_tokens` for Azure OpenAI chat-completions requests | Provider-specific regressions if endpoint detection is wrong |
| Interactive startup key verification | OpenAI-compatible mode enabled | Skip Anthropic API-key verification path to avoid false startup errors | Could mask issues that only appear at first real request |
| Placeholder key guardrail | OpenAI-compatible mode with obvious placeholder key on non-local endpoint | Fail early with actionable error before request loop | False positives for uncommon valid keys equal to placeholder words |
| Startup error observability | Background startup migration failure | Keep startup non-blocking but emit debug log for diagnostics | Slightly noisier debug logs |

## Decision Matrix

| Item | Decision | Evidence | Reason |
| --- | --- | --- | --- |
| Azure/OpenAI token-parameter compatibility | Adopted | `openaiShim.ts` mapping change | High-impact interoperability issue |
| Gemini auth dummy/invalid key boundary handling | Partially adopted | OpenAI-compatible startup verification + placeholder key guard | We improved startup/auth clarity without overfitting to one provider quirk |
| Interactive startup robustness | Adopted | Startup migration failure now logged, not silently swallowed | Improves diagnosability with minimal behavior change |
| Buddy UX updates | Deferred | No product requirement in this cycle | Out of scope for compatibility-first pass |
| Windows installer/distribution changes | Not adopted | No release-pipeline requirement in this cycle | Distribution concern, not runtime compatibility |

## Residual Risks

- Provider-side compatibility can still vary for non-Azure OpenAI-compatible gateways that reject either token field.
- Placeholder detection is intentionally conservative and only catches obvious template values.
- OpenAI-compatible credential validity remains request-time validated (not preflighted against provider APIs).
