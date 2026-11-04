import { useEffect, useRef, useState } from "react"
import type { ProviderInfo } from "../../agent/protocol"
import { Eye, Trash2 } from "../../lib/icons"
import { PROVIDER_CATALOG, type ProviderDraft } from "../../lib/providerCatalog"
import { useConfirm } from "../ConfirmDialog"
import { Row, Section } from "./controls"

const providerField =
  "h-9 w-full rounded-xl border border-[var(--border-default)] bg-transparent px-3 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--sidebar-text-muted)] disabled:opacity-50"
const providerButton =
  "h-8 shrink-0 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 text-body text-[var(--text-primary)] hover:bg-[var(--settings-fill-hover)] disabled:opacity-40"

function hostOf(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function ProviderForm({
  initial,
  provider,
  keyless,
  signIn,
  pending,
  submitLabel,
  onSubmit,
  onDelete,
}: {
  initial: ProviderDraft
  provider?: ProviderInfo
  keyless?: boolean
  // Signs in through /login: no key, endpoint or model to edit, only removal.
  signIn?: boolean
  pending: boolean
  submitLabel: string
  onSubmit: (draft: ProviderDraft) => void
  onDelete?: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [reveal, setReveal] = useState(false)
  const [touched, setTouched] = useState(false)
  const set = (patch: Partial<ProviderDraft>) => {
    setTouched(true)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const changed = !provider || draft.name !== initial.name || draft.baseUrl !== initial.baseUrl || draft.model !== initial.model || draft.apiKey !== ""
  const key = draft.apiKey.trim()
  // Same bar as the CLI's /login: a key that short or all digits is a paste mistake, not a credential.
  const problem =
    draft.baseUrl.includes("YOUR-") ? "Replace the placeholder in the Base URL with your own resource."
    : draft.model.trim() === "" && (!provider || initial.model !== "") ? "Enter a model; the endpoint is asked for it by name."
    : key !== "" && !keyless && (key.length < 8 || /^\d+$/.test(key)) ? "That does not look like an API key."
    : undefined
  const canSubmit = changed && !pending && !problem && draft.name.trim() !== "" && (provider || keyless || key !== "")
  // Inset outlined panel, so the open form reads as detail of its row instead of another list row.
  if (signIn)
    return (
      <div className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-[var(--border-default)] p-4">
        <p className="m-0 flex-1 text-caption text-[var(--sidebar-text-muted)]">This plan signs in with your ChatGPT account through /login, so it has no key or endpoint to edit.</p>
        {onDelete && (
          <button type="button" className={`${providerButton} flex items-center gap-1.5`} disabled={pending} onClick={onDelete}>
            <Trash2 size={14} />
            Remove
          </button>
        )}
      </div>
    )
  return (
    <div className="mx-3 mb-3 flex flex-col gap-3 rounded-xl border border-[var(--border-default)] p-4">
      <label className="flex flex-col gap-1.5 text-chat-sm">
        Name
        <input className={providerField} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5 text-chat-sm">
        API key
        <span className="flex gap-2">
          <input
            className={providerField}
            type={reveal ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={draft.apiKey}
            placeholder={provider?.hasKey ? "Saved. Type to replace" : keyless ? "Optional" : "Paste your API key"}
            onChange={(e) => set({ apiKey: e.target.value })}
          />
          <button type="button" className={`${providerButton} px-2`} aria-label={reveal ? "Hide API key" : "Show API key"} onClick={() => setReveal((r) => !r)}>
            <Eye size={16} />
          </button>
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-chat-sm">
        Base URL
        <input className={providerField} value={draft.baseUrl} spellCheck={false} onChange={(e) => set({ baseUrl: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5 text-chat-sm">
        Default model
        <input className={providerField} value={draft.model} spellCheck={false} placeholder="Model name" onChange={(e) => set({ model: e.target.value })} />
      </label>
      {problem && touched && <p className="m-0 text-caption text-[#C24444]">{problem}</p>}
      <div className="flex items-center gap-2">
        {onDelete && (
          <button type="button" className={`${providerButton} flex items-center gap-1.5`} disabled={pending} onClick={onDelete}>
            <Trash2 size={14} />
            Remove
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={providerButton} disabled={!canSubmit} onClick={() => onSubmit(draft)}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  )
}

export function ProvidersPage({
  providers,
  busy,
  pending,
  onUse,
  onSave,
  onDelete,
}: {
  providers: ProviderInfo[]
  busy: boolean
  pending: boolean
  onUse: (id: string) => void
  onSave: (draft: ProviderDraft) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState<string>()
  const toggle = (key: string) => setOpen((current) => (current === key ? undefined : key))
  const { confirm, dialog } = useConfirm()
  const remove = async (p: ProviderInfo) => {
    if (await confirm({ title: `Remove ${p.name}?`, description: "Its saved API key is deleted too.", confirmLabel: "Remove", danger: true })) onDelete(p.id)
  }
  // A save or removal answers with the refreshed list; collapse the form once it lands.
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !pending) setOpen(undefined)
    wasPending.current = pending
  }, [pending])
  const configuredTypes = new Set(providers.map((p) => p.type))
  const available = PROVIDER_CATALOG.filter((entry) => !configuredTypes.has(entry.type))
  return (
    <>
      <Section title="Configured">
        {providers.map((p) => {
          const detail = [p.typeLabel ?? p.type, p.model, hostOf(p.baseUrl)].filter(Boolean).join(" · ")
          const editable = p.id !== "__anthropic__"
          return (
            <div key={p.id}>
              <Row label={p.name} description={detail}>
                <div className="flex shrink-0 items-center gap-2">
                  {editable && (
                    <button type="button" className={providerButton} aria-expanded={open === p.id} onClick={() => toggle(p.id)}>
                      Edit
                    </button>
                  )}
                  {p.active ? (
                    <span className="flex h-8 items-center rounded-lg bg-[var(--settings-fill-hover)] px-3 text-body">In use</span>
                  ) : (
                    <button type="button" className={providerButton} disabled={busy || pending} title={busy ? "Wait for the current turn to finish" : undefined} onClick={() => onUse(p.id)}>
                      Use
                    </button>
                  )}
                </div>
              </Row>
              {editable && open === p.id && (
                <ProviderForm
                  initial={{ id: p.id, type: p.type, name: p.name, baseUrl: p.baseUrl ?? "", apiKey: "", model: p.model ?? "" }}
                  provider={p}
                  signIn={p.type === "chatgpt"}
                  pending={pending}
                  submitLabel="Save"
                  onSubmit={onSave}
                  onDelete={p.active ? undefined : () => void remove(p)}
                />
              )}
            </div>
          )
        })}
      </Section>
      {providers.some((p) => p.active && p.id !== "__anthropic__") && busy && (
        <p className="-mt-6 text-caption text-[var(--sidebar-text-muted)]">
          While a turn is running, edits to the provider in use are saved but only reach this chat after you switch away and back.
        </p>
      )}
      <Section title="Available providers">
        {available.map((entry) => (
          <div key={entry.type}>
            <Row label={entry.label} description={entry.description}>
              <button type="button" className={providerButton} aria-expanded={open === `new:${entry.type}`} onClick={() => toggle(`new:${entry.type}`)}>
                Set up
              </button>
            </Row>
            {open === `new:${entry.type}` && (
              <ProviderForm
                initial={{ type: entry.type, name: entry.label, baseUrl: entry.baseUrl, apiKey: "", model: entry.model }}
                keyless={entry.keyless}
                pending={pending}
                submitLabel="Add"
                onSubmit={onSave}
              />
            )}
          </div>
        ))}
        <div>
          <Row label="Custom endpoint" description="Any OpenAI-compatible server">
            <button type="button" className={providerButton} aria-expanded={open === "new:custom"} onClick={() => toggle("new:custom")}>
              Set up
            </button>
          </Row>
          {open === "new:custom" && (
            <ProviderForm
              initial={{ type: "openai", name: "Custom", baseUrl: "", apiKey: "", model: "" }}
              pending={pending}
              submitLabel="Add"
              onSubmit={onSave}
            />
          )}
        </div>
      </Section>
      {dialog}
    </>
  )
}
