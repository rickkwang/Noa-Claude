import { useMemo } from "react"
import { providerIcons } from "../lib/providerIcons"

export function ProviderIcon({ type, size = 16, className }: { type: string; size?: number; className?: string }) {
  const icon = providerIcons[type]
  // A fresh object each render makes React re-parse the markup.
  const html = useMemo(() => ({ __html: icon?.body ?? "" }), [icon])
  if (!icon) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="currentColor"
      className={`shrink-0 ${className ?? ""}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={html}
    />
  )
}
