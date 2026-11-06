import { useState } from "react"
import type { ThinkingBlock } from "../agent/toolActivity"
import { ChevronRight } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Markdown } from "./Markdown"

// Live reasoning stays one shimmering line; opening and closing it on its own would make the turn jump.
export function ThinkingActivity({ block }: { block: ThinkingBlock }) {
  const [open, setOpen] = useState(false)
  return <div data-thinking-activity className="not-prose text-[length:var(--font-text-md-size)] text-[var(--text-tertiary)]">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="group/thinking flex items-center gap-1 text-left hover:text-[var(--text-primary)]">
      <span className={!block.done ? "noa-shimmer" : ""}>{block.done ? "Thought" : "Thinking"}</span>
      <ChevronRight size={12} className={`opacity-0 group-hover/thinking:opacity-100 group-focus-visible/thinking:opacity-100 ${open ? "rotate-90" : ""}`} />
    </button>
    <Collapsible open={open}><div className="scrollbar-on-scroll mt-2 max-h-[8.75rem] overflow-auto"><Markdown text={block.text} tone="muted" streaming={!block.done} /></div></Collapsible>
  </div>
}

