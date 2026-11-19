import { useEffect, useRef, useState } from "react"
import type { ProviderInfo } from "../../agent/protocol"
import { Check, Eye, EyeOff, Trash2 } from "../../lib/icons"
import { PROVIDER_CATALOG, type ProviderDraft } from "../../lib/providerCatalog"
import { ProviderIcon } from "../ProviderIcon"
import { useConfirm } from "../ConfirmDialog"
import { Row, Section, actionButton, dangerButton, fieldInput, iconActionButton, primaryButton } from "./controls"

function ProviderForm({
  initial,
  provider,
  keyless,
  signIn,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
  onFetchModels,
  onDirtyChange,
}: {
  initial: ProviderDraft
  provider?: ProviderInfo
  keyless?: boolean
  // Signs in through /login: no key, endpoint or model to edit, only removal.
  signIn?: boolean
  pending: boolean
  submitLabel: string
  onSubmit: (draft: ProviderDraft) => void
  onCancel: () => void
  onDelete?: () => void
  onFetchModels: (draft: ProviderDraft) => Promise<string[]>
  onDirtyChange: (dirty: boolean) => void
}) {
  const formRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(initial)
  const [reveal, setReveal] = useState(false)
  const [touched, setTouched] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [showAllModels, setShowAllModels] = useState(false)
  // A saved list shows straight away; fetching replaces it.
  const [fetched, setFetched] = useState<{ models: string[]; error?: string } | undefined>(
    provider?.models?.length ? { models: provider.models } : undefined,
  )

  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest" })
  }, [])

  const fetchModels = async () => {
    setFetching(true)
    setShowAllModels(false)
    try {
      setFetched({ models: await onFetchModels(draft) })
    } catch (error) {
      setFetched({ models: [], error: error instanceof Error ? error.message : String(error) })
    } finally {
      setFetching(false)
    }
  }
  const set = (patch: Partial<ProviderDraft>) => {
    setTouched(true)
    setDraft((d) => ({ ...d, ...patch }))
  }
  const formDirty =
    !signIn &&
    (draft.name !== initial.name ||
      draft.baseUrl !== initial.baseUrl ||
      draft.model !== initial.model ||
      draft.apiKey !== "")
  useEffect(() => {
    onDirtyChange(formDirty)
  }, [formDirty, onDirtyChange])

  const changed = !provider || formDirty
  const key = draft.apiKey.trim()
  // Same bar as the CLI's /login: a key that short or all digits is a paste mistake, not a credential.
  const problem =
    draft.baseUrl.includes("YOUR-") ? "Replace the placeholder in the Base URL with your own resource."
    : draft.model.trim() === "" && (!provider || initial.model !== "") ? "Enter a model; the endpoint is asked for it by name."
    : key !== "" && !keyless && (key.length < 8 || /^\d+$/.test(key)) ? "That does not look like an API key."
    : undefined
  const canSubmit = changed && !pending && !problem && draft.name.trim() !== "" && (provider || keyless || key !== "")
  const submitDisabledReason = !canSubmit
    ? problem ??
      (pending
        ? "Saving…"
        : !changed
          ? "Make a change to save"
          : draft.name.trim() === ""
            ? "Enter a provider name"
            : !provider && !keyless && key === ""
              ? "Enter an API key"
              : undefined)
    : undefined

  const modelQuery = draft.model.trim().toLowerCase()
  const exactModelMatch = Boolean(fetched?.models.some((name) => name.toLowerCase() === modelQuery))
  const isFilteringModels = Boolean(fetched?.models.length && modelQuery && !exactModelMatch && !showAllModels)
  const visibleModels = fetched?.models.length
    ? isFilteringModels
      ? fetched.models.filter((name) => name.toLowerCase().includes(modelQuery))
      : fetched.models
    : []

  // Inset outlined panel, so the open form reads as detail of its row instead of another list row.
  if (signIn)
    return (
      <div ref={formRef} className="mx-3 mb-3 flex items-center gap-3 rounded-xl border border-[var(--border-default)] p-4">
        <p className="m-0 flex-1 text-caption text-[var(--sidebar-text-muted)]">
          This plan signs in with your ChatGPT account through /login, so it has no key or endpoint to edit.
        </p>
        {onDelete && (
          <button type="button" className={dangerButton} disabled={pending} onClick={onDelete}>
            <Trash2 size={14} />
            Remove
          </button>
        )}
        <button type="button" className={actionButton} disabled={pending} onClick={onCancel}>
          Close
        </button>
      </div>
    )
  return (
    <div ref={formRef} className="mx-3 mb-3 flex flex-col gap-3 rounded-xl border border-[var(--border-default)] p-4">
      <label className="flex flex-col gap-1.5 text-chat-sm">
        Name
        <input className={`${fieldInput} h-8`} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5 text-chat-sm">
        <span className="flex items-center justify-between">
          API key
          {provider?.hasKey && draft.apiKey === "" && (
            <span className="flex items-center gap-1 text-caption font-normal text-[var(--sidebar-text-muted)]">
              <Check size={12} aria-hidden="true" />
              Saved
            </span>
          )}
        </span>
        <span className="flex gap-2">
          <input
            className={`${fieldInput} h-8`}
            type={reveal ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={draft.apiKey}
            placeholder={provider?.hasKey ? "••••••••••••••••" : keyless ? "Optional" : "Paste your API key"}
            onChange={(e) => set({ apiKey: e.target.value })}
          />
          {/* A saved key stays on the agent side, so there is nothing to reveal until a new one is typed. */}
          {draft.apiKey !== "" && (
            <button
              type="button"
              className={iconActionButton}
              aria-label={reveal ? "Hide API key" : "Show API key"}
              title={reveal ? "Hide API key" : "Show API key"}
              onClick={() => setReveal((r) => !r)}
            >
              {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-chat-sm">
        Base URL
        <input className={`${fieldInput} h-8`} value={draft.baseUrl} spellCheck={false} onChange={(e) => set({ baseUrl: e.target.value })} />
      </label>
      <div className="flex flex-col gap-1.5 text-chat-sm">
        <div className="flex items-center justify-between">
          <span>Default model</span>
          <button
            type="button"
            className={actionButton}
            disabled={fetching || !draft.baseUrl.trim()}
            onClick={() => void fetchModels()}
          >
            {fetching ? "Fetching…" : "Fetch models"}
          </button>
        </div>
        <input
          aria-label="Default model"
          className={`${fieldInput} h-8`}
          value={draft.model}
          spellCheck={false}
          placeholder="Model name"
          onChange={(e) => {
            setShowAllModels(false)
            set({ model: e.target.value })
          }}
        />
        {fetched?.models.length ? (
          visibleModels.length ? (
            <div className="flex flex-col gap-1 pt-0.5">
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {visibleModels.map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={draft.model === name}
                    onClick={() => set({ model: name })}
                    className={`h-6 rounded-md px-2 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/35 ${
                      draft.model === name
                        ? "bg-[var(--settings-fill-active)] font-medium text-[var(--text-primary)]"
                        : "text-[var(--sidebar-text-muted)] hover:bg-[var(--settings-fill-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {isFilteringModels && visibleModels.length < fetched.models.length && (
                <div className="flex items-center justify-between text-caption text-[var(--sidebar-text-muted)]">
                  <span>
                    Showing {visibleModels.length} of {fetched.models.length} models
                  </span>
                  <button
                    type="button"
                    className="underline hover:text-[var(--text-primary)]"
                    onClick={() => setShowAllModels(true)}
                  >
                    Show all ({fetched.models.length})
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between pt-0.5 text-caption text-[var(--sidebar-text-muted)]">
              <span>No matching models</span>
              <button
                type="button"
                className="underline hover:text-[var(--text-primary)]"
                onClick={() => setShowAllModels(true)}
              >
                Show all ({fetched.models.length})
              </button>
            </div>
          )
        ) : fetched && !fetched.error ? (
          <p className="m-0 text-caption text-[var(--sidebar-text-muted)]">The endpoint returned no models.</p>
        ) : null}
        {fetched?.error && <p className="m-0 text-caption text-[var(--text-danger)]">{fetched.error}</p>}
      </div>
      {problem && touched && <p className="m-0 text-caption text-[var(--text-danger)]">{problem}</p>}
      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <button type="button" className={dangerButton} disabled={pending} onClick={onDelete}>
            <Trash2 size={14} />
            Remove
          </button>
        )}
        <span className="flex-1" />
        <button type="button" className={actionButton} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={!canSubmit}
          title={submitDisabledReason}
          onClick={() => onSubmit(draft)}
        >
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
  error,
  onUse,
  onSave,
  onDelete,
  onFetchModels,
  onDirtyChange,
}: {
  providers: ProviderInfo[]
  busy: boolean
  pending: boolean
  error?: string
  onUse: (id: string) => void
  onSave: (draft: ProviderDraft) => void
  onDelete: (id: string) => void
  onFetchModels: (draft: ProviderDraft) => Promise<string[]>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [open, setOpen] = useState<string>()
  const [formDirty, setFormDirty] = useState(false)
  const { confirm, dialog } = useConfirm()

  useEffect(() => {
    onDirtyChange?.(Boolean(open) && formDirty)
  }, [open, formDirty, onDirtyChange])

  const closeForm = async () => {
    if (!open) return true
    if (
      formDirty &&
      !(await confirm({
        title: "Discard unsaved changes?",
        description: "Your provider changes have not been saved.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        danger: true,
      }))
    ) {
      return false
    }
    setOpen(undefined)
    setFormDirty(false)
    return true
  }

  const toggle = async (key: string) => {
    if (open === key) {
      await closeForm()
      return
    }
    if (!(await closeForm())) return
    setOpen(key)
    setFormDirty(false)
  }

  const remove = async (p: ProviderInfo) => {
    if (await confirm({ title: `Remove ${p.name}?`, description: "Its saved API key is deleted too.", confirmLabel: "Remove", danger: true })) {
      pendingActionRef.current = "form"
      onDelete(p.id)
    }
  }
  const submitForm = (draft: ProviderDraft) => {
    pendingActionRef.current = "form"
    onSave(draft)
  }
  const useProvider = (id: string) => {
    pendingActionRef.current = "use"
    onUse(id)
  }
  // A form save or removal answers with the refreshed list; collapse the form once it lands without error.
  const wasPending = useRef(false)
  const pendingActionRef = useRef<"form" | "use" | null>(null)
  useEffect(() => {
    if (wasPending.current && !pending) {
      if (pendingActionRef.current === "form" && !error) {
        setOpen(undefined)
        setFormDirty(false)
      }
      pendingActionRef.current = null
    }
    wasPending.current = pending
  }, [pending, error])
  const configuredTypes = new Set(providers.map((p) => p.type))
  const available = PROVIDER_CATALOG.filter((entry) => !configuredTypes.has(entry.type))
  return (
    <>
      {error && (
        <p role="alert" className="m-0 rounded-xl border border-[var(--text-danger)]/40 bg-[var(--text-danger)]/10 px-3 py-2 text-caption text-[var(--text-danger)]">
          {error}
        </p>
      )}
      <Section title="Configured">
        {providers.map((p) => {
          // The name already says which provider this is; the model is the one detail that changes what runs.
          const detail = p.model ?? ""
          const editable = p.id !== "__anthropic__"
          return (
            <div key={p.id}>
              <Row label={p.name} description={detail} icon={<ProviderIcon type={p.id === "c3aee1e0-34b9-4363-be13-e9db4fe0bb33" ? "magpie" : p.type} size={16} />}>
                <div className="flex shrink-0 items-center gap-2">
                  {editable && (
                    <button type="button" className={actionButton} aria-expanded={open === p.id} onClick={() => void toggle(p.id)}>
                      Edit
                    </button>
                  )}
                  {p.active ? (
                    <span className="flex h-7 items-center rounded-[10px] bg-[var(--settings-fill-active)] px-3 text-body font-medium">In use</span>
                  ) : (
                    <button type="button" className={actionButton} disabled={busy || pending} title={busy ? "Wait for the current turn to finish" : undefined} onClick={() => useProvider(p.id)}>
                      Use
                    </button>
                  )}
                </div>
              </Row>
              {editable && open === p.id && (
                <ProviderForm
                  key={p.id}
                  initial={{ id: p.id, type: p.type, name: p.name, baseUrl: p.baseUrl ?? "", apiKey: "", model: p.model ?? "" }}
                  provider={p}
                  signIn={p.type === "chatgpt"}
                  pending={pending}
                  submitLabel="Save"
                  onSubmit={submitForm}
                  onCancel={() => void closeForm()}
                  onFetchModels={onFetchModels}
                  onDirtyChange={setFormDirty}
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
            <Row label={entry.label} description={entry.description} icon={<ProviderIcon type={entry.type} size={16} />}>
              <button type="button" className={actionButton} aria-expanded={open === `new:${entry.type}`} onClick={() => void toggle(`new:${entry.type}`)}>
                Set up
              </button>
            </Row>
            {open === `new:${entry.type}` && (
              <ProviderForm
                key={`new:${entry.type}`}
                initial={{ type: entry.type, name: entry.label, baseUrl: entry.baseUrl, apiKey: "", model: entry.model }}
                keyless={entry.keyless}
                pending={pending}
                submitLabel="Add"
                onSubmit={submitForm}
                onCancel={() => void closeForm()}
                onFetchModels={onFetchModels}
                onDirtyChange={setFormDirty}
              />
            )}
          </div>
        ))}
        <div>
          <Row label="Custom endpoint" description="Any OpenAI-compatible server">
            <button type="button" className={actionButton} aria-expanded={open === "new:custom"} onClick={() => void toggle("new:custom")}>
              Set up
            </button>
          </Row>
          {open === "new:custom" && (
            <ProviderForm
              key="new:custom"
              initial={{ type: "openai", name: "Custom", baseUrl: "", apiKey: "", model: "" }}
              pending={pending}
              submitLabel="Add"
              onSubmit={submitForm}
              onCancel={() => void closeForm()}
              onFetchModels={onFetchModels}
              onDirtyChange={setFormDirty}
            />
          )}
        </div>
      </Section>
      {dialog}
    </>
  )
}
