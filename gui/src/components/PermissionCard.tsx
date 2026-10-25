import type { Permission } from "../agent/reducer"
import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "../lib/icons"
import { Markdown } from "./Markdown"

interface PermissionCardProps {
  permission: Permission
  onAnswer: (permission: Permission, allow: boolean, remember: boolean, updatedInput?: Record<string, unknown>) => void
}

const button =
  "noa-approval-button noa-press min-w-16 text-center border border-[var(--divider-subtle)]"

export function permissionRememberLabel(suggestions: unknown[]): string {
  const destinations = suggestions.flatMap((suggestion) =>
    typeof suggestion === "object" && suggestion !== null && "destination" in suggestion &&
    typeof suggestion.destination === "string" ? [suggestion.destination] : [],
  )
  return destinations.length > 0 && destinations.every((destination) => destination === "session")
    ? "Allow this conversation"
    : "Always allow"
}

// Approval controls keep the CLI permission decisions and scopes.
export function PermissionCard({ permission, onAnswer }: PermissionCardProps) {
  if (permission.toolName === "AskUserQuestion" && Array.isArray(permission.input.questions))
    return <QuestionCard permission={permission} onAnswer={onAnswer} />
  return <ToolPermissionCard permission={permission} onAnswer={onAnswer} />
}

function ToolPermissionCard({ permission, onAnswer }: PermissionCardProps) {
  const canRemember = permission.suggestions.length > 0
  const rememberLabel = permissionRememberLabel(permission.suggestions)
  const [submitting, setSubmitting] = useState<"allow" | "remember" | "deny">()
  const allowRef = useRef<HTMLButtonElement>(null)
  const optionsRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    allowRef.current?.focus()
  }, [permission.requestId])
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const options = optionsRef.current
      if (options?.open && !options.contains(event.target as Node)) options.open = false
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])
  function answer(allow: boolean, remember: boolean) {
    setSubmitting(remember ? "remember" : allow ? "allow" : "deny")
    onAnswer(permission, allow, remember)
  }
  const description = permission.description ?? (typeof permission.input.description === "string" ? permission.input.description : undefined)
  const properties = Object.entries(permission.input).filter(([key, value]) => !["command", "file_path", "old_string", "new_string", "plan", "questions"].includes(key) && (key !== "description" || value !== description))
  const command = typeof permission.input.command === "string" ? permission.input.command : undefined
  const file = typeof permission.input.file_path === "string" ? permission.input.file_path : undefined
  const plan = typeof permission.input.plan === "string" ? permission.input.plan : undefined
  return (
    <section
      aria-label={`Permission request for ${permission.toolName}`}
      aria-busy={!!submitting}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !submitting) {
          event.preventDefault()
          if (optionsRef.current?.open) {
            optionsRef.current.open = false
            return
          }
          answer(false, false)
        }
      }}
      className="noa-approval-card flex min-w-0 flex-col overflow-hidden shrink-0 rounded-3xl border border-[var(--divider-subtle)] font-ui text-[var(--text-primary)]"
    >
      <div className="flex min-h-0 min-w-0 shrink-0 flex-col gap-2 px-4 pt-4 pb-3">
        <div className="min-w-0" role="alert" aria-atomic="true">
          <h3 className="m-0 break-words text-[length:var(--font-text-md-size)] font-medium leading-5">
            {permission.title ?? `Allow ${permission.toolName}?`}
          </h3>
          {description && <p className="m-0 mt-0.5 text-[length:var(--text-chat-sm)] text-[var(--text-secondary)]">{description}</p>}
        </div>
        {permission.decisionReason && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 text-[length:var(--font-text-md-size)]">
            <dt className="text-[var(--sidebar-text-muted)]">Reason</dt>
            <dd className="m-0 min-w-0 break-words">{permission.decisionReason}</dd>
          </dl>
        )}
        {!!properties.length && (
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[length:var(--font-text-md-size)]">
            {properties.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-[var(--sidebar-text-muted)]">{key.replace(/_/g, " ")}</dt>
                <dd className="m-0 min-w-0">{key === "content" || typeof value === "object" || String(value).length > 120 ? <details><summary className="cursor-pointer break-words">{key === "content" ? "View proposed content" : typeof value === "object" ? "View full input" : "View value"}</summary><pre className="m-0 mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[length:var(--code-font-size)] leading-[max(1.5em,20px)]">{formatValue(value)}</pre></details> : formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {command && (
        <div className="mx-3 overflow-hidden rounded-md bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)]">
          <pre className="m-0 max-h-80 overflow-auto p-2 font-mono text-[length:var(--code-font-size)] font-medium leading-[max(1.5em,20px)] whitespace-pre-wrap break-words text-[var(--text-secondary)]">{command}</pre>
        </div>
      )}
      {file && (
        <div className="mx-3 flex items-center gap-2 rounded-md border border-[var(--divider-subtle)] bg-[var(--surface-page)] px-2.5 py-2 text-caption">
          <span className="text-[var(--sidebar-text-muted)]">File</span>
          <span className="min-w-0 truncate text-right text-[var(--text-secondary)]" title={file}>{file}</span>
        </div>
      )}
      {permission.toolName === "ExitPlanMode" && plan ? (
        <div className="max-h-72 overflow-auto">
          <Markdown text={plan} />
        </div>
      ) : null}
      {typeof permission.input.old_string === "string" && typeof permission.input.new_string === "string" && (
        <pre className="m-0 max-h-48 overflow-auto rounded-lg border border-[var(--divider-subtle)] bg-[var(--surface-page)] font-mono text-caption leading-5">
          {permission.input.old_string.split("\n").map((line, index) => <div key={`old-${index}`} className="whitespace-pre-wrap bg-[rgba(212,85,85,0.10)] px-2.5">-{line}</div>)}
          {permission.input.new_string.split("\n").map((line, index) => <div key={`new-${index}`} className="whitespace-pre-wrap bg-[rgba(16,185,129,0.10)] px-2.5">+{line}</div>)}
        </pre>
      )}
      <div className="flex shrink-0 justify-end gap-2 px-4 pt-2 pb-4">
        <button
          type="button"
          disabled={!!submitting}
          onClick={() => answer(false, false)}
          className={`noa-approval-button noa-press border border-[var(--divider-subtle)] bg-transparent text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7.5%,transparent)] disabled:opacity-40`}
        >
          {submitting === "deny" ? "Denying…" : "Deny"}
        </button>
        <div className="flex">
          <button
            ref={allowRef}
            type="button"
            disabled={!!submitting}
            onClick={() => answer(true, false)}
            className={`noa-approval-button noa-press border border-transparent bg-[var(--text-primary)] text-[var(--surface-page)] hover:opacity-80 disabled:opacity-40 ${canRemember ? "!rounded-e-none border-e-0 !pe-1" : ""}`}
          >
            {submitting === "allow" ? "Allowing…" : "Allow once"}
          </button>
          {canRemember && (
            <details ref={optionsRef} className="relative">
              <summary
                aria-label="Approval options"
                className="noa-approval-button flex w-6 cursor-pointer list-none items-center justify-center !rounded-s-none border border-transparent border-s-0 bg-[var(--text-primary)] !px-0 text-[var(--surface-page)] [&::-webkit-details-marker]:hidden"
              >
                <ChevronDown size={14} className="opacity-50" aria-hidden="true" />
              </summary>
              <div role="menu" className="noa-floating-panel absolute bottom-full end-0 z-30 mb-1 w-48 rounded-lg bg-[var(--bg-card)] p-1 text-caption">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!!submitting}
                  onClick={() => {
                    if (optionsRef.current) optionsRef.current.open = false
                    answer(true, false)
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] disabled:opacity-50"
                >
                  Allow once
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!!submitting}
                  onClick={() => {
                    if (optionsRef.current) optionsRef.current.open = false
                    answer(true, true)
                  }}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] disabled:opacity-50"
                >
                  {submitting === "remember" ? "Allowing…" : rememberLabel}
                </button>
              </div>
            </details>
          )}
        </div>
      </div>
    </section>
  )
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "—"
}

