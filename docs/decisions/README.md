# Decision Logs

This directory stores short decision records for non-trivial product and
harness changes.

The goal is not to create heavy process. The goal is to avoid re-litigating the
same design choices from scattered chat history or code archaeology.

## When To Add A Decision Log

Add a log when a change affects:

- harness structure
- product defaults
- runtime diagnostics
- long-running session continuity
- backward compatibility or migration rules

## Format

Each record should stay short and answer:

- what changed
- why it changed
- what alternatives were rejected
- what follow-up constraints now exist

## Naming

Use a stable numeric prefix:

- `0001-...`
- `0002-...`

Keep titles concrete and scoped.
