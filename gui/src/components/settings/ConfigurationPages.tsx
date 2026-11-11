import type { AgentState } from "../../agent/reducer"
import type { PermissionMode } from "../../agent/protocol"
import { ChevronDown, RefreshCcw } from "../../lib/icons"
import { findModel } from "../../lib/models"
import { outputStyleDescription, outputStyleOptions } from "../../lib/outputStyles"
import { Row, Section, Select, actionButton } from "./controls"
import { permissionOptions } from "./GeneralPage"

// Pages that show the connected CLI's state: configuration, hooks and MCP servers.

export const sourceLabels: Record<string, string> = {
  bundled: "Bundled",
  builtin: "Built-in",
  plugin: "Plugin",
  mcp: "MCP",
  userSettings: "User",
  projectSettings: "Project",
  localSettings: "Local project",
  flagSettings: "Session",
  policySettings: "Managed",
}

export function RefreshBar({ agent, onRefresh }: { agent: AgentState; onRefresh: () => void }) {
  const disconnected = agent.connection !== "ready"
  return (
    <>
      <div className="flex items-center justify-between gap-4 text-body text-[var(--sidebar-text-muted)]">
        <span>{disconnected ? "Connect Noa to load settings." : "Review settings for this workspace."}</span>
        <button type="button" disabled={disconnected || agent.mcpPending} className={actionButton} onClick={onRefresh}>
          <RefreshCcw size={14} className="mr-1 inline" />
          Refresh
        </button>
      </div>
      {agent.error && (
        <p role="alert" className="text-body text-[#C24444]">
          {agent.error}
        </p>
      )}
    </>
  )
}

