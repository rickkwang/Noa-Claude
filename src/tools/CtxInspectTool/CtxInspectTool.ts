// Placeholder shell: the implementation is absent from this fork, so the tool
// never registers. The null export is load-bearing — a zero-byte module
// bundles to a require() that returns undefined, and the `.CtxInspectTool` read
// under feature('CONTEXT_COLLAPSE') then throws at startup.
export const CtxInspectTool = null
