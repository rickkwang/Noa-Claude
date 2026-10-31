// Marks `.scrollbar-on-scroll` containers with data-scrolling while they scroll; the CSS shows the thumb only then.
const HIDE_AFTER_MS = 1000

export function trackScrollActivity() {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>()
  // Scroll events do not bubble, so listen in the capture phase.
  document.addEventListener("scroll", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains("scrollbar-on-scroll")) return
    target.setAttribute("data-scrolling", "")
    clearTimeout(timers.get(target))
    timers.set(target, setTimeout(() => target.removeAttribute("data-scrolling"), HIDE_AFTER_MS))
  }, true)
}
