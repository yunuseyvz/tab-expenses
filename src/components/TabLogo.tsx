/**
 * The mark.
 *
 * A tally mark: four strokes and the diagonal that crosses them out. It is the
 * oldest bookkeeping notation there is — you count in fives by striking through —
 * so it says "what have we counted up" without a word, and unlike a coin, a pie
 * or a receipt it is nobody else's product.
 *
 * ALWAYS WHITE ON A TILE
 * There is no bare variant. The mark is white strokes on its own ground, the way
 * an app icon is, and it is the mark at every size and in every place: the
 * sidebar, the sign-in screens, an installed app, a browser tab. The version that
 * sat beside the wordmark as terracotta strokes on the page was a different mark
 * that happened to share a shape — and the only place it appeared was the four
 * places the mark appears, so there was no "small" context for it to serve.
 *
 * THE GROUND IS LIT FROM THE TOP-LEFT
 * Same rule as the rest of the app, and for the same reason: one light source,
 * everywhere, is what makes a set of surfaces look like objects in a room rather
 * than a pile of shapes. So the tile is a gradient running away from that corner,
 * a sheen in it, a hatch across it, and a rim that is bright where the light
 * lands and dark where it does not.
 *
 * A flat two-stop fill reads as a coloured square. What makes it read as a
 * physical object is the rim — a one-pixel bright edge along the top and left,
 * a dark one along the bottom and right — because that is the only cue available
 * at 16px, and at 16px it is most of the cue.
 */
import { useId } from 'react'

import { cn } from '#/lib/cn'

/** Geometry shared with public/favicon.svg and public/icon-maskable.svg. */
function Strokes({ className }: { className?: string }) {
  return (
    <g
      stroke="currentColor"
      strokeWidth={4.5}
      strokeLinecap="round"
      fill="none"
      className={className}
    >
      <path d="M18 17.5 L18.6 46.5" />
      <path d="M27.5 16 L28.4 47.5" />
      <path d="M37 17 L37.4 46" />
      <path d="M46 16.5 L46.8 47" />
      <path d="M15 50.5 L49 13.5" />
    </g>
  )
}

export function TabMark({
  size = 40,
  className,
  title,
}: {
  size?: number
  className?: string
  /** Supply only when the mark stands alone; a bare mark beside a wordmark is
   *  decoration and should stay out of the accessibility tree. */
  title?: string
}) {
  // Ids must be unique per rendered instance or two marks on one page share a
  // gradient and the second silently reuses the first's. useId, not size: the
  // sidebar and a sign-in screen routinely show two marks of the same size, and
  // that is exactly the case the old id was wrong for.
  //
  // Colons are legal in an id but hostile in a url(#…) reference, so they are
  // stripped — `useId` returns something like ":r1:".
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0 rounded-[22%]', className)}
    >
      <defs>
        {/* Four stops, not two. Two makes a flat wash; the extra stops put the
            light where the light is and let the far corner fall away. */}
        <linearGradient id={`t-base-${uid}`} x1="0.08" y1="0" x2="0.86" y2="1">
          <stop offset="0" stopColor="#e59463" />
          <stop offset="0.38" stopColor="#d0713f" />
          <stop offset="0.78" stopColor="#ad5730" />
          <stop offset="1" stopColor="#8f4425" />
        </linearGradient>

        {/* The sheen: a broad highlight sitting under the top-left corner, which
            is what a real edge-lit surface does and what a gradient alone does
            not. */}
        <radialGradient id={`t-sheen-${uid}`} cx="0.22" cy="0.14" r="0.85">
          <stop offset="0" stopColor="#fff" stopOpacity="0.4" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.09" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>

        {/* Fine diagonal hatch. Deliberately almost invisible: at 22px this is
            about one device pixel per line, so it reads as surface rather than
            as stripes, and at 16px it reads as a slightly warmer tone. Any
            stronger and it turns into moiré. */}
        <pattern
          id={`t-hatch-${uid}`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="#fff"
            strokeOpacity="0.06"
            strokeWidth="2"
          />
        </pattern>

        {/* The far corner falls away. Without it the tile is evenly lit and
            therefore flat, whatever the gradient says. */}
        <radialGradient id={`t-fall-${uid}`} cx="0.9" cy="0.95" r="0.75">
          <stop offset="0" stopColor="#3a1608" stopOpacity="0.34" />
          <stop offset="1" stopColor="#3a1608" stopOpacity="0" />
        </radialGradient>

        <clipPath id={`t-clip-${uid}`}>
          <rect width="64" height="64" rx="15" />
        </clipPath>

        <linearGradient id={`t-rim-${uid}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#2a0f04" stopOpacity="0.3" />
        </linearGradient>

        {/* Lifts the strokes off the ground instead of printing them on it. A
            1px shadow at 16px is a hint of separation, which is what stops the
            mark looking like a hole cut in the tile. */}
        <filter
          id={`t-lift-${uid}`}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
        >
          <feDropShadow
            dx="0"
            dy="1.1"
            stdDeviation="0.9"
            floodColor="#4a1a08"
            floodOpacity="0.42"
          />
        </filter>
      </defs>

      <g clipPath={`url(#t-clip-${uid})`}>
        <rect width="64" height="64" fill={`url(#t-base-${uid})`} />
        <rect width="64" height="64" fill={`url(#t-hatch-${uid})`} />
        <rect width="64" height="64" fill={`url(#t-sheen-${uid})`} />
        <rect width="64" height="64" fill={`url(#t-fall-${uid})`} />
      </g>

      {/* The rim, last, so it sits over the fill rather than under it. */}
      <rect
        width="63"
        height="63"
        x="0.5"
        y="0.5"
        rx="14.5"
        fill="none"
        stroke={`url(#t-rim-${uid})`}
        strokeWidth="1"
      />

      {/* Pure white, not a warm off-white: against a saturated ground a tinted
          white reads as a printing error, and the strokes are the one thing that
          must not be ambiguous at 16px. Strokes paints in `currentColor`, so the
          colour goes on `color` and the extra wrapper is not needed. */}
      <g color="#fff" filter={`url(#t-lift-${uid})`}>
        <Strokes />
      </g>
    </svg>
  )
}

/**
 * Mark plus wordmark, for the places that name the product.
 */
export function TabLogo({
  markSize = 22,
  wordmark = 'Tab',
  className,
  markClassName,
}: {
  markSize?: number
  wordmark?: string
  className?: string
  markClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <TabMark size={markSize} className={markClassName} />
      <span className="font-serif tracking-tight">{wordmark}</span>
    </span>
  )
}
