import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { computeFlipDeltas, type FlipRect } from '../lib/flipDeltas'

const FLIP_DURATION_MS = 180
const FLIP_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * FLIP-animates horizontal reorders of a container's `[data-flip-id]` children.
 *
 * Runs after every render: it snapshots each child's left edge, and when the
 * id *order* changed since the previous render it plays the moved elements
 * from their old position to the new one (transform-only). Ids that entered
 * or left are ignored — tab open/close stays instant by design. Rects are
 * measured live, so a reorder during an in-flight animation starts from the
 * current visual position. `prefers-reduced-motion` is honored by the global
 * CSS rule in index.css, whose !important beats the inline transition set here.
 */
export function useFlipAnimation(
  containerRef: RefObject<HTMLElement | null>,
  orderedIds: string[],
): void {
  const prevRects = useRef<Map<string, FlipRect>>(new Map())
  const prevOrder = useRef<string | null>(null)
  const timeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useLayoutEffect(() => {
    const orderKey = orderedIds.join('|')
    const container = containerRef.current
    if (!container) {
      prevRects.current = new Map()
      prevOrder.current = orderKey
      return
    }

    const els = new Map<string, HTMLElement>()
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-flip-id]'))) {
      els.set(el.dataset.flipId as string, el)
    }
    const nextRects = new Map<string, FlipRect>()
    for (const [id, el] of els) nextRects.set(id, { left: el.getBoundingClientRect().left })

    if (prevOrder.current !== null && prevOrder.current !== orderKey) {
      for (const [id, dx] of computeFlipDeltas(prevRects.current, nextRects)) {
        const el = els.get(id)
        if (!el) continue
        const elem = el
        // Invert: place the element at its old position without transitioning…
        elem.style.transition = 'none'
        elem.style.transform = `translateX(${dx}px)`
        void elem.offsetWidth // force reflow so the inverted transform is committed
        // …then play to its natural position.
        elem.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`
        elem.style.transform = ''
        let timeout: ReturnType<typeof setTimeout>
        const cleanup = () => {
          elem.style.transition = ''
          elem.style.transform = ''
          clearTimeout(timeout)
          timeouts.current.delete(timeout)
        }
        timeout = setTimeout(cleanup, FLIP_DURATION_MS + 50) // fallback if transitionend never fires
        timeouts.current.add(timeout)
        elem.addEventListener('transitionend', cleanup, { once: true })
      }
      // Re-measure so the stored snapshot reflects the visual (inverted) state —
      // this is what makes interrupted animations start from where they look.
      for (const [id, el] of els) nextRects.set(id, { left: el.getBoundingClientRect().left })
    }

    prevRects.current = nextRects
    prevOrder.current = orderKey
  })

  // Unmount: cancel pending fallback timers (elements are going away anyway).
  useEffect(() => {
    const pending = timeouts.current
    return () => {
      for (const t of pending) clearTimeout(t)
    }
  }, [])
}
