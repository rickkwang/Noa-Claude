import type { Permission } from "../agent/reducer"
import { useState } from "react"
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
  const canRemember = permission.suggestions.length > 0
  return (
    <section
      aria-label={`Permission request for ${permission.toolName}`}
      className="noa-confirm-reveal flex flex-col gap-2 rounded-panel bg-[color-mix(in_srgb,var(--accent-color,#CC7D5E)_10%,transparent)] px-3 py-2.5 font-ui"
    >
      <p className="text-caption leading-relaxed text-[var(--text-primary,#2D2D2B)]">
        {permission.title ?? `Allow ${permission.toolName}?`}
        {permission.description && (
          <span className="block text-[var(--sidebar-text,#52514E)]">{permission.description}</span>
        )}
      </p>
      {permission.toolName === "ExitPlanMode" && typeof permission.input.plan === "string" ? (
        <div className="max-h-72 overflow-auto">
          <Markdown text={permission.input.plan} />
        </div>
      ) : (
        <pre className="m-0 max-h-40 overflow-auto rounded-md bg-[var(--surface-page,#F9F9F7)] px-2.5 py-2 font-mono text-caption whitespace-pre-wrap break-words">
          {JSON.stringify(permission.input, null, 2)}
        </pre>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onAnswer(permission, false, false)}
          className={`${button} bg-[#D45555] text-white border-transparent`}
        >
          Deny
        </button>
        {canRemember && (
          <button
            type="button"
            onClick={() => onAnswer(permission, true, true)}
            className={`${button} bg-[var(--surface-page,#F9F9F7)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,var(--surface-page,#F9F9F7))]`}
          >
            Always allow
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer(permission, true, false)}
          className={`${button} bg-[var(--accent-color,#CC7D5E)] text-white border-transparent`}
        >
          Allow once
        </button>
      </div>
    </section>
  )
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
