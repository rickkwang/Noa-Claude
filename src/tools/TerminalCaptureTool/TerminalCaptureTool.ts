// Placeholder shell: the implementation is absent from this fork, so the tool
// never registers. The null export is load-bearing — a zero-byte module
// bundles to a require() that returns undefined, and the `.TerminalCaptureTool` read
// under feature('TERMINAL_PANEL') then throws at startup.
export const TerminalCaptureTool = null
