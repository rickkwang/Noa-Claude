# @anthropic-ai/mcpb (local stub)

This is a local stub for the upstream Anthropic-private `@anthropic-ai/mcpb`
package. It is referenced from the root `package.json` via `file:` so that
`bun install` produces a working `node_modules/@anthropic-ai/mcpb` for
fresh clones — without it, `src/utils/plugins/mcpbHandler.ts`'s dynamic
import fails at runtime.

The stub validates basic manifest fields but returns `null` from
`getMcpConfigForManifest`; MCPB/DXT server config generation is not implemented.
The handler reports this as `MCPB_CONFIG_UNSUPPORTED_ERROR`, and the plugin
integration skips that bundle's server config without treating it as a plugin
load error. Other plugin components can still load.

If/when noa needs real MCPB support, replace this directory with a real
implementation or repoint the `package.json` dependency at the upstream
package.
