import { Event } from './event.js'

/**
 * Mouse wheel event. Fired on scroll wheel / trackpad scroll, only when
 * mouse tracking is enabled (i.e. inside `<AlternateScreen>`).
 *
 * Bubbles from the deepest hit Box up through parentNode, so an inner
 * scrollable region can claim the wheel and leave the rest to its ancestors.
 * Call `stopPropagation()` to stop bubbling, and `preventDefault()` to stop
 * the wheel from also reaching the global `scroll:lineUp`/`scroll:lineDown`
 * keybindings.
 */
export class WheelEvent extends Event {
  /** 0-indexed screen column the pointer was over */
  readonly col: number
  /** 0-indexed screen row the pointer was over */
  readonly row: number
  /** Rows scrolled: negative up, positive down. One event is ±1. */
  readonly deltaY: number

  #defaultPrevented = false

  constructor(col: number, row: number, deltaY: number) {
    super()
    this.col = col
    this.row = row
    this.deltaY = deltaY
  }

  get defaultPrevented(): boolean {
    return this.#defaultPrevented
  }

  preventDefault(): void {
    this.#defaultPrevented = true
  }

  stopPropagation(): void {
    this.stopImmediatePropagation()
  }
}
