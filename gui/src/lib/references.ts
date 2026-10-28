// The composer appends file references to the prompt as a "Referenced project files" list;
// split it back out so the transcript shows them as attachments instead of message text.
const REFERENCES = /(?:^|\n\n)Referenced project files:\n((?:- "(?:[^"\\]|\\.)*"(?:\n|$))+)$/

export function splitReferences(text: string): { text: string; paths: string[] } {
  const match = text.match(REFERENCES)
  if (!match) return { text, paths: [] }
  const paths: string[] = []
  for (const line of match[1]!.trim().split("\n")) {
    try { paths.push(JSON.parse(line.slice(2))) } catch { return { text, paths: [] } }
  }
  return { text: text.slice(0, match.index).trimEnd(), paths }
}