export function ConfigurationPage({
  agent,
  onModel,
  onEffort,
  onOutputStyle,
  onMode,
}: {
  agent: AgentState
  onModel: (model: string) => void
  onEffort: (effort: string | null) => void
  onOutputStyle: (style: string) => void
  onMode: (mode: PermissionMode) => void
}) {
  const disconnected = agent.connection !== "ready"
  // Mirrors the composer: permission mode and effort may change mid-turn; the model and output
  // style may not, since a switch appends transcript messages or rewrites the system prompt.
  const locked = disconnected || agent.busy
  const activeModel = findModel(agent.models, agent.model)
  const modelOptions: [string, string][] = agent.models.map((m) => [m.value, m.displayName])
  if (agent.model && !activeModel) modelOptions.unshift([agent.model, agent.model])
  const effortOptions: [string, string][] = [["default", "Default"], ...(activeModel?.supportsEffort ? activeModel.supportedEffortLevels ?? [] : []).map((level): [string, string] => [level, level])]

  return (
    <>
      <Section title="Current chat">
        <Row label="Model" description="Choose the model for this chat.">
          <Select
            value={activeModel?.value ?? agent.model ?? ""}
            options={modelOptions}
            disabled={locked || !modelOptions.length}
            onChange={onModel}
          />
        </Row>
        <Row label="Reasoning effort" description="Use a level supported by the current model.">
          <Select
            value={agent.effort ?? "default"}
            options={effortOptions}
            disabled={disconnected || effortOptions.length < 2}
            onChange={(value) => onEffort(value === "default" ? null : value)}
          />
        </Row>
        <Row label="Output style" description={outputStyleDescription(agent.outputStyle) ?? "Applies to this chat."}>
          <Select
            value={agent.outputStyle ?? "default"}
            options={outputStyleOptions(agent.outputStyle)}
            disabled={locked}
            onChange={onOutputStyle}
          />
        </Row>
        <Row
          label="Current permissions"
          description="Applies to this chat. Managed policies and model restrictions still apply."
        >
          <Select
            value={agent.permissionMode ?? "default"}
            options={[
              ...(agent.permissionMode && !permissionOptions.some(([mode]) => mode === agent.permissionMode)
                ? [[agent.permissionMode, agent.permissionMode === "bypassPermissions" ? "Full access" : agent.permissionMode] as [string, string]]
                : []),
              ...permissionOptions.filter(
                ([mode]) =>
                  mode !== "inherit" &&
                  (mode !== "auto" || activeModel?.supportsAutoMode !== false || agent.permissionMode === "auto")
              ),
            ]}
            disabled={disconnected}
            onChange={(value) => onMode(value as PermissionMode)}
          />
        </Row>
      </Section>
      <Section title="Configuration sources">
        {agent.cliSettings ? (
          agent.cliSettings.sources.length ? (
            agent.cliSettings.sources.map(({ source, settings: values }) => (
              <Row
                key={source}
                label={sourceLabels[source] ?? source}
                description={
                  source === "policySettings"
                    ? "Managed by your organization"
                    : source === "flagSettings"
                      ? "Overrides for this session"
                      : undefined
                }
              >
                <span className="shrink-0 text-caption text-[var(--sidebar-text-muted)]">
                  {Object.keys(values).length} {Object.keys(values).length === 1 ? "setting" : "settings"}
                </span>
              </Row>
            ))
          ) : (
            <Row label="Using Noa defaults" />
          )
        ) : (
          <Row label={disconnected ? "Noa is disconnected" : "Loading…"} />
        )}
      </Section>
      <Section title="Permission rules">
        {!agent.cliSettings ? (
          <Row label={disconnected ? "Noa is disconnected" : "Loading…"} />
        ) : (
          (["allow", "ask", "deny"] as const).map((kind) => {
            const rules = agent.cliSettings?.effective.permissions?.[kind] ?? []
            const label = { allow: "Allow", ask: "Ask", deny: "Deny" }[kind]
            return rules.length ? (
              <details key={kind} data-permission-kind={kind} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body">
                  <span className="font-medium">{label}</span>
                  <span className="flex items-center gap-2 text-caption text-[var(--sidebar-text-muted)]">
                    {rules.length} {rules.length === 1 ? "rule" : "rules"}
                    <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <ul className="noa-selectable m-0 max-h-64 list-none overflow-y-auto border-t border-[var(--divider-subtle)] px-4 py-1 font-mono text-caption leading-5">
                  {rules.map((rule, index) => (
                    <li
                      key={index}
                      className="whitespace-pre-wrap break-all border-b border-[var(--divider-subtle)] py-2 last:border-b-0"
                    >
                      {rule}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <Row key={kind} label={label} description="No configured rules" />
            )
          })
        )}
      </Section>
    </>
  )
}

export function McpPage({ agent, onChangeMcp }: { agent: AgentState; onChangeMcp: (name: string, enabled?: boolean) => void }) {
  const locked = agent.connection !== "ready" || agent.busy
  return (
    <Section title="Connected servers">
      {!agent.mcpServers?.length ? (
        <Row label={agent.mcpServers ? "No MCP servers connected" : "Loading…"} />
      ) : (
        agent.mcpServers.map((server) => (
          <Row key={server.name} label={server.name} description={server.status}>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={locked || agent.mcpPending || server.status === "disabled" || server.status === "pending"}
                className={actionButton}
                onClick={() => onChangeMcp(server.name)}
              >
                Reconnect
              </button>
              <button
                type="button"
                disabled={locked || agent.mcpPending || server.status === "pending"}
                className={actionButton}
                onClick={() => onChangeMcp(server.name, server.status === "disabled")}
              >
                {server.status === "disabled" ? "Enable" : "Disable"}
              </button>
            </div>
          </Row>
        ))
      )}
    </Section>
  )
}

export function HooksPage({ agent }: { agent: AgentState }) {
  const hooks = agent.cliSettings?.hooks
  const disconnected = agent.connection !== "ready"
  return (
    <Section title="Configured hooks">
      {hooks?.restricted && (
        <Row
          label="Custom hooks restricted"
          description="Some hooks are hidden or disabled by your current settings, policy, or safe mode."
        />
      )}
      {!hooks ? (
        <Row
          label={agent.cliSettings ? "Hook details unavailable" : disconnected ? "Noa is disconnected" : "Loading…"}
        />
      ) : hooks.items.length === 0 ? (
        <Row label="No hooks available" />
      ) : (
        hooks.items.map((hook, index) => (
          <details key={index} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body">
              <span className="font-medium">{hook.event}</span>
              <span className="flex items-center gap-2 text-caption text-[var(--sidebar-text-muted)]">
                {hook.source} · {hook.type}
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-[var(--divider-subtle)] px-4 py-3 text-caption text-[var(--sidebar-text-muted)]">
              {hook.matcher && <p>Matcher: {hook.matcher}</p>}
              {hook.timeout !== undefined && <p>Timeout: {hook.timeout}s</p>}
              <pre className="noa-selectable m-0 mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono">
                {hook.text}
              </pre>
            </div>
          </details>
        ))
      )}
    </Section>
  )
}
