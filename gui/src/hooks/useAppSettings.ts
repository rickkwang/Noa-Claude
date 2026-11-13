import { useEffect, useState } from "react"
import type { AppSettings } from "../types"
import { migrateAppearance } from "../lib/appearanceMigration"
import { defaultSettings } from "../theme/settings"
import { configureStreamSound } from "../lib/streamSound"
import { SHORTCUT_IDS, isBinding, type ShortcutBindings } from "../lib/shortcuts"

// Keep only known shortcut ids with well-formed bindings; anything else would break the keydown matcher.
function validBindings(raw: unknown): Partial<ShortcutBindings> {
  if (!raw || typeof raw !== "object") return {}
  const valid = Object.entries(raw).filter(([id, value]) => (SHORTCUT_IDS as readonly string[]).includes(id) && isBinding(value))
  return Object.fromEntries(valid) as Partial<ShortcutBindings>
}

function readShortcuts(): Partial<ShortcutBindings> {
  try {
    return validBindings(JSON.parse(localStorage.getItem("noa-agent.shortcuts") ?? "{}"))
  } catch {
    return {}
  }
}

function loadSettings(): AppSettings {
  try {
    const appearance = JSON.parse(localStorage.getItem("noa-agent.appearance") ?? "{}")
    if (appearance.maxWidth === 880) appearance.maxWidth = defaultSettings.appearance.maxWidth
    const agent = { ...defaultSettings.agent, ...JSON.parse(localStorage.getItem("noa-agent.agent") ?? "{}") }
    // Superseded by permissionDefault. A stored "default" was the old initial value, so only explicit choices carry over.
    if (["acceptEdits", "plan", "auto"].includes(agent.defaultPermissionMode)) agent.permissionDefault = agent.defaultPermissionMode
    delete agent.defaultPermissionMode
    return {
      ...defaultSettings,
      appearance: {
        ...defaultSettings.appearance,
        ...migrateAppearance(appearance),
      },
      agent,
      composer: { ...defaultSettings.composer, ...JSON.parse(localStorage.getItem("noa-agent.composer") ?? "{}") },
      terminal: { ...defaultSettings.terminal, ...JSON.parse(localStorage.getItem("noa-agent.terminal") ?? "{}") },
      notifications: { ...defaultSettings.notifications, ...JSON.parse(localStorage.getItem("noa-agent.notifications") ?? "{}") },
      shortcuts: { ...defaultSettings.shortcuts, ...readShortcuts() },
    }
  } catch {
    return defaultSettings
  }
}

// GUI preferences, read once from browser storage and written back on every change.
export function useAppSettings() {
  const [settings, setSettings] = useState(loadSettings)
  useEffect(() => {
    localStorage.setItem("noa-agent.appearance", JSON.stringify(settings.appearance))
    localStorage.setItem("noa-agent.agent", JSON.stringify(settings.agent))
    localStorage.setItem("noa-agent.composer", JSON.stringify(settings.composer))
    localStorage.setItem("noa-agent.terminal", JSON.stringify(settings.terminal))
    localStorage.setItem("noa-agent.notifications", JSON.stringify(settings.notifications))
    localStorage.setItem("noa-agent.shortcuts", JSON.stringify(settings.shortcuts))
  }, [settings])
  // The desktop main process decides when to notify, so it needs the current choices.
  useEffect(() => {
    window.noaDesktop?.notifications?.configure(settings.notifications).catch(() => undefined)
  }, [settings.notifications])
  useEffect(() => configureStreamSound(settings.composer.streamSound), [settings.composer.streamSound])
  return [settings, setSettings] as const
}
