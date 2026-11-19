import { useEffect, useRef, useState } from "react"
import type { AppSettings } from "../../types"
import type { AccountInfo, ModelInfo } from "../../agent/protocol"
import { ChevronDown } from "../../lib/icons"
import { loadFontFamilies } from "../../lib/localFonts"
import { outputStyleOptions } from "../../lib/outputStyles"
import { previewStreamSound } from "../../lib/streamSound"
import { useConfirm } from "../ConfirmDialog"
import { PopupMenu, anchorBelow, type PopupMenuAnchor } from "../PopupMenu"
import { actionButton, Row, Section, Segmented, Select, Slider, TextField, Toggle } from "./controls"

type DefaultMode = AppSettings["agent"]["permissionDefault"]

export const permissionOptions: [DefaultMode, string][] = [
  ["inherit", "Follow Noa settings"],
  ["auto", "Auto"],
  ["default", "Manual"],
  ["acceptEdits", "Accept edits"],
  ["plan", "Plan"],
]

function providerDisplayName(provider: string): string {
  const labels: Record<string, string> = {
    firstParty: "Anthropic",
    openaiCompatible: "OpenAI-compatible",
    bedrock: "Amazon Bedrock",
    vertex: "Google Vertex",
    foundry: "Microsoft Foundry",
  }
  return labels[provider] ?? provider
}

