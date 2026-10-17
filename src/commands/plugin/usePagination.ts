// @ts-nocheck
import { useCallback, useMemo, useRef, useState } from 'react'
import type { WheelEvent } from '../../ink/events/wheel-event.js'

const DEFAULT_MAX_VISIBLE = 5

type UsePaginationOptions = {
  totalItems: number
  maxVisible?: number
  selectedIndex?: number
  // Called with the new visible window [startIndex, endIndex) after a wheel
  // scroll. The caller must move its selection into it, or the next render
  // snaps the window back to the selection.
  onScroll?: (startIndex: number, endIndex: number) => void
}

type UsePaginationResult<T> = {
  // For backwards compatibility with page-based terminology
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  needsPagination: boolean
  pageSize: number
  // Get visible slice of items
  getVisibleItems: (items: T[]) => T[]
  // Convert visible index to actual index
  toActualIndex: (visibleIndex: number) => number
  // Check if actual index is visible
  isOnCurrentPage: (actualIndex: number) => boolean
  // Navigation (kept for API compatibility)
  goToPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
  // Handle selection - just updates the index, scrolling is automatic
  handleSelectionChange: (
    newIndex: number,
    setSelectedIndex: (index: number) => void,
  ) => void
  // Page navigation - returns false for continuous scrolling (not needed)
  handlePageNavigation: (
    direction: 'left' | 'right',
    setSelectedIndex: (index: number) => void,
  ) => boolean
  // Spread onto the Box wrapping the rows; undefined when everything fits
  onWheel: ((event: WheelEvent) => void) | undefined
  // Scroll position info for UI display
  scrollPosition: {
    current: number
    total: number
    canScrollUp: boolean
    canScrollDown: boolean
  }
}

export function usePagination<T>({
  totalItems,
  maxVisible = DEFAULT_MAX_VISIBLE,
  selectedIndex = 0,
  onScroll,
}: UsePaginationOptions): UsePaginationResult<T> {
  const needsPagination = totalItems > maxVisible

  const scrollOffsetRef = useRef(0)
  // Bumped by a wheel scroll so the offset below recomputes even when the
  // selection didn't have to move.
  const [scrollTick, setScrollTick] = useState(0)

  // Keep the selection visible and clamp the offset to the list bounds.
  const scrollOffset = useMemo(() => {
    if (!needsPagination) return 0

    const prevOffset = scrollOffsetRef.current

    if (selectedIndex < prevOffset) {
      scrollOffsetRef.current = selectedIndex
      return selectedIndex
    }

    if (selectedIndex >= prevOffset + maxVisible) {
      const newOffset = selectedIndex - maxVisible + 1
      scrollOffsetRef.current = newOffset
      return newOffset
    }

    const maxOffset = Math.max(0, totalItems - maxVisible)
    const clampedOffset = Math.min(prevOffset, maxOffset)
    scrollOffsetRef.current = clampedOffset
    return clampedOffset
  }, [selectedIndex, maxVisible, needsPagination, totalItems, scrollTick])

  const startIndex = scrollOffset
  const endIndex = Math.min(scrollOffset + maxVisible, totalItems)

  const getVisibleItems = useCallback(
    (items: T[]): T[] => {
      if (!needsPagination) return items
      return items.slice(startIndex, endIndex)
    },
    [needsPagination, startIndex, endIndex],
  )

  const toActualIndex = useCallback(
    (visibleIndex: number): number => {
      return startIndex + visibleIndex
    },
    [startIndex],
  )

  const isOnCurrentPage = useCallback(
    (actualIndex: number): boolean => {
      return actualIndex >= startIndex && actualIndex < endIndex
    },
    [startIndex, endIndex],
  )

  // Legacy page APIs are no-ops; selectedIndex controls continuous scrolling.
  const goToPage = useCallback((_page: number) => {
  }, [])

  const nextPage = useCallback(() => {
  }, [])

  const prevPage = useCallback(() => {
  }, [])

  const handleSelectionChange = useCallback(
    (newIndex: number, setSelectedIndex: (index: number) => void) => {
      const clampedIndex = Math.max(0, Math.min(newIndex, totalItems - 1))
      setSelectedIndex(clampedIndex)
    },
    [totalItems],
  )

  const handlePageNavigation = useCallback(
    (
      _direction: 'left' | 'right',
      _setSelectedIndex: (index: number) => void,
    ): boolean => {
      return false
    },
    [],
  )

  // The list claims the wheel even at its ends, so a notch past the last row
  // doesn't scroll the transcript behind the dialog instead.
  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (event.deltaY === 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const prev = scrollOffsetRef.current
      const next = Math.max(
        0,
        Math.min(prev + (event.deltaY > 0 ? 1 : -1), totalItems - maxVisible),
      )
      if (next === prev) return
      scrollOffsetRef.current = next
      setScrollTick(tick => tick + 1)
      onScroll?.(next, next + maxVisible)
    },
    [totalItems, maxVisible, onScroll],
  )

  const totalPages = Math.max(1, Math.ceil(totalItems / maxVisible))
  const currentPage = Math.floor(scrollOffset / maxVisible)

  return {
    currentPage,
    totalPages,
    startIndex,
    endIndex,
    needsPagination,
    pageSize: maxVisible,
    getVisibleItems,
    toActualIndex,
    isOnCurrentPage,
    goToPage,
    nextPage,
    prevPage,
    handleSelectionChange,
    handlePageNavigation,
    onWheel: needsPagination ? onWheel : undefined,
    scrollPosition: {
      current: selectedIndex + 1,
      total: totalItems,
      canScrollUp: scrollOffset > 0,
      canScrollDown: scrollOffset + maxVisible < totalItems,
    },
  }
}
