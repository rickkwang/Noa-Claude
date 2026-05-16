export type AppIdentity = {
  bundleId: string
  displayName: string
}

type AppAliasGroup = {
  names: readonly string[]
  bundleIds: readonly string[]
  // Chat/IM-style apps where pasting message body into a still-active
  // search/contact picker is a common destructive mistake. ComputerTool
  // activates a search-selection state machine that demands explicit Return
  // before another type/paste. Earlier substring matching incorrectly
  // tripped this on unrelated apps whose name happened to contain 'line'
  // (Outline/Mainline) or 'teams' (TeamSpeak), so flagging is now exact.
  strictSearchSelection?: boolean
}

const APP_ALIAS_GROUPS: readonly AppAliasGroup[] = [
  {
    names: ['WeChat', 'Weixin', '微信'],
    bundleIds: ['com.tencent.xinWeChat'],
    strictSearchSelection: true,
  },
  {
    names: ['WeCom', '企业微信', 'WeWork'],
    bundleIds: ['com.tencent.WeWorkMac'],
    strictSearchSelection: true,
  },
  {
    names: ['Messages', 'iMessage', '信息'],
    bundleIds: ['com.apple.MobileSMS'],
    strictSearchSelection: true,
  },
  {
    names: ['Mail', '邮件'],
    bundleIds: ['com.apple.mail'],
  },
  {
    names: ['Calendar', '日历'],
    bundleIds: ['com.apple.iCal'],
  },
  {
    names: ['Reminders', '提醒事项'],
    bundleIds: ['com.apple.reminders'],
  },
  {
    names: ['Notes', '备忘录'],
    bundleIds: ['com.apple.Notes'],
  },
  {
    names: ['Safari'],
    bundleIds: ['com.apple.Safari'],
  },
  {
    names: ['Chrome', 'Google Chrome'],
    bundleIds: ['com.google.Chrome'],
  },
  {
    names: ['Finder', '访达'],
    bundleIds: ['com.apple.finder'],
  },
  {
    names: ['System Settings', 'System Preferences', '设置', '系统设置'],
    bundleIds: ['com.apple.SystemSettings', 'com.apple.systempreferences'],
  },
  {
    names: ['Terminal', '终端'],
    bundleIds: ['com.apple.Terminal'],
  },
  {
    names: ['iTerm', 'iTerm2'],
    bundleIds: ['com.googlecode.iterm2'],
  },
  {
    names: ['VS Code', 'Visual Studio Code', 'Code'],
    bundleIds: ['com.microsoft.VSCode'],
  },
  {
    names: ['Slack'],
    bundleIds: ['com.tinyspeck.slackmacgap'],
    strictSearchSelection: true,
  },
  {
    names: ['Discord'],
    bundleIds: ['com.hnc.Discord'],
    strictSearchSelection: true,
  },
  {
    names: ['Telegram'],
    bundleIds: ['ru.keepcoder.Telegram'],
    strictSearchSelection: true,
  },
  {
    names: ['WhatsApp'],
    bundleIds: ['net.whatsapp.WhatsApp'],
    strictSearchSelection: true,
  },
  {
    names: ['Signal'],
    bundleIds: ['org.whispersystems.signal-desktop'],
    strictSearchSelection: true,
  },
  {
    names: ['LINE'],
    bundleIds: ['jp.naver.line.mac'],
    strictSearchSelection: true,
  },
  {
    names: ['Microsoft Teams', 'Teams'],
    bundleIds: ['com.microsoft.teams', 'com.microsoft.teams2'],
    strictSearchSelection: true,
  },
  {
    names: ['Lark', 'Feishu', '飞书'],
    bundleIds: ['com.electron.lark', 'com.bytedance.macos.lark'],
    strictSearchSelection: true,
  },
  {
    names: ['DingTalk', '钉钉'],
    bundleIds: ['com.alibaba.DingTalkMac'],
    strictSearchSelection: true,
  },
  {
    names: ['NeteaseMusic', 'NetEase Cloud Music', '网易云音乐'],
    bundleIds: ['com.netease.163music'],
  },
]

const ALIAS_INDEX = new Map<string, readonly string[]>()
for (const group of APP_ALIAS_GROUPS) {
  const candidates = dedupeStrings([...group.bundleIds, ...group.names])
  for (const candidate of candidates) {
    ALIAS_INDEX.set(normalizeAppIdentity(candidate), candidates)
  }
}

// Pre-computed set of identifiers (lowercased bundle ids + normalized names)
// that belong to a strictSearchSelection group. Lookup is O(1) per app.
const STRICT_SEARCH_SELECTION_KEYS = (() => {
  const set = new Set<string>()
  for (const group of APP_ALIAS_GROUPS) {
    if (!group.strictSearchSelection) continue
    for (const bundleId of group.bundleIds) set.add(bundleId.toLowerCase())
    for (const name of group.names) set.add(normalizeAppIdentity(name))
  }
  return set
})()

export function isStrictSearchSelectionApp(app: AppIdentity): boolean {
  return (
    STRICT_SEARCH_SELECTION_KEYS.has(app.bundleId.toLowerCase()) ||
    STRICT_SEARCH_SELECTION_KEYS.has(normalizeAppIdentity(app.displayName))
  )
}

export function expandAppIdentityCandidates(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  return dedupeStrings([
    ...(ALIAS_INDEX.get(normalizeAppIdentity(trimmed)) ?? []),
    trimmed,
  ])
}

export function appIdentityMatches(
  front: AppIdentity,
  expectedApp: string,
): boolean {
  return expandAppIdentityCandidates(expectedApp).some(candidate =>
    appIdentityMatchesRaw(front, candidate),
  )
}

function appIdentityMatchesRaw(front: AppIdentity, expectedApp: string): boolean {
  const expected = expectedApp.trim().toLowerCase()
  const bundleId = front.bundleId.toLowerCase()
  const displayName = front.displayName.toLowerCase()
  const normalizedExpected = normalizeAppIdentity(expectedApp)
  const normalizedDisplayName = normalizeAppIdentity(front.displayName)
  return (
    bundleId === expected ||
    displayName === expected ||
    normalizedDisplayName === normalizedExpected
  )
}

function normalizeAppIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}
