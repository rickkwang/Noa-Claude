import { useEffect, useRef, useState } from "react"
import type { ThinkingBlock } from "../agent/toolActivity"
import { ChevronRight } from "../lib/icons"
import { Collapsible } from "./Collapsible"
import { Markdown } from "./Markdown"

// Live reasoning stays one shimmering line; opening and closing it on its own would make the turn jump.
export function ThinkingActivity({ block, verbose = false }: { block: ThinkingBlock; verbose?: boolean }) {
  const [open, setOpen] = useState(verbose)
  const prevVerbose = useRef(verbose)
  useEffect(() => {
    if (prevVerbose.current === verbose) return
    prevVerbose.current = verbose
    setOpen(verbose)
  }, [verbose])
  return <div data-thinking-activity className="not-prose text-[length:var(--font-text-md-size)] text-[var(--text-tertiary)]">
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="group/thinking flex items-center gap-1 text-left hover:text-[var(--text-primary)]">
      <span className={!block.done ? "noa-shimmer" : ""}>{block.done ? "Thought" : "Thinking"}</span>
      <ChevronRight size={12} className={`opacity-0 group-hover/thinking:opacity-100 group-focus-visible/thinking:opacity-100 ${open ? "rotate-90" : ""}`} />
    </button>
    <Collapsible open={open}><div className={`mt-2 ${verbose ? "pb-1" : "scrollbar-on-scroll max-h-[8.75rem] overflow-auto pb-1"}`}><Markdown text={block.text} tone="muted" streaming={!block.done} /></div></Collapsible>
  </div>
}

