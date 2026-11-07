import { FileText, Folder, Photo } from "../lib/icons"

// Shown over the conversation pane while files are dragged across it.
export function FileDropOverlay() {
  return (
    <div aria-hidden="true" className="noa-file-drop pointer-events-none absolute inset-0 z-40">
      <div className="absolute inset-0 backdrop-blur-[12px]" />
      <div className="absolute inset-0 bg-[var(--bg-primary)] opacity-60" />
      <div className="absolute inset-3.5 flex flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-[color-mix(in_srgb,var(--accent-color)_45%,transparent)]">
        <div className="flex items-end gap-3 text-[var(--accent-color)]">
          <span className="-rotate-[14deg]"><Photo size={28} className="noa-file-drop-icon [animation-delay:60ms]" /></span>
          <span className="-translate-y-3"><FileText size={28} className="noa-file-drop-icon" /></span>
          <span className="rotate-[14deg]"><Folder size={28} className="noa-file-drop-icon [animation-delay:120ms]" /></span>
        </div>
        <span className="text-body font-medium text-[var(--accent-color)]">Drop files here</span>
      </div>
    </div>
  )
}
