// Placeholder shell: the implementation is absent from this fork, so the tool
// never registers. The null export is load-bearing — a zero-byte module
// bundles to a require() that returns undefined, and the `.WebBrowserPanel` read
// under feature('WEB_BROWSER_TOOL') then throws at startup.
export const WebBrowserPanel = null
