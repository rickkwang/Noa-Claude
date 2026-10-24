import type { Permission } from "../agent/reducer"
import { useEffect, useRef, useState } from "react"
import { IconShieldCheck } from "@tabler/icons-react"
import { Markdown } from "./Markdown"

interface PermissionCardProps {
  permission: Permission
  onAnswer: (permission: Permission, allow: boolean, remember: boolean, updatedInput?: Record<string, unknown>) => void
}

const button =
  "noa-confirm-btn h-6 rounded-md px-3 text-caption min-w-16 text-center border border-[var(--divider-subtle)] noa-press"

// Noa's confirmation reveal: an accent-tinted strip with small text buttons.
export function PermissionCard({ permission, onAnswer }: PermissionCardProps) {
  if (permission.toolName === "AskUserQuestion" && Array.isArray(permission.input.questions))
    return <QuestionCard permission={permission} onAnswer={onAnswer} />
  return <ToolPermissionCard permission={permission} onAnswer={onAnswer} />
}

function ToolPermissionCard({ permission, onAnswer }: PermissionCardProps) {
  const canRemember = permission.suggestions.length > 0
  const [submitting, setSubmitting] = useState<"allow" | "remember" | "deny">()
  const denyRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    denyRef.current?.focus()
  }, [permission.requestId])
  function answer(allow: boolean, remember: boolean) {
    setSubmitting(remember ? "remember" : allow ? "allow" : "deny")
    onAnswer(permission, allow, remember)
  }
  const properties = Object.entries(permission.input).filter(([key]) => !["command", "file_path", "content", "old_string", "new_string", "plan", "questions"].includes(key))
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
          answer(false, false)
        }
      }}
      className="noa-confirm-reveal flex flex-col gap-2 rounded-panel bg-[color-mix(in_srgb,var(--accent-color,#CC7D5E)_10%,transparent)] px-3 py-2.5 font-ui"
    >
      <div className="flex items-start gap-2">
        <IconShieldCheck size={17} stroke={1.5} className="mt-0.5 shrink-0 text-[var(--accent-color)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-body font-medium text-[var(--text-primary,#2D2D2B)]">
            {permission.title ?? `Allow ${permission.toolName}?`}
          </h3>
          {(permission.description || permission.decisionReason) && (
            <p className="m-0 mt-0.5 text-caption leading-relaxed text-[var(--sidebar-text,#52514E)]">
              {permission.description ?? permission.decisionReason}
            </p>
          )}
        </div>
      </div>
      {!!properties.length && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-[var(--divider-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_80%,transparent)] px-2.5 py-2 text-caption">
          {properties.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-[var(--sidebar-text-muted)]">{key.replace(/_/g, " ")}</dt>
              <dd className="m-0 min-w-0 truncate text-right text-[var(--text-secondary)]" title={formatValue(value)}>{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {command && (
        <div className="overflow-hidden rounded-lg border border-[var(--divider-subtle)] bg-[var(--surface-page)]">
          <div className="border-b border-[var(--divider-subtle)] px-2.5 py-1 text-caption text-[var(--sidebar-text-muted)]">Command</div>
          <pre className="m-0 max-h-32 overflow-auto px-2.5 py-2 font-mono text-caption whitespace-pre-wrap break-words">{command}</pre>
        </div>
      )}
      {file && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--divider-subtle)] bg-[var(--surface-page)] px-2.5 py-2 text-caption">
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
      <div className="flex justify-end gap-2">
        <button
          ref={denyRef}
          type="button"
          disabled={!!submitting}
          onClick={() => answer(false, false)}
          className={`${button} bg-[#D45555] text-white border-transparent disabled:opacity-50`}
        >
          {submitting === "deny" ? "Denying…" : "Deny"}
        </button>
        {canRemember && (
          <button
            type="button"
            disabled={!!submitting}
            onClick={() => answer(true, true)}
            className={`${button} bg-[var(--surface-page,#F9F9F7)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,var(--surface-page,#F9F9F7))] disabled:opacity-50`}
          >
            {submitting === "remember" ? "Allowing…" : "Always allow"}
          </button>
        )}
        <button
          type="button"
          disabled={!!submitting}
          onClick={() => answer(true, false)}
          className={`${button} bg-[var(--accent-color,#CC7D5E)] text-white border-transparent disabled:opacity-50`}
        >
          {submitting === "allow" ? "Allowing…" : "Allow once"}
        </button>
      </div>
    </section>
  )
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}…` : value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`
  if (value && typeof value === "object") return `${Object.keys(value).length} fields`
  return "—"
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
      className="noa-confirm-reveal flex max-h-[50vh] flex-col gap-3 overflow-auto rounded-panel bg-[var(--bg-card)] p-3 shadow-[0_0_0_1px_var(--divider-subtle)]"
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
          className={`${button} bg-[var(--accent-color)] text-white disabled:opacity-40`}
        >
          Continue task
        </button>
      </div>
    </form>
  )
}
