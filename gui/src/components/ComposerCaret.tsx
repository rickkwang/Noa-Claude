import { useEffect, useLayoutEffect, useRef, type RefObject } from "react"

// Computed properties that decide where text wraps and how wide each glyph is.
const MIRRORED = [
  "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant", "font-feature-settings",
  "font-variation-settings", "font-kerning", "letter-spacing", "word-spacing", "text-transform", "text-indent",
  "text-rendering", "tab-size", "line-height", "direction", "word-break", "overflow-wrap", "line-break", "hyphens",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
]
// A same-line move at least this long leaves a fading trail (more than a typed character).
const TRAIL_MIN = 24
const TRAIL_MAX = 96
// Solid while the caret moves, blinking again after this pause.
const BLINK_DELAY = 500

/**
 * A caret drawn over the textarea that slides to each new position. The native caret is
 * hidden by the caller (caret-color: transparent); this measures the caret position in an
 * offscreen copy of the text that wraps exactly like the textarea.
 */
export function ComposerCaret({ textareaRef, value, disabled }: { textareaRef: RefObject<HTMLTextAreaElement | null>; value: string; disabled?: boolean }) {
  const caretRef = useRef<HTMLDivElement>(null)
  const state = useRef<{ mirror?: HTMLDivElement; signature?: string; last?: { x: number; y: number }; frame?: number; blink?: number; trailAt: number; reduced: boolean }>({ trailAt: 0, reduced: false })

  const syncMirrorStyle = (textarea: HTMLTextAreaElement) => {
    const s = state.current
    const style = getComputedStyle(textarea)
    const signature = `${textarea.clientWidth}|${MIRRORED.map((name) => style.getPropertyValue(name)).join("|")}`
    let mirror = s.mirror
    if (!mirror) {
      mirror = s.mirror = document.createElement("div")
      mirror.setAttribute("aria-hidden", "true")
      document.body.appendChild(mirror)
    }
    if (s.signature !== signature) {
      s.signature = signature
      mirror.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;contain:layout style paint;white-space:pre-wrap;box-sizing:border-box;border:0;width:${textarea.clientWidth}px;${MIRRORED.map((name) => `${name}:${style.getPropertyValue(name)}`).join(";")}`
    }
    return mirror
  }

  const update = () => {
    const s = state.current
    const textarea = textareaRef.current
    const caret = caretRef.current
    const host = caret?.offsetParent
    if (!textarea || !caret || !host) return
    const hide = () => {
      caret.dataset.visible = "false"
      caret.dataset.blink = "false"
      window.clearTimeout(s.blink)
      s.last = undefined
    }
    if (!document.hasFocus() || document.activeElement !== textarea || textarea.readOnly || textarea.disabled || textarea.selectionStart !== textarea.selectionEnd) return hide()

    const mirror = s.mirror ?? syncMirrorStyle(textarea)
    // Measure the character after the caret, which puts the caret at the start of a
    // soft-wrapped line as the native one is. Before a newline or at the end there is no
    // such box (an empty line has none at all), so a zero-width space stands in for it.
    const text = textarea.value
    const position = textarea.selectionStart
    const stand = position === text.length || text[position] === "\n"
    mirror.textContent = stand ? `${text.slice(0, position)}​${text.slice(position)}` : text
    const range = document.createRange()
    range.setStart(mirror.firstChild as Text, position)
    range.setEnd(mirror.firstChild as Text, position + 1)
    const box = range.getClientRects()[0] ?? range.getBoundingClientRect()
    const mirrorBox = mirror.getBoundingClientRect()
    const fieldBox = textarea.getBoundingClientRect()
    const hostBox = host.getBoundingClientRect()
    const x = fieldBox.left - hostBox.left - host.clientLeft + textarea.clientLeft + box.left - mirrorBox.left - textarea.scrollLeft
    const y = fieldBox.top - hostBox.top - host.clientTop + textarea.clientTop + box.top - mirrorBox.top - textarea.scrollTop

    const last = s.last
    if (last && Math.abs(last.x - x) < 0.5 && Math.abs(last.y - y) < 0.5) return
    s.last = { x, y }
    caret.style.height = `${box.height}px`
    // Appearing or changing lines jumps; moving along a line slides.
    const jump = !last || Math.abs(last.y - y) >= 0.5 || s.reduced
    if (jump) caret.style.transition = "none"
    caret.style.transform = `translate3d(${x}px, ${y}px, 0)`
    if (jump) { void caret.offsetWidth; caret.style.transition = "" }
    caret.dataset.visible = "true"

    const distance = last && !jump ? x - last.x : 0
    const now = performance.now()
    if (Math.abs(distance) >= TRAIL_MIN && now - s.trailAt > 32) {
      s.trailAt = now
      const width = Math.min(Math.abs(distance), TRAIL_MAX)
      const trail = document.createElement("div")
      trail.className = "noa-caret-trail"
      trail.dataset.direction = distance > 0 ? "right" : "left"
      trail.style.cssText = `width:${width}px;height:${box.height}px;left:${distance > 0 ? x - width : x}px;top:${y}px;transform-origin:${distance > 0 ? "right" : "left"}`
      host.appendChild(trail)
      trail.animate([{ opacity: 0.55, transform: "scaleX(1)" }, { opacity: 0, transform: "scaleX(0)" }], { duration: 180, easing: "cubic-bezier(.22,1,.36,1)" }).finished.then(() => trail.remove(), () => trail.remove())
    }

    // Hold the caret solid while it moves; blinking restarts from full opacity afterwards.
    caret.dataset.blink = "false"
    window.clearTimeout(s.blink)
    s.blink = window.setTimeout(() => { caret.dataset.blink = "true" }, BLINK_DELAY)
  }

  const schedule = () => {
    const s = state.current
    if (s.frame !== undefined) return
    s.frame = requestAnimationFrame(() => { s.frame = undefined; update() })
  }

  // Draw the new position in the same frame as the typed text.
  useLayoutEffect(update, [value, disabled])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const s = state.current
    const motion = matchMedia("(prefers-reduced-motion: reduce)")
    s.reduced = motion.matches
    const onMotion = () => { s.reduced = motion.matches }
    const resync = () => { syncMirrorStyle(textarea); schedule() }
    const onSelection = () => { if (document.activeElement === textarea) schedule() }
    const observer = new ResizeObserver(resync)
    observer.observe(textarea)
    motion.addEventListener("change", onMotion)
    document.addEventListener("selectionchange", onSelection)
    window.addEventListener("focus", resync)
    window.addEventListener("blur", schedule)
    textarea.addEventListener("scroll", schedule)
    textarea.addEventListener("focus", resync)
    textarea.addEventListener("blur", schedule)
    textarea.addEventListener("compositionupdate", schedule)
    return () => {
      observer.disconnect()
      motion.removeEventListener("change", onMotion)
      document.removeEventListener("selectionchange", onSelection)
      window.removeEventListener("focus", resync)
      window.removeEventListener("blur", schedule)
      textarea.removeEventListener("scroll", schedule)
      textarea.removeEventListener("focus", resync)
      textarea.removeEventListener("blur", schedule)
      textarea.removeEventListener("compositionupdate", schedule)
      if (s.frame !== undefined) cancelAnimationFrame(s.frame)
      window.clearTimeout(s.blink)
      s.mirror?.remove()
      s.mirror = s.signature = undefined
    }
  }, [textareaRef])

  return <div ref={caretRef} aria-hidden="true" className="noa-caret" data-visible="false" />
}
