import { codexIcons, type CodexIconName } from "../lib/codexIcons"

export function CodexIcon({ name, size = 16, className, ...rest }: {
  name: CodexIconName
  size?: number
  className?: string
  "aria-hidden"?: boolean
}) {
  const icon = codexIcons[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill="none"
      className={className}
      aria-hidden={rest["aria-hidden"] ?? true}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}
