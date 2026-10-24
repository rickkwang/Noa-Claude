import type { CSSProperties, ReactNode } from "react"
import { useIsDark } from "../hooks/useIsDark"
import { themeSurfaces } from "../lib/themePalette"
import { ArrowLeft, ArrowRight, PanelLeft } from "../lib/icons"
import type { AppSettings } from "../types"

const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties

interface TopBarProps {
  settings: AppSettings
  sidebarOpen: boolean
  /** Width the sidebar currently covers; the titlebar stays clear over it so the sidebar runs up behind the traffic lights. */
  sidebarWidth: number
  /** Width the right column covers; the titlebar stays clear over it so the cards start at the top edge. */
  rightWidth: number
  onToggleSidebar: () => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /** Tab strip shown in the titlebar row, as in Noa. */
  center?: ReactNode
  /** Small status text left of the panel toggle. */
  right?: ReactNode
  /** Switch for the right column's cards, placed before the column toggle. */
  panelMenu?: ReactNode
  resizing?: boolean
}

// Noa's TopBar: sidebar toggle at the left edge, panel toggle at the right edge.
export default function TopBar({
  settings,
  sidebarOpen,
  sidebarWidth,
  rightWidth,
  onToggleSidebar,
  canBack,
  canForward,
  onBack,
  onForward,
  center,
  right,
  panelMenu,
  resizing,
}: TopBarProps) {
  const isDark = useIsDark(settings.appearance.theme)
  const titlebarBaseColor = themeSurfaces(isDark).primary
  const buttonClass =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors text-[var(--icon-ink,#52514E)] hover:text-[var(--text-primary,#2D2D2B)] hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_7.5%,transparent)]"
  return (
    <div
      data-titlebar="true"
      className="h-11 grid grid-cols-[auto_minmax(0,1fr)] items-center shrink-0 font-ui relative z-20"
    >
      {/* Drag band stops at the right column, so the column's tabs and toggle get their clicks. */}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 z-0" style={{ ...dragRegion, right: rightWidth }} />
      {/* Paints the titlebar colour only right of the sidebar; behind the content (-z-10 inside this stacking context). */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 -z-10 ${resizing ? "" : "transition-[left,right] duration-500 ease-in-out"}`}
        style={{ left: sidebarWidth, right: rightWidth, backgroundColor: titlebarBaseColor }}
      />
      <div className="flex min-w-0 items-center justify-start pl-[var(--noa-titlebar-inset)] pr-4">
        <div
          className="relative z-50 flex min-w-0 items-center gap-0.5"
          style={{ ...noDragRegion, transform: "translateY(var(--noa-titlebar-lift, 0px))" }}
        >
          <button
            onClick={onToggleSidebar}
            className={buttonClass}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-label="Toggle sidebar"
            aria-pressed={sidebarOpen}
          >
            <PanelLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={!canBack}
            className={`${buttonClass} disabled:pointer-events-none disabled:opacity-40`}
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onForward}
            disabled={!canForward}
            className={`${buttonClass} disabled:pointer-events-none disabled:opacity-40`}
            title="Forward"
            aria-label="Forward"
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <div
        className={`absolute inset-y-0 flex min-w-0 items-center justify-start px-2 ${resizing ? "" : "transition-[left,right] duration-500 ease-in-out"}`}
        style={{ ...noDragRegion, left: sidebarOpen ? sidebarWidth + 12 : 184, right: rightWidth + 52 }}
      >
        {center}
      </div>
      <div className="absolute inset-y-0 flex items-center z-40" style={{ right: 15 }}>
        <div className="relative flex items-center gap-0.5" style={noDragRegion}>
          {right && (
            <span className="px-2 font-mono text-caption text-[var(--sidebar-text-muted,#898781)]">{right}</span>
          )}
          {panelMenu}
        </div>
      </div>
    </div>
  )
}
