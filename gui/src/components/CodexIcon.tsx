import { useMemo } from "react"
import { codexIcons, type CodexIconName } from "../lib/codexIcons"

export function CodexIcon({ name, size = 16, className, ...rest }: {
  name: CodexIconName
  size?: number
  className?: string
  "aria-hidden"?: boolean
}) {
  const icon = codexIcons[name]
  // A fresh object each render makes React re-parse the markup.
  const html = useMemo(() => ({ __html: icon.body }), [icon])
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
      dangerouslySetInnerHTML={html}
    />
  )
}
