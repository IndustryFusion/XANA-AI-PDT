import { useEffect, useRef } from 'react'

const GAP = 12

/**
 * When `key` changes (another item was selected in the same area), scrolls
 * the page so the element's top shows just below the sticky header, if it
 * is hidden above it or far down the page. Nothing moves when it is already
 * in view, and nothing happens on first render.
 */
export function useRevealOnChange(ref, key) {
  const previous = useRef(key)
  useEffect(() => {
    if (previous.current === key) return
    previous.current = key
    const el = ref.current
    if (!el) return
    const offset = (document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0) + GAP
    const { top } = el.getBoundingClientRect()
    if (top < offset || top > window.innerHeight - 80) window.scrollBy?.({ top: top - offset })
  }, [ref, key])
}
