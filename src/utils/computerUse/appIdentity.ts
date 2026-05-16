export type AppIdentity = {
  bundleId: string
  displayName: string
}

type AppAliasGroup = {
  names: readonly string[]
  bundleIds: readonly string[]
}

const APP_ALIAS_GROUPS: readonly AppAliasGroup[] = [
  {
    names: ['WeChat', 'Weixin', '微信'],
    bundleIds: ['com.tencent.xinWeChat'],
  },
  {
    names: ['WeCom', '企业微信', 'WeWork'],
    bundleIds: ['com.tencent.WeWorkMac'],
  },
  {
    names: ['Messages', 'iMessage', '信息'],
    bundleIds: ['com.apple.MobileSMS'],
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
  },
  {
    names: ['Discord'],
    bundleIds: ['com.hnc.Discord'],
  },
  {
    names: ['Telegram'],
    bundleIds: ['ru.keepcoder.Telegram'],
  },
  {
    names: ['WhatsApp'],
    bundleIds: ['net.whatsapp.WhatsApp'],
  },
  {
    names: ['Signal'],
    bundleIds: ['org.whispersystems.signal-desktop'],
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
