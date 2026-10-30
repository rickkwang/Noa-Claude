import type { ElicitationRequest } from "../agent/protocol"

type Field = {
  type?: string
  title?: string
  description?: string
  enum?: (string | number)[]
  enumNames?: string[]
  items?: { type?: string; enum?: string[]; enumNames?: string[] }
  minItems?: number
  maxItems?: number
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  format?: string
}
const button = "noa-approval-button noa-press border border-[var(--border-default)]"
export function ElicitationCard({
  request,
  onAnswer,
  draft,
  onDraftChange,
}: {
  draft?: Record<string, string[]>
  onDraftChange?: (draft: Record<string, string[]>) => void
  request: ElicitationRequest & { requestId: string; completed?: boolean }
  onAnswer: (id: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void
}) {
  const schema = request.requested_schema
  const fields = Object.entries((schema?.properties ?? {}) as Record<string, Field>)
  const required = (schema?.required ?? []) as string[]
  const supported = fields.every(
    ([, field]) =>
      ["string", "number", "integer", "boolean"].includes(field.type ?? "string") ||
      (field.type === "array" && !!field.items?.enum),
  )
  const url = request.url && /^https?:\/\//i.test(request.url) ? request.url : undefined
  return (
    <form
      aria-label={`Input requested by ${request.mcp_server_name}`}
      className="noa-approval-card flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-y-auto rounded-3xl border border-[var(--border-default)] p-4"
      onChange={(event) => {
        const data = new FormData(event.currentTarget)
        onDraftChange?.(Object.fromEntries(fields.map(([name]) => [name, data.getAll(name).map(String)])))
      }}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const content: Record<string, unknown> = {}
        for (const [name, field] of fields) {
          const value = data.get(name)
          if (field.type === "array") {
            const selected = data.getAll(name)
            const input = event.currentTarget.elements.namedItem(name) as HTMLSelectElement
            if (
              selected.length < (field.minItems ?? (required.includes(name) ? 1 : 0)) ||
              selected.length > (field.maxItems ?? Infinity)
            ) {
              input.setCustomValidity("Select the requested number of options.")
              input.reportValidity()
              return
            }
            content[name] = selected
          } else if (field.type === "boolean") content[name] = value === "on"
          else if (value !== null && value !== "")
            content[name] = field.type === "number" || field.type === "integer" ? Number(value) : value
        }
        onAnswer(request.requestId, "accept", request.mode === "url" ? undefined : content)
      }}
    >
      <div className="text-caption text-[var(--sidebar-text-muted)]">{request.mcp_server_name} needs your input</div>
      <p className="m-0 text-body whitespace-pre-wrap">{request.message}</p>
      {request.completed && <p role="status" className="text-body">Authorization complete. Continue to return to the task.</p>}
      {request.mode === "url" ? (
        url ? (
          <a href={url} target="_blank" rel="noreferrer" className="break-all text-body text-[var(--accent-color)]">
            Open authorization page
          </a>
        ) : (
          <p role="alert" className="text-caption">
            This authorization URL cannot be opened.
          </p>
        )
      ) : supported ? (
        fields.map(([name, field]) => (
          <label key={name} className="flex flex-col gap-1 text-body">
            <span>
              {field.title ?? name}
              {required.includes(name) ? " *" : ""}
            </span>
            {field.description && (
              <span className="text-caption text-[var(--sidebar-text-muted)]">{field.description}</span>
            )}
            {field.type === "array" ? (
              <select
                name={name}
                multiple
                required={required.includes(name)}
                defaultValue={draft?.[name] ?? (Array.isArray(field.default) ? field.default.map(String) : [])}
                onChange={(event) => event.currentTarget.setCustomValidity("")}
                className="rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-2 py-1"
              >
                {field.items?.enum?.map((value, i) => (
                  <option key={value} value={value}>
                    {field.items?.enumNames?.[i] ?? value}
                  </option>
                ))}
              </select>
            ) : field.enum ? (
              <select
                name={name}
                required={required.includes(name)}
                defaultValue={draft?.[name]?.[0] ?? String(field.default ?? "")}
                className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] px-2"
              >
                <option value="">Choose…</option>
                {field.enum.map((value, i) => (
                  <option key={value} value={value}>
                    {field.enumNames?.[i] ?? value}
                  </option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <input
                name={name}
                type="checkbox"
                defaultChecked={draft?.[name] ? draft[name]!.includes("on") : field.default === true}
                className="self-start accent-[var(--accent-color)]"
              />
            ) : (
              <input
                name={name}
                type={
                  field.type === "number" || field.type === "integer"
                    ? "number"
                    : field.format === "email"
                      ? "email"
                      : field.format === "uri"
                        ? "url"
                        : "text"
                }
                step={field.type === "integer" ? 1 : "any"}
                min={field.minimum}
                max={field.maximum}
                minLength={field.minLength}
                maxLength={field.maxLength}
                required={required.includes(name)}
                defaultValue={draft?.[name]?.[0] ?? (field.default === undefined ? "" : String(field.default))}
                className="h-8 rounded-md border border-[var(--border-default)] bg-transparent px-2 outline-none focus:border-[var(--accent-color)]"
              />
            )}
          </label>
        ))
      ) : (
        <p role="alert" className="text-caption">
          This server requested an unsupported form. Cancel this request to continue.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={button} onClick={() => onAnswer(request.requestId, "cancel")}>
          Cancel
        </button>
        <button type="button" className={button} onClick={() => onAnswer(request.requestId, "decline")}>
          Decline
        </button>
        <button
          type="submit"
          disabled={request.mode === "url" ? !url : !supported}
          className={`${button} bg-[var(--text-primary)] text-[var(--surface-page)] disabled:opacity-40`}
        >
          {request.completed ? "Continue" : request.mode === "url" ? "I’ve authorized" : "Continue"}
        </button>
      </div>
    </form>
  )
}
