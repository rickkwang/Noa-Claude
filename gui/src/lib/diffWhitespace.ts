import { diffArrays } from "diff"

// "Hide whitespace changes", as Claude Code rewrites a patch client-side: a run of removed/added lines
// that only differs in leading or trailing blanks becomes context, and a hunk left without real changes
// is dropped. Runs larger than these bounds keep every line rather than risk a slow comparison.
const MAX_RUN_LINES = 2000
const MAX_EDIT_LENGTH = 400
const NO_NEWLINE = "\\ No newline at end of file"

const blank = (code: number) => code === 32 || code === 9 || code === 13
function trimBlanks(line: string) {
  let start = 0, end = line.length
  while (start < end && blank(line.charCodeAt(start))) start++
  while (end > start && blank(line.charCodeAt(end - 1))) end--
  return line.slice(start, end)
}

export type HunkLines = {
  lines: string[]
  // Real (non-whitespace) changes remain.
  changed: boolean
  // Some removed/added lines were turned into context.
  altered: boolean
}

// `lines` are one hunk's body lines with their "-", "+", " " or "\" prefix.
export function hideWhitespaceChanges(lines: string[]): HunkLines {
  const out: string[] = []
  let changed = false, altered = false
  for (let i = 0; i < lines.length;) {
    const sign = lines[i]![0]
    if (sign !== "-" && sign !== "+") { out.push(lines[i]!); i++; continue }
    const dels: string[] = [], adds: string[] = []
    let delNoEol = false, addNoEol = false, end = i
    for (; end < lines.length; end++) {
      const line = lines[end]!
      if (line[0] === "-") dels.push(line.slice(1))
      else if (line[0] === "+") adds.push(line.slice(1))
      else if (line[0] === "\\") { if (adds.length === 0) delNoEol = true; else addNoEol = true }
      else break
    }
    if (delNoEol === addNoEol && dels.length === adds.length && dels.every((line, k) => trimBlanks(line) === trimBlanks(adds[k]!))) {
      for (const line of adds) out.push(` ${line}`)
      if (addNoEol) out.push(NO_NEWLINE)
      altered = true
      i = end
      continue
    }
    const parts = !delNoEol && !addNoEol && dels.length > 0 && adds.length > 0 && dels.length + adds.length <= MAX_RUN_LINES
      ? diffArrays(dels.map(trimBlanks), adds.map(trimBlanks), { maxEditLength: MAX_EDIT_LENGTH })
      : undefined
    if (!parts) {
      for (let k = i; k < end; k++) out.push(lines[k]!)
      changed = true
    } else {
      let d = 0, a = 0
      for (const part of parts) {
        const count = part.count ?? part.value.length
        if (part.removed) { changed = true; for (let n = 0; n < count; n++) out.push(`-${dels[d++]}`); continue }
        if (part.added) changed = true
        else altered = true
        for (let n = 0; n < count; n++) out.push(`${part.added ? "+" : " "}${adds[a++]}`)
        if (!part.added) d += count
      }
    }
    i = end
  }
  return { lines: out, changed, altered }
}
