# @anthropic-ai/mcpb (local stub)

This is a local stub for the upstream Anthropic-private `@anthropic-ai/mcpb`
package. It is referenced from the root `package.json` via `file:` so that
`bun install` produces a working `node_modules/@anthropic-ai/mcpb` for
fresh clones — without it, `src/utils/plugins/mcpbHandler.ts`'s dynamic
import fails at runtime.

The stub deliberately returns `null` from `getMcpConfigForManifest`, which
makes MCPB/DXT plugin server generation a no-op:
`.mcpb` / `.dxt` plugin bundles will be downloaded and extracted, but no
MCP server config will be generated from their manifests. This matches
the prior behavior (the same stub was previously hand-placed into
`node_modules/`).

If/when noa needs real MCPB support, replace this directory with a real
implementation or repoint the `package.json` dependency at the upstream
package.
