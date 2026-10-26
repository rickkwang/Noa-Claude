import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import type { AccountInfo } from "../agent/protocol"
import type { AgentState } from "../agent/reducer"
import { Loader2, X } from "../lib/icons"

interface AuthDialogProps {
  auth: NonNullable<AgentState["auth"]>
  account?: AccountInfo
  onClose: () => void
  onRetry: () => void
  onWait: () => void
  onSubmitCode: (code: string) => void
}

export function AuthDialog({ auth, account, onClose, onRetry, onWait, onSubmitCode }: AuthDialogProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const [code, setCode] = useState("")
  const [copied, setCopied] = useState(false)
  const waiting = auth.status === "waiting"
  const complete = auth.status === "complete"

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    firstActionRef.current?.focus()
    return () => previous?.focus?.()
  }, [complete, waiting])

  function openAuthPage(url?: string) {
    if (!url || !/^https?:\/\//.test(url)) return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable?.length) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  }

  return createPortal(
    <div className="noa-project-dialog" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="noa-project-dialog__panel noa-auth-dialog__panel"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="noa-project-dialog__close"
        >
          <X size={16} />
        </button>

        <h2 id={titleId} className="noa-project-dialog__title">
          {complete ? "Signed in" : "Sign in to Noa"}
        </h2>

        <div className="noa-auth-dialog__body">
          {complete ? (
            <>
              <p>
                {account?.email
                  ? `Signed in as ${account.email}.`
                  : "Your Anthropic account is connected."}
              </p>
              <div className="noa-auth-dialog__actions">
                <button
                  ref={firstActionRef}
                  type="button"
                  onClick={onClose}
                  className="noa-project-dialog__button is-primary"
                >
                  Done
                </button>
              </div>
            </>
          ) : auth.status === "starting" ? (
            <>
              <p className="noa-auth-dialog__status">
                <Loader2 size={14} className="noa-project-dialog__spinner" />
                Preparing secure browser sign-in…
              </p>
              <div className="noa-auth-dialog__actions">
                <button ref={firstActionRef} type="button" onClick={onClose} className="noa-project-dialog__button">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p>
                Noa opens Anthropic's sign-in page in your browser. Return here when the browser confirms your account.
              </p>
              {auth.error && <p role="alert" className="noa-project-dialog__error">{auth.error}</p>}
              {waiting && (
                <>
                  <div className="noa-auth-dialog__actions">
                    <button
                      ref={firstActionRef}
                      type="button"
                      onClick={() => openAuthPage(auth.automaticUrl)}
                      className="noa-project-dialog__button is-primary"
                    >
                      Open sign-in page
                    </button>
                    <button type="button" onClick={onWait} className="noa-project-dialog__button">
                      I've signed in
                    </button>
                  </div>
                  <details className="noa-auth-dialog__manual">
                    <summary>Use a sign-in code instead</summary>
                    <p className="noa-auth-dialog__hint">
                      If the browser cannot redirect to Noa, copy the code shown by Anthropic.
                    </p>
                    <form
                      className="noa-auth-dialog__code-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        onSubmitCode(code)
                      }}
                    >
                      <input
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        placeholder="code#state"
                        aria-label="Authorization code and state"
                        autoComplete="one-time-code"
                        spellCheck={false}
                        className="noa-auth-dialog__code"
                      />
                      <button type="submit" disabled={!code.trim()} className="noa-project-dialog__button">
                        Complete sign-in
                      </button>
                    </form>
                    <button
                      type="button"
                      onClick={() => {
                        if (!auth.manualUrl) return
                        void navigator.clipboard.writeText(auth.manualUrl)
                          .then(() => setCopied(true))
                          .catch(() => {})
                      }}
                      className="noa-auth-dialog__link"
                    >
                      {copied ? "Link copied" : "Copy manual sign-in link"}
                    </button>
                  </details>
                  <button type="button" onClick={onRetry} className="noa-auth-dialog__link">
                    Start over
                  </button>
                </>
              )}
              {!waiting && (
                <div className="noa-auth-dialog__actions">
                  <button type="button" onClick={onClose} className="noa-project-dialog__button">Cancel</button>
                  <button
                    ref={firstActionRef}
                    type="button"
                    onClick={onRetry}
                    className="noa-project-dialog__button is-primary"
                  >
                    Try again
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
