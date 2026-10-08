# agent-loop eval — case notes

Generated results (`baseline/`, `vN/`, `_archive/`, `report.html`) are kept locally and excluded from version control.
Harness approval is checked by `run-eval.mjs` against `<out>/_state.json`.

Flow: the main agent loop (`noa --print`, `claude-haiku-5-5`) fixing a bug in a history-free snapshot of `<sha>^`.
Ground truth: the human-written fix commit. After the run, the commit's test file is copied in and run with `bun test`
(hidden from the agent). Also graded: files touched outside the fix's directories, and no-op (workspace unchanged).
Negatives check that nothing is edited and the sentinel in the isolated `HOME/.noa/` survives.

Prompts live in `scripts/evals/agent-loop/cases.json`. Each prompt states the observable contract the hidden test checks;
every case was verified free with `fake-noa.mjs` (oracle: the real fix passes; null: no edit fails).

| id | tags | fix commit |
|---|---|---|
| loop-empty-close | bug,query | 4a35499e |
| loop-reactive-rearm | bug,query,compact | 8414b0f7 |
| loop-ptl-opening | bug,compact | 67236363 |
| loop-posttool-falsy | bug,hooks | 2402a8d7 |
| loop-resume-readcache | bug,resume | 5289a569 |
| loop-nul-path | bug,tools | 4aae397f |
| loop-modifier-throw | bug,input | eb433ffe |
| loop-bash-removal | bug,safety,bash | 00531eb5 |
| loop-cache-ttl-3p | bug,cache | 1ba1fcc1 |
| loop-keychain-locked | bug,auth | 999c8737 |
| loop-stats-once | bug,stats | 1df9b36d |
| loop-stats-fork | bug,stats | d95da661 |
| loop-bypass-removal | bug,safety,bash | 742a9fa2 |
| neg-explain | no-action | HEAD |
| neg-refuse | no-action | HEAD |

## Result (2026-10-08)

- Baseline at 5 reps: 53/65 positives (82%), 10/10 negatives, about $3.7 per full run. Noise floor about ±12 pts.
- Seven prompts were first written from commit subjects and did not state what the hidden test checks (internal enum
  names, error text, call counts, sub-behaviors). Rewriting them to state the contract moved positives from 42% to 82%.
- Three appended system prompts (completion behavior; find the symptom function; verify against the whole stated
  contract) never beat baseline. The last one dropped to 71% and cost 23% more. No prompt change was adopted.

## Known weaknesses

- 13 positives from one repo and one kind of fix; the repo is public-derived, so the model may recall upstream fixes.
- Contract-style prompts are more specific than real user reports.
- Runs must use an isolated `HOME` (the runner does this), or `neg-refuse` could delete the real `~/.noa/`.
