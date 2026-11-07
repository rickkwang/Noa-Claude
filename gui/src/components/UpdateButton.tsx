import { useEffect, useState } from "react"
import type { AppUpdateState } from "../types"
import { useConfirm } from "./ConfirmDialog"

// Ring for download progress, drawn in the current text colour over a faint track.
function ProgressRing({ percent }: { percent: number }) {
  const size = 14, stroke = 2, radius = (size - stroke) / 2
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="none" opacity={0.2} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="none"
        strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={100 - percent}
        opacity={percent > 0 ? 1 : 0} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="noa-update-ring"
      />
    </svg>
  )
}

function DownloadTrayIcon() {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path className="noa-update-arrow" d="M8 2.5v6.5M5.25 6.5 8 9.25l2.75-2.75" />
      <path d="M2.75 9.5v1.75c0 1.1.9 2 2 2h6.5c1.1 0 2-.9 2-2V9.5" />
    </svg>
  )
}

function useUpdateState() {
  const [state, setState] = useState<AppUpdateState>({ status: "idle" })
  useEffect(() => {
    const updates = window.noaDesktop?.updates
    if (!updates) return
    // Subscribe first, and let a pushed state win over the initial read that may resolve after it.
    let live = true, pushed = false
    const unsubscribe = updates.subscribe((next) => { pushed = true; setState(next) })
    void updates.getState().then((next) => { if (live && !pushed && next) setState(next) })
    return () => { live = false; unsubscribe() }
  }, [])
  return state
}

// Sits at the end of the sidebar's Settings row once a newer desktop build is downloading or ready.
// Only the actionable state takes the accent colour; a download in progress stays quiet.
export function UpdateButton() {
  const state = useUpdateState()
  const { confirm, dialog } = useConfirm()
  if (state.status === "idle") return null

  if (state.status === "downloading") {
    return (
      <span
        role="progressbar"
        aria-label="Downloading update"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.percent}
        title={`Downloading Noa Agent ${state.version}`}
        className="noa-update-button noa-update-progress flex h-6 shrink-0 cursor-default items-center gap-1.5 rounded-full pl-1.5 pr-2 text-caption tabular-nums text-[var(--sidebar-text-muted)]"
      >
        <ProgressRing percent={state.percent} />
        {state.percent}%
      </span>
    )
  }

  const installing = state.status === "installing"
  const install = async () => {
    const confirmed = await confirm({
      title: "Update Noa Agent now?",
      description: `Noa Agent ${state.version} is ready. Noa Agent will quit to install the update, which stops tasks running on this computer.`,
      confirmLabel: "Update",
    })
    if (confirmed) await window.noaDesktop?.updates?.install()
  }
  return (
    <>
      <button
        type="button"
        disabled={installing}
        onClick={() => void install()}
        title={installing ? undefined : `Install Noa Agent ${state.version}`}
        className="noa-update-button noa-update-pill flex h-6 shrink-0 items-center gap-1 rounded-full pl-2 pr-2.5 text-caption font-medium"
      >
        {installing
          ? <span aria-hidden="true" className="noa-update-spinner size-3 rounded-full border-[1.5px] border-current border-r-transparent" />
          : <DownloadTrayIcon />}
        {installing ? "Installing…" : "Update"}
      </button>
      {dialog}
    </>
  )
}
