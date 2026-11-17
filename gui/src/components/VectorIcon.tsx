import { useMemo } from "react"
import { vectorIcons, type VectorIconName } from "../lib/vectorIcons"

export function VectorIcon({ name, size = 16, className, ...rest }: {
  name: VectorIconName
  size?: number
  className?: string
  "aria-hidden"?: boolean
}) {
  const icon = vectorIcons[name]
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