type Question = {
  question: string
  header: string
  multiSelect?: boolean
  options: { label: string; description: string }[]
}

function QuestionCard({ permission, onAnswer }: PermissionCardProps) {
  const questions = permission.input.questions as Question[]
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const answers = Object.fromEntries(
    questions.map((q) => [
      q.question,
      [...(selected[q.question] ?? []), custom[q.question]?.trim()].filter(Boolean).join(", "),
    ]),
  )
  return (
    <form
      aria-label="Agent needs your input"
      onSubmit={(e) => {
        e.preventDefault()
        onAnswer(permission, true, false, { ...permission.input, answers })
      }}
      className="noa-approval-card flex max-h-[50vh] shrink-0 flex-col gap-3 overflow-auto rounded-3xl border border-[var(--divider-subtle)] p-4"
    >
      {questions.map((q) => (
        <fieldset key={q.question} className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-2 text-body">{q.question}</legend>
          {q.options.map((option) => (
            <label
              key={option.label}
              className="flex cursor-pointer items-start gap-2 rounded-md bg-[var(--surface-page)] px-2 py-1.5 text-body"
            >
              <input
                type={q.multiSelect ? "checkbox" : "radio"}
                name={q.question}
                className="mt-1 accent-[var(--accent-color)]"
                checked={(selected[q.question] ?? []).includes(option.label)}
                onChange={() => {
                  if (!q.multiSelect) setCustom((prev) => ({ ...prev, [q.question]: "" }))
                  setSelected((prev) => ({
                    ...prev,
                    [q.question]: q.multiSelect
                      ? (prev[q.question] ?? []).includes(option.label)
                        ? prev[q.question]!.filter((v) => v !== option.label)
                        : [...(prev[q.question] ?? []), option.label]
                      : [option.label],
                  }))
                }}
              />
              <span>
                {option.label}
                <span className="block text-caption text-[var(--sidebar-text-muted)]">{option.description}</span>
              </span>
            </label>
          ))}
          <input
            aria-label={`Custom answer: ${q.question}`}
            placeholder="Or enter your answer…"
            value={custom[q.question] ?? ""}
            onChange={(e) => {
              setCustom((prev) => ({ ...prev, [q.question]: e.target.value }))
              if (!q.multiSelect) setSelected((prev) => ({ ...prev, [q.question]: [] }))
            }}
            className="min-h-8 rounded-md border border-[var(--divider-subtle)] bg-transparent px-2 text-body outline-none focus:border-[var(--accent-color)]"
          />
        </fieldset>
      ))}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onAnswer(permission, false, false)} className={button}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={Object.values(answers).some((answer) => !answer)}
          className={`${button} bg-[var(--text-primary)] text-[var(--surface-page)] disabled:opacity-40`}
        >
          Continue task
        </button>
      </div>
    </form>
  )
}
