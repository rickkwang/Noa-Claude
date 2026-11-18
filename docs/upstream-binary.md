# Upstream binary and model catalog

The upstream Claude Code binary lives at `~/.local/share/claude/versions/<version>` (a single Bun executable, ~200MB; a new version may land daily). It embeds the full JS bundle **uncompressed**, plus a baked model catalog. The catalog is the ground truth for checking Noa's model-capability tables, and it is newer than the cached table in the `claude-api` skill.

## Extracting the JS bundle

Scan the binary for printable byte runs of at least 100000 bytes (`9<=b<=13 or 32<=b<=126 or b>=128`) and concatenate them: about 25MB of JS.

This misses lazy-loaded and TUI chunks (paste handling, imagePaste, imageResizer, …): stray control bytes split their source into short runs that the 100KB rule drops. To recover them, take the raw buffer, replace `[\x00-\x08\x0e-\x1f\x7f]+` with a separator, then grep.

- Each chunk starts with `// @bun @bytecode` and ends with `export{...}`.
- Follow dependencies through `import{...}from"/$bunfs/root/chunk-xxx.js"`.
- Earlier hits are bytecode constant tables: strings only, no logic.

## Finding the catalog

The catalog is **not** in the large runs. Search the raw buffer for markers such as `advisor_rank`, `supports_1m_beta` and `schema_version`. The real catalog is a dense cluster of consecutive hits; scattered hits elsewhere are the code that reads it, not the data. Never hard-code offsets; they change every version.

Rough shape:

```
{schema_version, pricing_tiers, models: [{id, family, provider_ids, context,
 max_output_tokens, pricing, capabilities, advisor_rank}], aliases}
```

Field names drift between versions (for example the sub-fields of `context`). Re-read the structure on every check instead of copying names from here.

## Reading it correctly

- **Minified names are per-chunk.** The minifier reuses short identifiers (`dc`, `hg`, `Rm`, …) with different meanings in different regions, so resolve them within one region. In 2.1.319, `function dc` appears several times and points at different functions.
- **The catalog is not the only truth.** Upstream short-circuits some models by name, and `hg()` returns `true|undefined`, never `false`, so callers often fall through to a default. Reading only the `capabilities` array gives wrong answers; read the consuming function too.
- **Lookup functions are unconfirmed.** Upstream appears to query the table through `dc(id)` / `hg(id, capability)`, but their exact signatures were not verified. Confirm them in the current version before relying on them.

## How Noa differs

- Noa splits the same table into scattered `.includes()` chains in `src/utils/thinking.ts`, `effort.ts`, `betas.ts`, `context.ts`, `modelCost.ts` and `advisor.ts`. This is the source of model-capability drift.
- Upstream has a layer Noa lacks entirely: 400-error classification, retry with the offending field stripped, and an in-session latch. That is why upstream can send optimistically with no conservative allowlist. Noa has no such layer, so its allowlists must stay accurate.
