import { useEffect, useRef, useState } from "react"
import type { ThinkingBlock } from "../agent/toolActivity"
import { WorkingOrb } from "./WorkingOrb"
import { ChevronRight } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Markdown } from "./Markdown"

// Live reasoning stays one shimmering line; opening and closing it on its own would make the turn jump.
export function ThinkingActivity({ block, expanded = false }: { block: ThinkingBlock; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded)
  const prevExpanded = useRef(expanded)
  useEffect(() => {
    if (prevExpanded.current === expanded) return
    prevExpanded.current = expanded
    setOpen(expanded)
  }, [expanded])
  return <div data-thinking-activity className="not-prose text-[length:var(--font-text-md-size)] text-[var(--text-tertiary)]">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="group/thinking flex items-center gap-1.5 text-left hover:text-[var(--text-primary)]">
      {block.done ? <span className="w-4 shrink-0" aria-hidden="true" /> : <WorkingOrb size={16} />}
      <span className={!block.done ? "noa-shimmer" : ""}>{block.done ? "Thought" : "Thinking"}</span>
      <ChevronRight size={12} className={`opacity-0 group-hover/thinking:opacity-100 group-focus-visible/thinking:opacity-100 ${open ? "rotate-90" : ""}`} />
    </button>
    <Collapsible open={open}><div className={`ms-[22px] mt-2 ${expanded ? "pb-1" : "scrollbar-on-scroll noa-scroll-fade [--edge-fade-distance:20px] max-h-[8.75rem] overflow-auto pb-1"}`}><Markdown text={block.text} tone="muted" streaming={!block.done} /></div></Collapsible>
  </div>
}

