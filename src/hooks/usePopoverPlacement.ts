import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

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
 * MEASURED AGAINST THE VISIBLE WIDTH, NOT window.innerWidth
 * This is the whole reason the date panel used to hang 149px off the right of a
 * phone. On a phone, a document that overflows horizontally makes Chrome widen
 * the *layout* viewport to match, and `window.innerWidth` then reports the
 * overflow rather than the screen. So the panel overflowed, the viewport grew to
 * 569px to accommodate it, and the clamp measured 569 and concluded a 300px
 * panel hanging off a trigger at x=269 fitted — inside the overflow it had just
 * caused. `document.documentElement.clientWidth` stays at the device width
 * whatever the content does, so the smaller of the two is the honest number.
 *
 * A LAYOUT EFFECT, so the un-clamped panel is never painted
 * With a passive effect the popover first renders at `left-0` at its full class
 * width, and only afterwards gets corrected. On a phone that first frame is
 * enough to widen the layout viewport on its own, so by the time the
 * measurement ran the thing it was measuring against was already wrong — and the
 * correction could not recover. Measuring before paint removes the bad frame
 * entirely, and costs no visible latency, because the panel is opening anyway.
 *
 * Recomputed on resize, and on scroll from *any* ancestor (capture phase), so a
 * popover inside the expense sheet's scroller stays against its trigger instead
 * of drifting as the sheet scrolls underneath it.
 *
 * TWO PLACEMENTS, because there are two kinds of popover
 * `placement` is an *offset* from the anchor, for a panel that is `absolute`
 * inside a positioned wrapper. `floating` is in *viewport* coordinates, for a
 * panel portalled to `<body>` as `fixed` — which is what a popover inside a
 * scrolling sheet has to be, because `absolute` there is clipped by the
 * scroller and `overflow: hidden` on the sheet clips it outright. The vertical
 * half is only in `floating`: it needs the panel's own height to decide whether
 * to open downwards or flip up, and a panel whose height is needed cannot be
 * placed by an offset alone.
 */

// React warns when a layout effect is used during server rendering, and this
// module is imported by components that render on the server. The effect only
// does anything on the client, so the server is given the passive one.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

export function usePopoverPlacement<T extends HTMLElement>({
  open,
  width,
  margin = 8,
  gap = 6,
}: {
  open: boolean
  /** The width you want, in px. Narrowed to fit if the viewport is smaller. */
  width: number
  margin?: number
  /** Space between the anchor and the panel, in px. */
  gap?: number
}) {
  const anchor = useRef<T>(null)
  // A callback ref rather than another useRef, because the panel has to be
  // *measurable* before it can be placed and a plain ref is null on the layout
  // pass that would do the measuring. Re-running the effect when the element
  // arrives is what lets the flip decision see a real height.
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null)
  const panel = useCallback((el: HTMLDivElement | null) => setPanelEl(el), [])
  const [placement, setPlacement] = useState<{
    left: number
    width: number
  } | null>(null)
  const [floating, setFloating] = useState<{
    left: number
    top: number
    width: number
    side: 'above' | 'below'
  } | null>(null)

  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      setFloating(null)
      return
    }

    const place = () => {
      const el = anchor.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const viewport = Math.min(
        document.documentElement.clientWidth || window.innerWidth,
        window.innerWidth,
      )
      const w = Math.min(width, viewport - margin * 2)
      const maxLeft = viewport - margin - w - rect.left
      const minLeft = margin - rect.left
      const left = Math.max(minLeft, Math.min(0, maxLeft))
      setPlacement({ left, width: w })

      // The fixed-coordinate form, for a panel portalled to <body>. Measured
      // against the visible viewport height for the same reason the width is:
      // innerHeight lies the moment the document overflows on a phone.
      const panelHeight = panelEl?.getBoundingClientRect().height ?? 0
      const vh = Math.min(
        document.documentElement.clientHeight || window.innerHeight,
        window.innerHeight,
      )
      const roomBelow = vh - rect.bottom - gap
      const roomAbove = rect.top - gap - margin
      // Flip only when it actually helps: a panel that fits above but not below
      // goes above, and a panel that fits in neither keeps the default, because
      // opening upward off the top edge hides the trigger that opened it.
      const side =
        panelHeight > roomBelow && panelHeight <= roomAbove ? 'above' : 'below'
      const top =
        side === 'above' ? rect.top - gap - panelHeight : rect.bottom + gap
      setFloating({
        left: Math.round(rect.left + left),
        // Never above the top margin, even when `above` did not fit — a
        // negative top is a panel hanging off the top of the screen.
        top: Math.round(Math.max(margin, top)),
        width: w,
        side,
      })
    }

    place()
    window.addEventListener('resize', place)
    // Capture, so scrolling any ancestor — including the sheet's own scroller —
    // keeps the panel against its trigger rather than letting it drift.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, width, margin, gap, panelEl])

  return { anchor, panel, placement, floating }
}
