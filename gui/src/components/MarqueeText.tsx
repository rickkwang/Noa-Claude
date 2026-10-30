import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

// Codex-style scroll speed: 2em per second after a 0.35s hold.
const SPEED_EM_PER_SECOND = 2
const HOLD_SECONDS = 0.35

type Overflow = { distance: number; seconds: number }

// Single-line text that fades at the edges when it overflows and, while an ancestor `.group` is hovered,
// scrolls once to its end. The scroll itself lives in CSS (`.noa-marquee`).
export function MarqueeText({ children, className = "" }: { children: ReactNode; className?: string }) {
  const viewport = useRef<HTMLSpanElement>(null)
  const content = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState<Overflow | null>(null)

  useLayoutEffect(() => {
    const view = viewport.current
    const text = content.current
    if (!view || !text) return
    const measure = () => {
      const distance = text.getBoundingClientRect().width - view.getBoundingClientRect().width
      if (distance < 1) return setOverflow(null)
      const fontSize = Number.parseFloat(getComputedStyle(text).fontSize) || 13
      const seconds = distance / (fontSize * SPEED_EM_PER_SECOND)
      setOverflow((prev) => (prev && prev.distance === distance && prev.seconds === seconds ? prev : { distance, seconds }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(view)
    observer.observe(text)
    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={viewport}
      className={`noa-marquee ${overflow ? "is-overflowing" : ""} ${className}`}
      style={overflow ? ({ "--marquee-distance": `${overflow.distance}px`, "--marquee-duration": `${overflow.seconds}s`, "--marquee-hold": `${HOLD_SECONDS}s` } as React.CSSProperties) : undefined}
      data-marquee-overflowing={overflow ? "" : undefined}
    >
      <span className="noa-marquee-clip">
        <span className="noa-marquee-track">
          <span ref={content} className="noa-marquee-content">{children}</span>
        </span>
      </span>
    </span>
  )
}
