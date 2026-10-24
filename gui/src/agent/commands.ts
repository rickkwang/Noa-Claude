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
  ].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
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
  if (!normalized) return commands
  const groupOrder = new Map<string, number>()
  commands.forEach((command) => {
    if (!groupOrder.has(command.group)) groupOrder.set(command.group, groupOrder.size)
  })
  return commands
    .map((command) => ({
      command,
      score: Math.max(...[command.name, command.value, ...(command.aliases ?? [])].map((value) => commandMatchScore(value, normalized))),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        (groupOrder.get(a.command.group) ?? Number.MAX_SAFE_INTEGER) -
          (groupOrder.get(b.command.group) ?? Number.MAX_SAFE_INTEGER) ||
        b.score - a.score ||
        a.command.name.localeCompare(b.command.name),
    )
    .map(({ command }) => command)
}

function commandMatchScore(value: string | undefined, query: string): number {
  if (!value) return 0
  const text = value.toLowerCase()
  if (text.startsWith(query)) return 300 - text.length
  const substring = text.indexOf(query)
  if (substring >= 0) return 200 - substring - text.length
  let cursor = 0
  for (const character of text) {
    if (character === query[cursor]) cursor++
    if (cursor === query.length) return 100 - text.length
  }
  return 0
}

export function slashAtCaret(value: string, caret: number): {
  query: string
  argument?: string
  start: number
  end: number
} | undefined {
  const before = value.slice(0, caret)
  const match = before.match(/(?:^|\s)\/([^\s]*)(?:[ \t](.*))?$/)
  if (!match) return undefined
  const leading = /^\s/.test(match[0]) ? 1 : 0
  return {
    query: match[1] ?? "",
    argument: match[2],
    start: caret - match[0].length + leading,
    end: caret,
  }
}
