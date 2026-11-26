// Marks scrolling containers with data-scrolling while the user scrolls them; the CSS shows the scrollbar thumb only then.
// Scroll events that follow a layout change (a panel resize clamping scrollTop, auto-follow) carry no user input and are ignored.
const HIDE_AFTER_MS = 1000
const INPUT_WINDOW_MS = 250
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "])

export function trackScrollActivity() {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
  let lastInput = 0
  let draggingThumb = false
  const markInput = () => { lastInput = performance.now() }
  for (const type of ["wheel", "touchmove"]) document.addEventListener(type, markInput, { capture: true, passive: true })
  document.addEventListener("keydown", (event) => { if (SCROLL_KEYS.has(event.key)) markInput() }, { capture: true, passive: true })
  // A press on the scroller's own scrollbar gutter starts a thumb drag, which scrolls without wheel input.
  document.addEventListener("pointerdown", (event) => {
    const el = event.target
    if (!(el instanceof HTMLElement)) { draggingThumb = false; return }
    const rect = el.getBoundingClientRect()
    const onVertical = el.scrollHeight > el.clientHeight && event.clientX - rect.left >= el.clientLeft + el.clientWidth
    const onHorizontal = el.scrollWidth > el.clientWidth && event.clientY - rect.top >= el.clientTop + el.clientHeight
    draggingThumb = onVertical || onHorizontal
  }, true)
  const stopDrag = () => { draggingThumb = false }
  document.addEventListener("pointerup", stopDrag, true)
  document.addEventListener("pointercancel", stopDrag, true)
  window.addEventListener("blur", stopDrag)
  document.addEventListener("pointermove", (event) => { if (draggingThumb && event.buttons === 0) stopDrag() }, { capture: true, passive: true })
  // Scroll events do not bubble, so listen in the capture phase.
  document.addEventListener("scroll", (event) => {
    if (!draggingThumb && performance.now() - lastInput > INPUT_WINDOW_MS) return
    const target = event.target === document ? document.documentElement : event.target
    if (!(target instanceof HTMLElement)) return
    target.setAttribute("data-scrolling", "")
    clearTimeout(timers.get(target))
    timers.set(target, setTimeout(() => target.removeAttribute("data-scrolling"), HIDE_AFTER_MS))
  }, true)
}
