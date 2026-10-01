// Placeholder shell: the implementation is absent from this fork, so the tool
// never registers. The null export is load-bearing — a zero-byte module
// bundles to a require() that returns undefined, and the `.OverflowTestTool` read
// under feature('OVERFLOW_TEST_TOOL') then throws at startup.
export const OverflowTestTool = null
export const OVERFLOW_TEST_TOOL_NAME = null
