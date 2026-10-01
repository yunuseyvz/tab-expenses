import { useEffect, useRef, useState } from 'react'

/**
 * Keep a popover inside the viewport, relative to the thing it hangs off.
 *
 * Exists because the calculation is not optional and not guessable. A popover
 * anchored `left-0` is only correct while it is narrower than the viewport and
 * the anchor is near the left edge; a 19rem calendar hanging off a 140px field
 * near the right of a phone runs off the screen, where the dates you can see are
 * not the dates you can click. Every popover in the app hits this, so it is
 * solved once here rather than three times by eye.
 *
 * A NEGATIVE `left` IS THE NORMAL CASE
 * The popover is usually wider than its anchor, so keeping it on screen means
 * letting it start to the *left* of the trigger and hang off both sides. Clamping
 * at zero would reintroduce the overflow it exists to prevent.
 *
 *   left  =  viewport margin            − anchor's left edge
 *   right =  viewport width − margin     − popover width
 *   → the offset is the largest of the two, capped at 0
 *
 * Recomputed on resize, and on scroll from *any* ancestor (capture phase), so a
 * popover inside the expense sheet's scroller stays against its trigger instead
 * of drifting as the sheet scrolls underneath it.
 */
export function usePopoverPlacement<T extends HTMLElement>({
  open,
  width,
  margin = 8,
}: {
  open: boolean
  /** The width you want, in px. Narrowed to fit if the viewport is smaller. */
  width: number
  margin?: number
}) {
  const anchor = useRef<T>(null)
  const [placement, setPlacement] = useState<{
    left: number
    width: number
  } | null>(null)

  useEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }

    const place = () => {
      const el = anchor.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const w = Math.min(width, window.innerWidth - margin * 2)
      const maxLeft = window.innerWidth - margin - w - rect.left
      const minLeft = margin - rect.left
      setPlacement({ left: Math.max(minLeft, Math.min(0, maxLeft)), width: w })
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, width, margin])

  return { anchor, placement }
}
