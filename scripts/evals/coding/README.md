# Coding acceptance checks

Opt-in real-model checks using the active Noa provider profile. These consume
provider tokens. Each run uses a fresh temporary fixture and configuration.
The model sees the specification and public check; an independent checker
outside the fixture grades the finished code and checks that tests were not edited.

```sh
python3 scripts/evals/coding/run.py --reps 2
python3 scripts/evals/coding/run.py --entry ~/.local/bin/claude --label cc --reps 2
python3 scripts/evals/coding/run.py --goal --case merge --max-turns 16
```

Goal mode runs the real Noa QueryEngine with the existing Goal verify command.
It does not introduce a CLI flag or replace the model transport. The independent
check is available to that workflow and must remain unchanged. Ordinary mode
grades after the CLI exits. Acceptance requires correct code, successful terminal
status, and an observed public test run (or a completed Goal in Goal mode).

Results retain terminal state, tool calls, token usage, timings and fixture hashes.
Do not convert a few task successes into a general capability ranking, or compare
against earlier results after changing specifications, turn limits or models.
