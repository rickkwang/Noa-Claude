import type { SlashCommand } from "./protocol"

export type GuiCommandAction =
  | "new"
  | "resume"
  | "model"
  | "effort"
  | "permissions"
  | "plan"
  | "settings"
  | "context"
  | "activity"
  | "skills"
  | "help"
  | "stop"
  | "reload"
export interface ComposerCommand extends SlashCommand {
  group: string
  action?: GuiCommandAction
  value?: string
  active?: boolean
  disabled?: boolean
}
const guiCommands: ComposerCommand[] = [
  {
    name: "new",
    aliases: ["clear", "reset"],
    description: "Start a new chat in this project",
    argumentHint: "",
    action: "new",
    group: "Commands",
  },
  {
    name: "resume",
    description: "Find and reopen a previous chat",
    argumentHint: "",
    action: "resume",
    group: "Commands",
  },
  {
    name: "model",
    description: "Choose the model for this chat",
    argumentHint: "[model]",
    action: "model",
    group: "Commands",
  },
  {
    name: "effort",
    description: "Choose reasoning effort",
    argumentHint: "[level]",
    action: "effort",
    group: "Commands",
  },
  {
    name: "permissions",
    description: "Choose how Noa approves actions",
    argumentHint: "[mode]",
    action: "permissions",
    group: "Commands",
  },
  { name: "plan", description: "Switch to plan mode", argumentHint: "", action: "plan", group: "Commands" },
  {
    name: "config",
    aliases: ["settings"],
    description: "Open Noa settings",
    argumentHint: "",
    action: "settings",
    group: "Commands",
  },
  {
    name: "context",
    aliases: ["cost"],
    description: "Inspect context usage, tokens and session cost",
    argumentHint: "",
    action: "context",
    group: "Commands",
  },
  {
    name: "status",
    description: "Inspect agent activity and diagnostics",
    argumentHint: "",
    action: "activity",
    group: "Commands",
  },
  { name: "skills", description: "Browse available skills", argumentHint: "", action: "skills", group: "Commands" },
  { name: "help", description: "Browse all commands and skills", argumentHint: "", action: "help", group: "Commands" },
  {
    name: "stop",
    description: "Stop the current turn and pause queued messages",
    argumentHint: "",
    action: "stop",
    group: "Commands",
  },
  {
    name: "reload-plugins",
    description: "Reload plugins and refresh available skills",
    argumentHint: "",
    action: "reload",
    group: "Commands",
  },
]
export function composerCommands(commands: SlashCommand[]): ComposerCommand[] {
  const guiNames = new Set(guiCommands.flatMap((command) => [command.name, ...(command.aliases ?? [])]))
  return [
    ...guiCommands,
    ...commands
      .filter(
        (command) =>
          !guiNames.has(command.name) &&
          !command.hidden &&
          command.type !== "local-jsx" &&
          !command.description.startsWith("(removed)"),
      )
      .map((command) => ({ ...command, group: command.type === "prompt" ? "Skills" : "Commands" })),
  ].sort((a, b) => a.group.localeCompare(b.group))
}
export function findComposerCommand(commands: ComposerCommand[], name: string): ComposerCommand | undefined {
  const normalized = name.toLowerCase()
  return commands.find(
    (command) =>
      command.name.toLowerCase() === normalized || command.aliases?.some((alias) => alias.toLowerCase() === normalized),
  )
}
export function filterComposerCommands(commands: ComposerCommand[], query: string): ComposerCommand[] {
  const normalized = query.trim().toLowerCase()
  return commands.filter((command) =>
    [command.name, command.value, ...(command.aliases ?? []), command.description].some((value) =>
      value?.toLowerCase().includes(normalized),
    ),
  )
}
