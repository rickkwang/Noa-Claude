import { useLayoutEffect, type RefObject } from "react"

// Tighten the natural layout only when every text fragment keeps its wrapping.
export function useUserBubbleWidth(
  ref: RefObject<HTMLDivElement | null>,
  fontRef: RefObject<HTMLSpanElement | null>,
  text: string,
  expanded: boolean,
) {
  useLayoutEffect(() => {
    const element = ref.current
    const font = fontRef.current
    if (!element || !font) return
    let frame = 0
    let disposed = false
    const original = element.style.maxWidth
    const content = element.querySelector<HTMLElement>(".noa-output-markdown")
    if (!content) return

    const measure = () => {
      const range = document.createRange()
      const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
      const widths: number[] = []
      let left = Infinity
      let right = -Infinity
      while (walk.nextNode()) {
        range.selectNodeContents(walk.currentNode)
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0) continue
          widths.push(rect.width)
          left = Math.min(left, rect.left)
          right = Math.max(right, rect.right)
        }
      }
      return { widths, left, right, height: element.scrollHeight }
    }
    const fit = () => {
      frame = 0
      if (disposed) return
      element.style.maxWidth = original
      // Embedded blocks own their width; keep their existing layout and scrolling.
      if (text.length > 20_000 || content.querySelector("pre, table, img, video, audio, iframe") || element.scrollHeight > element.clientHeight + 1) return
      const natural = measure()
      if (!natural.widths.length) return
      const style = getComputedStyle(element)
      const naturalWidth = parseFloat(style.width)
      const scale = element.getBoundingClientRect().width / naturalWidth
      if (!(scale > 0)) return
      const insets = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
      const candidate = Math.ceil((natural.right - natural.left) / scale + insets)
      if (candidate >= naturalWidth - .5) return
      const valid = (width: number) => {
        element.style.maxWidth = `${width}px`
        const next = measure()
        return next.height === natural.height && element.scrollWidth <= element.clientWidth + 1 &&
          next.widths.length === natural.widths.length &&
          next.widths.every((value, index) => Math.abs(value - natural.widths[index]!) <= .5)
      }
      if (valid(candidate)) return
      // Fractional font metrics can need another pixel or two before bisection.
      for (const extra of [1, 2]) if (candidate + extra < naturalWidth && valid(candidate + extra)) return
      let low = candidate + 2
      let high = Math.ceil(naturalWidth)
      for (let count = 0; count < 12 && high - low > 1; count++) {
        const middle = Math.floor((low + high) / 2)
        if (valid(middle)) high = middle
        else low = middle
      }
      if (high >= naturalWidth - .5 || !valid(high)) element.style.maxWidth = original
    }
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(fit)
    }
    fit()
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    if (element.parentElement) resize.observe(element.parentElement)
    // Intrinsic probe width follows both font family and size, including loaded fonts.
    resize.observe(font)
    const mutations = new MutationObserver(schedule)
    mutations.observe(content, { subtree: true, childList: true, characterData: true })
    document.fonts.addEventListener("loadingdone", schedule)
    void document.fonts.ready.then(schedule)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      document.fonts.removeEventListener("loadingdone", schedule)
      element.style.maxWidth = original
    }
  }, [ref, fontRef, text, expanded])
}