export function GeneralPage({
  settings,
  account,
  activeModel,
  onChange,
  onSignIn,
}: {
  settings: AppSettings
  account?: AccountInfo
  activeModel?: ModelInfo
  onChange: (settings: AppSettings) => void
  onSignIn: () => void
}) {
  const { confirm, dialog } = useConfirm()
  const [monoFonts, setMonoFonts] = useState<string[]>([])
  const [fontMenu, setFontMenu] = useState<PopupMenuAnchor>()
  const fontPickerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let cancelled = false
    loadFontFamilies()
      .then((families) => {
        if (!cancelled) setMonoFonts(families.filter((f) => f.monospaced).map((f) => f.family))
      })
      .catch(() => { if (!cancelled) setMonoFonts([]) })
    return () => { cancelled = true }
  }, [])
  const permissionMode = settings.agent.permissionDefault
  const modifierLabel = navigator.platform.includes("Mac") ? "⌘" : "Ctrl"
  const providerLabel = account?.apiProvider ? providerDisplayName(account.apiProvider) : undefined
  const sound = settings.composer.streamSound
  const setSound = (next: Partial<typeof sound>) =>
    onChange({ ...settings, composer: { ...settings.composer, streamSound: { ...sound, ...next } } })
  const setPermission = (permissionDefault: DefaultMode) =>
    onChange({ ...settings, agent: { ...settings.agent, permissionDefault } })
  const notificationsDisabled =
    settings.notifications.turnMode === "off" &&
    !settings.notifications.permissions &&
    !settings.notifications.questions
  const previewNotificationSound = window.noaDesktop?.notifications?.previewSound
  const signInLabel = account?.email
    ? "Sign in again"
    : providerLabel && account?.apiProvider !== "firstParty"
      ? "Sign in to Anthropic"
      : "Sign in"

  return (
    <>
      <Section title="Account">
        <Row
          label={account?.email ?? providerLabel ?? "Noa account"}
          description={
            account?.email
              ? account.organization ?? "Anthropic account"
              : providerLabel
                ? `Connected through ${providerLabel}`
                : "Sign in to use Anthropic through this desktop session."
          }
        >
          <button type="button" onClick={onSignIn} className={actionButton}>
            {signInLabel}
          </button>
        </Row>
      </Section>
      <Section title="Permissions">
        <Row
          label="Default permissions"
          description="Noa reads and edits files in its workspace and asks before going further. Follow Noa settings uses permissions.defaultMode."
        >
          <Select
            value={permissionMode}
            options={permissionOptions.filter(([mode]) => mode !== "auto" || activeModel?.supportsAutoMode !== false || permissionMode === "auto")}
            onChange={(value) => setPermission(value as DefaultMode)}
          />
        </Row>
        <Row
          label="Bypass permissions"
          description="Show Bypass permissions in the permissions menu. It lets Noa edit any file and use the network without approval."
        >
          <Toggle
            checked={settings.composer.showFullAccess}
            onChange={async (showFullAccess) => {
              if (showFullAccess && !(await confirm({
                title: "Make Bypass permissions available?",
                description: "When selected, Noa can access the internet and read and edit files without asking for approval, including potentially destructive commands. Turning this on adds Bypass permissions to the permissions menu. It does not turn Bypass permissions on.",
                confirmLabel: "Confirm",
                danger: true,
              }))) return
              onChange({ ...settings, composer: { ...settings.composer, showFullAccess } })
            }}
          />
        </Row>
      </Section>
      <Section title="Chat">
        <Row label="Default output style" description="Used for new chats. Follow Noa settings uses outputStyle.">
          <Select
            value={settings.agent.outputStyle}
            options={[["inherit", "Follow Noa settings"], ...outputStyleOptions(settings.agent.outputStyle === "inherit" ? undefined : settings.agent.outputStyle)]}
            onChange={(outputStyle) => onChange({ ...settings, agent: { ...settings.agent, outputStyle } })}
          />
        </Row>
        <Row label="Send shortcut" description="Which keys send a prompt.">
          <Select
            value={settings.composer.sendShortcut}
            options={[
              ["enter", "Enter"],
              ["modifier-enter", `${modifierLabel} Enter`],
              ["modifier-enter-multiline", `${modifierLabel} Enter when multiline`],
            ]}
            onChange={(value) =>
              onChange({
                ...settings,
                composer: { ...settings.composer, sendShortcut: value as AppSettings["composer"]["sendShortcut"] },
              })
            }
          />
        </Row>
        <Row label="Follow-up behavior" description="Messages sent while Noa runs are queued or steer the current run.">
          <Segmented
            value={settings.composer.followUpMode}
            options={[
              ["queue", "Queue"],
              ["steer", "Steer"],
            ]}
            onChange={(value) =>
              onChange({
                ...settings,
                composer: { ...settings.composer, followUpMode: value as AppSettings["composer"]["followUpMode"] },
              })
            }
          />
        </Row>
        <Row label="Show context window usage" description="Show the context meter in the composer.">
          <Toggle
            checked={settings.composer.showContextUsage}
            onChange={(showContextUsage) =>
              onChange({ ...settings, composer: { ...settings.composer, showContextUsage } })
            }
          />
        </Row>
        <Row label="Use system caret" description="Use the native caret in the composer instead of the animated one.">
          <Toggle
            checked={settings.composer.systemCaret}
            onChange={(systemCaret) => onChange({ ...settings, composer: { ...settings.composer, systemCaret } })}
          />
        </Row>
        <Row label="Composer mascot" description="Show an interactive mascot above the input box before a session starts.">
          <Select
            value={settings.composer.mascot}
            options={[
              ["clawd", "Clawd"],
              ["clippy", "Clippy"],
              ["rocky", "Rocky"],
              ["none", "Off"],
            ]}
            onChange={(mascot) =>
              onChange({
                ...settings,
                composer: { ...settings.composer, mascot: mascot as AppSettings["composer"]["mascot"] },
              })
            }
          />
        </Row>
        <Row label="Streaming sound" description="Play soft synthesized notes while a reply streams in.">
          <Toggle checked={sound.enabled} onChange={(enabled) => setSound({ enabled })} />
        </Row>
        {sound.enabled && (
          <Row label="Sound preset" description={sound.preset === "classic" ? "Warm triangle wave with a light reverb." : "Soft sine wave with an airy reverb."}>
            <div className="flex items-center gap-2">
              <button type="button" className={actionButton} onClick={() => previewStreamSound()}>Preview</button>
              <Segmented
                value={sound.preset}
                options={[["classic", "Classic"], ["ethereal", "Ethereal"]]}
                onChange={(preset) => setSound({ preset: preset as typeof sound.preset })}
              />
            </div>
          </Row>
        )}
        {sound.enabled && (
          <Row label="Sound volume">
            <Slider value={sound.volume} label="Sound volume" onChange={(volume) => setSound({ volume })} />
          </Row>
        )}
      </Section>
      <Section title="Terminal">
        <Row label="Default terminal location" description="Choose where the terminal shortcut opens terminal tabs.">
          <Select
            value={settings.terminal.defaultLocation}
            options={[
              ["bottom", "Bottom"],
              ["right", "Right"],
            ]}
            onChange={(value) =>
              onChange({ ...settings, terminal: { ...settings.terminal, defaultLocation: value as AppSettings["terminal"]["defaultLocation"] } })
            }
          />
        </Row>
        <Row label="Terminal font" description="An installed font, such as a Nerd Font. Empty uses the code font.">
          <div className="flex shrink-0 items-center gap-1.5">
            <TextField
              value={settings.terminal.fontFamily}
              placeholder="Code font"
              label="Terminal font"
              onChange={(fontFamily) => onChange({ ...settings, terminal: { ...settings.terminal, fontFamily } })}
            />
            {monoFonts.length > 0 && (
              <>
                <button
                  ref={fontPickerRef}
                  type="button"
                  aria-label="Pick installed terminal font"
                  title="Pick installed font"
                  aria-haspopup="menu"
                  aria-expanded={Boolean(fontMenu)}
                  onClick={() => {
                    if (fontMenu) setFontMenu(undefined)
                    else if (fontPickerRef.current) setFontMenu(anchorBelow(fontPickerRef.current))
                  }}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--sidebar-text-muted)] transition-colors hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/35"
                >
                  <ChevronDown size={14} />
                </button>
                {fontMenu && (
                  <PopupMenu
                    anchor={fontMenu}
                    trigger={fontPickerRef.current}
                    label="Pick installed terminal font"
                    scrollable
                    searchable
                    searchPlaceholder="Search monospace fonts…"
                    minWidth={220}
                    onClose={() => setFontMenu(undefined)}
                    entries={[
                      {
                        key: "",
                        label: "Use code font",
                        checked: settings.terminal.fontFamily === "",
                        onSelect: () => onChange({ ...settings, terminal: { ...settings.terminal, fontFamily: "" } }),
                      },
                      ...monoFonts.map((family) => ({
                        key: family,
                        label: family,
                        checked: settings.terminal.fontFamily === family,
                        onSelect: () => onChange({ ...settings, terminal: { ...settings.terminal, fontFamily: family } }),
                      })),
                    ]}
                  />
                )}
              </>
            )}
          </div>
        </Row>
      </Section>
      <Section title="Notifications">
        <Row label="Turn notifications" description="When to notify that a turn finished.">
          <Select
            value={settings.notifications.turnMode}
            label="Turn notifications"
            options={[
              ["off", "Off"],
              ["unfocused", "When Noa is in the background"],
              ["always", "Always"],
            ]}
            onChange={(value) =>
              onChange({
                ...settings,
                notifications: { ...settings.notifications, turnMode: value as AppSettings["notifications"]["turnMode"] },
              })
            }
          />
        </Row>
        <Row
          label="Notification sound"
          description={`Sound played with desktop notifications.${notificationsDisabled ? " (Desktop notifications are currently off.)" : ""}`}
        >
          <div className="flex shrink-0 items-center gap-2">
            {previewNotificationSound && (
              <button
                type="button"
                disabled={settings.notifications.sound === "none"}
                className={actionButton}
                onClick={() => void previewNotificationSound(settings.notifications.sound)}
              >
                Preview
              </button>
            )}
            <Select
              value={settings.notifications.sound}
              label="Notification sound"
              options={[
                ["default", "Default"],
                ["classic", "Classic"],
                ["none", "None"],
                ["Basso", "Basso"],
                ["Glass", "Glass"],
                ["Ping", "Ping"],
                ["Pop", "Pop"],
                ["Purr", "Purr"],
                ["Tink", "Tink"],
              ]}
              onChange={(sound) => onChange({ ...settings, notifications: { ...settings.notifications, sound } })}
            />
          </div>
        </Row>
        <Row label="Permission requests" description="Notify when a tool needs your approval.">
          <Toggle
            checked={settings.notifications.permissions}
            onChange={(permissions) => onChange({ ...settings, notifications: { ...settings.notifications, permissions } })}
          />
        </Row>
        <Row label="Questions" description="Notify when Noa or an MCP server asks you for input.">
          <Toggle
            checked={settings.notifications.questions}
            onChange={(questions) => onChange({ ...settings, notifications: { ...settings.notifications, questions } })}
          />
        </Row>
        <Row label="Dock badge" description="Show a dot on the Dock icon while a notification is waiting.">
          <Toggle
            checked={settings.notifications.dot}
            onChange={(dot) => onChange({ ...settings, notifications: { ...settings.notifications, dot } })}
          />
        </Row>
      </Section>
      {dialog}
    </>
  )
}
