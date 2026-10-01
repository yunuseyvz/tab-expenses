import { useEffect, useRef, useState } from 'react'

import { useReducedMotion } from 'motion/react'

/**
 * How long a value has to hold still before the count starts.
 *
 * Changing the period does not swap the data in one step. There is a frame or
 * two where the totals query and the component disagree — a figure carrying an
 * expense the settled query will not count — and that value is real on screen
 * for about thirteen milliseconds. A tween that starts the instant it arrives
 * counts all the way to the wrong number and then reverses, which is the one
 * thing a counting figure must never do: it shows the reader a total the
 * household never had.
 *
 * So the count waits for the value to settle. Transient values are absorbed
 * rather than animated, and the reader sees one movement from the old total to
 * the new one.
 *
 * 220ms rather than something tighter, because the data does not change once:
 * the totals and the component disagree for a render or two, and the component
 * re-renders again as the new period's own data lands. Both arrive within a few
 * milliseconds of each other, and a window narrower than the gap between them
 * starts a count to a figure that is about to be replaced. It is a delay, not a
 * cost: the count itself is 600ms, so 220ms before it begins is not a pause
 * anyone waits for.
 */
const SETTLE_MS = 220

/**
 * A number that counts to its new value.
 *
 * The reason this exists rather than being a CSS transition: a number that
 * *jumps* from €1,658.25 to €3,229.24 tells you nothing, because nothing moves
 * and there is no frame in which the change happened. A tween makes the change
 * legible — you see which way it went and roughly how far — which is most of
 * what a dashboard figure is for.
 *
 * MOUNT DOES NOT ANIMATE
 * The first value is rendered as-is. Animating from zero on load would mean a
 * page whose totals are wrong for half a second, and worse, it would disagree
 * with what the server already put in the HTML: the markup arrives carrying the
 * real figure, so counting up from zero makes the first client render a
 * different number from the server's, which is hydration drift for no gain. The
 * count runs when the value *changes* — a new period, a new household, a new
 * expense — and nowhere else.
 *
 * COUNTING BETWEEN THE TWO FIGURES, NOT THROUGH ZERO
 * A tween from the old value to the new one is the only honest version. Tweening
 * up from zero would send a falling total sweeping past numbers the household
 * never had, and tweening a signed position through zero would assert a moment
 * of being square that never occurred.
 *
 * RETARGETS FROM WHEREVER IT IS
 * If the target changes mid-count, the new count starts from the value currently
 * on screen rather than from the one the last count started at. Otherwise a
 * second change produces a visible jump back to a number already passed through.
 *
 * Tabular figures throughout — see the `tnum` class — or the width jitters as
 * the digits change and the column shuffles on every frame.
 */
export function CountUp({
  value,
  format,
  duration = 0.6,
  className,
  style,
}: {
  /** Minor units, or whatever unit the formatter takes. */
  value: number
  format: (value: number) => string
  duration?: number
  className?: string
  /**
   * The colour of a position changes with its sign, so the caller has to be able
   * to set it. A style prop rather than a `tone` enum, because there are already
   * two meanings in this app — sage for owed-to-you, oxblood for you-owe — and a
   * third would not generalise.
   */
  style?: React.CSSProperties
}) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(value)
  /** The value currently on screen, which is not `value` mid-count. */
  const current = useRef(value)
  const frame = useRef<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (settle.current !== null) {
      clearTimeout(settle.current)
      settle.current = null
    }
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }

    if (reduceMotion) {
      current.current = value
      setShown(value)
      return
    }

    settle.current = setTimeout(() => {
      settle.current = null
      const from = current.current
      if (from === value) return

      // easeOutCubic, so the movement decelerates into its destination rather
      // than arriving at a constant speed and stopping dead.
      const ease = (t: number) => 1 - Math.pow(1 - t, 3)
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / (duration * 1000))
        const next = from + (value - from) * ease(t)
        current.current = next
        setShown(next)
        if (t < 1) {
          frame.current = requestAnimationFrame(tick)
        } else {
          // Land exactly on the value rather than on an eased approximation of
          // it, so the last number on screen is the real one to the cent.
          current.current = value
          setShown(value)
        }
      }
      frame.current = requestAnimationFrame(tick)
    }, SETTLE_MS)

    return () => {
      if (settle.current !== null) clearTimeout(settle.current)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [value, duration, reduceMotion])

  return (
    <span className={className} style={style}>
      {format(shown)}
    </span>
  )
}
