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
  onSubmitCode: (code: string) => void
}

export function AuthDialog({ auth, account, onClose, onRetry, onSubmitCode }: AuthDialogProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const [code, setCode] = useState("")
  const [copied, setCopied] = useState(false)
  const [manual, setManual] = useState(false)
  const waiting = auth.status === "waiting"
  const complete = auth.status === "complete"

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    firstActionRef.current?.focus()
    return () => previous?.focus?.()
  }, [complete, waiting])

  // A finished sign-in needs no acknowledgement: show the account briefly, then get out of the way.
  // onClose is an inline prop, so read it through a ref; depending on it would restart the timer on every parent render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!complete) return
    const timer = setTimeout(() => onCloseRef.current(), 1200)
    return () => clearTimeout(timer)
  }, [complete])

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
              {waiting ? (
                <p className="noa-auth-dialog__status">
                  <Loader2 size={14} className="noa-project-dialog__spinner" />
                  Waiting for you to sign in in your browser…
                </p>
              ) : (
                <p>Sign-in did not finish.</p>
              )}
              {auth.error && <p role="alert" className="noa-project-dialog__error">{auth.error}</p>}
              {waiting && manual && (
                <div className="noa-auth-dialog__manual">
                  <p className="noa-auth-dialog__hint">If the browser cannot return to Noa, paste the code Anthropic shows.</p>
                  <form
                    className="noa-auth-dialog__code-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      onSubmitCode(code)
                    }}
                  >
                    <input
                      autoFocus
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="code#state"
                      aria-label="Authorization code and state"
                      autoComplete="one-time-code"
                      spellCheck={false}
                      className="noa-auth-dialog__code"
                    />
                    <button type="submit" disabled={!code.trim()} className="noa-project-dialog__button is-primary">
                      Continue
                    </button>
                  </form>
                </div>
              )}
              {waiting && (
                <div className="noa-auth-dialog__footer">
                  <button
                    ref={firstActionRef}
                    type="button"
                    onClick={() => openAuthPage(auth.automaticUrl)}
                    className="noa-auth-dialog__link"
                  >
                    Reopen browser
                  </button>
                  {manual ? (
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
                      {copied ? "Link copied" : "Copy sign-in link"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setManual(true)} className="noa-auth-dialog__link">
                      Use a code instead
                    </button>
                  )}
                </div>
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
