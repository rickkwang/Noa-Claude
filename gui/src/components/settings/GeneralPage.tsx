import type { AppSettings } from "../../types"
import type { AccountInfo, ModelInfo } from "../../agent/protocol"
import { outputStyleOptions } from "../../lib/outputStyles"
import { useConfirm } from "../ConfirmDialog"
import { Row, Section, Select, TextField, Toggle } from "./controls"

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
  const permissionMode = settings.agent.permissionDefault
  const modifierLabel = navigator.platform.includes("Mac") ? "⌘" : "Ctrl"
  const providerLabel = account?.apiProvider ? providerDisplayName(account.apiProvider) : undefined
  const setPermission = (permissionDefault: DefaultMode) =>
    onChange({ ...settings, agent: { ...settings.agent, permissionDefault } })

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
          <button
            type="button"
            onClick={onSignIn}
            className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 text-body text-[var(--text-primary)] hover:bg-[var(--settings-fill-hover)]"
          >
            {account?.email ? "Sign in again" : "Sign in"}
          </button>
        </Row>
      </Section>
      <Section title="Permissions">
        <Row
          label="Default permissions"
          description="By default, Noa can read and edit files in its workspace. It can ask for additional access when needed. Follow Noa settings uses permissions.defaultMode from settings.json."
        >
          <Select
            value={permissionMode}
            options={permissionOptions.filter(([mode]) => mode !== "auto" || activeModel?.supportsAutoMode !== false || permissionMode === "auto")}
            onChange={(value) => setPermission(value as DefaultMode)}
          />
        </Row>
        <Row
          label="Full access"
          description="When Noa runs with full access, it can edit any file on your computer and run commands with network, without your approval. This significantly increases the risk of data loss, leaks, or unexpected behavior."
        >
          <Toggle
            checked={settings.composer.showFullAccess}
            onChange={async (showFullAccess) => {
              if (showFullAccess && !(await confirm({
                title: "Make Full access available?",
                description: "When selected, Noa can access the internet and read and edit files without asking for approval, including potentially destructive commands. Turning this on adds Full access to the permissions menu. It does not turn Full access on.",
                confirmLabel: "Confirm",
                danger: true,
              }))) return
              onChange({ ...settings, composer: { ...settings.composer, showFullAccess } })
            }}
          />
        </Row>
      </Section>
      <Section title="Responses">
        <Row label="Default output style" description="Used for new chats. Follow Noa settings uses outputStyle from settings.json.">
          <Select
            value={settings.agent.outputStyle}
            options={[["inherit", "Follow Noa settings"], ...outputStyleOptions(settings.agent.outputStyle === "inherit" ? undefined : settings.agent.outputStyle)]}
            onChange={(outputStyle) => onChange({ ...settings, agent: { ...settings.agent, outputStyle } })}
          />
        </Row>
      </Section>
      <Section title="Composer">
        <Row label="Send shortcut" description="Choose when Enter sends a prompt or inserts a new line.">
          <Select
            value={settings.composer.sendShortcut}
            options={[
              ["enter", "Enter"],
              ["modifier-enter", `${modifierLabel} + Enter always`],
              ["modifier-enter-multiline", `${modifierLabel} + Enter for multiline prompts`],
            ]}
            onChange={(value) =>
              onChange({
                ...settings,
                composer: { ...settings.composer, sendShortcut: value as AppSettings["composer"]["sendShortcut"] },
              })
            }
          />
        </Row>
        <Row label="Follow-up behavior" description="Queue follow-ups while Noa runs, or steer the current run with them.">
          <Select
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
        <Row label="Show context window usage" description="Show context usage in the composer.">
          <Toggle
            checked={settings.composer.showContextUsage}
            onChange={(showContextUsage) =>
              onChange({ ...settings, composer: { ...settings.composer, showContextUsage } })
            }
          />
        </Row>
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
        <Row label="Font" description="A font installed on this computer, such as a Nerd Font for prompt icons. Leave empty to use the code font.">
          <TextField
            value={settings.terminal.fontFamily}
            placeholder="Code font"
            label="Terminal font"
            onChange={(fontFamily) => onChange({ ...settings, terminal: { ...settings.terminal, fontFamily } })}
          />
        </Row>
      </Section>
      <Section title="Notifications">
        <Row label="Turn notifications" description="When a finished task shows a desktop notification.">
          <Select
            value={settings.notifications.turnMode}
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
        <Row label="Notification sound" description="Sound played with desktop notifications.">
          <Select
            value={settings.notifications.sound}
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
