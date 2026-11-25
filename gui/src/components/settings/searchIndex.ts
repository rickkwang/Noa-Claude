import type { ProviderInfo } from "../../agent/protocol"
import { PROVIDER_CATALOG } from "../../lib/providerCatalog"

export type SettingsPageKey =
  | "general"
  | "appearance"
  | "shortcuts"
  | "configuration"
  | "providers"
  | "mcp"
  | "hooks"

export interface SettingsPageMeta {
  key: SettingsPageKey
  label: string
  group: "Personal" | "Coding" | "Integrations"
}

export interface SearchRowEntry {
  label: string
  target?: string
  keywords?: string[]
}

export interface SearchResult {
  page: SettingsPageMeta
  label: string
  target: string
}

export const SETTINGS_PAGES: readonly SettingsPageMeta[] = [
  { key: "general", label: "General", group: "Personal" },
  { key: "appearance", label: "Appearance", group: "Personal" },
  { key: "shortcuts", label: "Keyboard shortcuts", group: "Personal" },
  { key: "configuration", label: "Configuration", group: "Coding" },
  { key: "providers", label: "Providers", group: "Coding" },
  { key: "hooks", label: "Hooks", group: "Coding" },
  { key: "mcp", label: "MCP servers", group: "Integrations" },
]

export function buildSettingsSearchIndex({
  soundEnabled,
  supportsSidebarTranslucency,
  providers,
}: {
  soundEnabled: boolean
  supportsSidebarTranslucency: boolean
  providers: readonly ProviderInfo[]
}): { page: SettingsPageMeta; rows: SearchRowEntry[] }[] {
  const pageByKey = Object.fromEntries(SETTINGS_PAGES.map((page) => [page.key, page])) as Record<
    SettingsPageKey,
    SettingsPageMeta
  >
  const configuredTypes = new Set(providers.map((provider) => provider.type))

  return [
    {
      page: pageByKey.general,
      rows: [
        { label: "Account", target: "Account", keywords: ["sign in", "login", "anthropic"] },
        { label: "Default permissions", keywords: ["mode", "auto", "manual", "plan"] },
        { label: "Bypass permissions", keywords: ["full access", "dangerous", "skip"] },
        { label: "Default output style" },
        { label: "Send shortcut", keywords: ["enter", "submit", "key"] },
        { label: "Follow-up behavior", keywords: ["queue", "steer"] },
        { label: "Show context window usage", keywords: ["meter", "tokens"] },
        { label: "Use system caret", keywords: ["cursor"] },
        { label: "Composer mascot", keywords: ["clawd", "clippy", "rocky"] },
        { label: "Streaming sound", keywords: ["audio", "notes"] },
        {
          label: "Sound preset",
          target: soundEnabled ? "Sound preset" : "Streaming sound",
          keywords: ["classic", "ethereal", "preview"],
        },
        {
          label: "Sound volume",
          target: soundEnabled ? "Sound volume" : "Streaming sound",
          keywords: ["audio"],
        },
        { label: "Default terminal location", keywords: ["bottom", "right", "panel"] },
        { label: "Terminal font", keywords: ["nerd font", "monospace"] },
        { label: "Turn notifications", keywords: ["desktop", "alert"] },
        {
          label: "Notification sound",
          keywords: ["basso", "glass", "ping", "pop", "purr", "tink", "preview"],
        },
        { label: "Permission requests", keywords: ["notifications", "approval"] },
        { label: "Questions", keywords: ["notifications", "mcp"] },
        { label: "Dock badge", keywords: ["notifications", "dot"] },
      ],
    },
    {
      page: pageByKey.appearance,
      rows: [
        { label: "Mode", keywords: ["light", "dark", "system"] },
        { label: "Theme", keywords: ["preset", "palette", "claude", "codex", "nord", "catppuccin"] },
        { label: "Code theme", keywords: ["syntax", "highlight"] },
        { label: "Accent", keywords: ["color"] },
        { label: "Semantic colors", keywords: ["diff", "added", "removed", "skill"] },
        { label: "Share theme", keywords: ["export", "import", "codex-theme-v1"] },
        ...(supportsSidebarTranslucency
          ? [{ label: "Translucent sidebar", keywords: ["vibrancy", "glass", "material"] }]
          : []),
        { label: "Contrast", keywords: ["border", "divider"] },
        { label: "UI font", keywords: ["font style", "face", "family"] },
        { label: "Content font", keywords: ["message", "prose", "face"] },
        { label: "Response font", keywords: ["assistant", "reply", "answer"] },
        { label: "Code font", keywords: ["monospace", "face"] },
        { label: "UI font size" },
        { label: "Code font size" },
        { label: "Font smoothing", keywords: ["antialiased"] },
        { label: "Transcript text size", keywords: ["small", "medium", "large"] },
        { label: "Default transcript view", keywords: ["normal", "thinking", "verbose"] },
        { label: "Output width", keywords: ["compact", "comfortable", "wide", "reading width"] },
        { label: "Reduce motion", keywords: ["animations", "transitions"] },
        { label: "Pointer cursors" },
        { label: "Reset appearance", keywords: ["restore", "default"] },
      ],
    },
    {
      page: pageByKey.shortcuts,
      rows: [
        { label: "New task" },
        { label: "Find tasks" },
        { label: "Settings" },
        { label: "Toggle bottom panel" },
        { label: "Open terminal" },
        { label: "Open changes" },
        { label: "Open files" },
        { label: "Open browser" },
        { label: "Open side chat" },
        { label: "Run instruction" },
        { label: "New line" },
        { label: "Reorder task" },
        { label: "Stop agent" },
      ],
    },
    {
      page: pageByKey.configuration,
      rows: [
        { label: "Model", keywords: ["session", "chat"] },
        { label: "Reasoning effort", keywords: ["thinking"] },
        { label: "Output style", keywords: ["session", "chat"] },
        { label: "Current permissions", keywords: ["session", "chat", "mode"] },
        { label: "Configuration sources" },
        { label: "Permission rules", keywords: ["allow", "ask", "deny"] },
        { label: "Edit permission rules", keywords: ["saved rules", "local", "project", "user"] },
      ],
    },
    {
      page: pageByKey.providers,
      rows: [
        { label: "Configured providers", target: "Configured", keywords: ["active", "in use"] },
        {
          label: "Available providers",
          target: "Available providers",
          keywords: ["api key", "base url", "endpoint", "model"],
        },
        ...providers.map((provider) => ({
          label: provider.name,
          target: provider.name,
          keywords: ["api key", "base url", "model", provider.type, provider.model ?? ""].filter(Boolean),
        })),
        ...PROVIDER_CATALOG.filter((entry) => !configuredTypes.has(entry.type)).map((entry) => ({
          label: entry.label,
          target: entry.label,
          keywords: [entry.description, entry.type, "api key", "base url", "setup"],
        })),
        {
          label: "Custom endpoint",
          target: "Custom endpoint",
          keywords: ["openai", "api key", "base url", "endpoint"],
        },
      ],
    },
    {
      page: pageByKey.hooks,
      rows: [{ label: "Configured hooks" }],
    },
    {
      page: pageByKey.mcp,
      rows: [
        { label: "Connected servers" },
        {
          label: "Manage server configurations",
          keywords: ["custom mcp servers", "add server", "stdio", "http", "sse"],
        },
      ],
    },
  ]
}

export function filterSettingsSearch(
  index: ReturnType<typeof buildSettingsSearchIndex>,
  query: string,
): SearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return index.flatMap((section) =>
    section.rows
      .filter((row) => {
        const haystack = [section.page.label, row.label, ...(row.keywords ?? [])]
          .join(" ")
          .toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
      .map((row) => ({
        page: section.page,
        label: row.label,
        target: row.target ?? row.label,
      })),
  )
}
