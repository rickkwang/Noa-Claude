// Built-in output styles the Noa CLI accepts as settings.outputStyle.
export const OUTPUT_STYLES: { value: string; label: string; description: string }[] = [
  { value: "default", label: "Default", description: "Noa's standard responses." },
  { value: "Proactive", label: "Proactive", description: "Noa executes immediately, minimizes interruptions, and prefers action over planning." },
  { value: "Concise", label: "Concise", description: "Noa responds tersely, leading with results and skipping preamble and narration." },
  { value: "Explanatory", label: "Explanatory", description: "Noa explains its implementation choices and codebase patterns." },
  { value: "Learning", label: "Learning", description: "Noa pauses and asks you to write small pieces of code for hands-on practice." },
]

// A style name the CLI reports but this list does not know (custom or plugin styles) stays selectable.
export function outputStyleOptions(current?: string): [string, string][] {
  const known = OUTPUT_STYLES.map(({ value, label }): [string, string] => [value, label])
  return current && !known.some(([value]) => value === current) ? [...known, [current, current]] : known
}

export function outputStyleDescription(value?: string): string | undefined {
  return OUTPUT_STYLES.find((style) => style.value === value)?.description
}
