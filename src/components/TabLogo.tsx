/**
 * The mark.
 *
 * A tally mark: four strokes and the diagonal that crosses them out. It is the
 * oldest bookkeeping notation there is — you count in fives by striking through —
 * so it says "what have we counted up" without a word, and unlike a coin, a pie
 * or a receipt it is nobody else's product.
 *
 * Two shapes, because the two jobs are different:
 *
 *   • tile — the mark on its terracotta rounded square. For anywhere it needs to
 *     hold its own against a busy surface: the sign-in screen, a browser tab,
 *     an installed app.
 *   • bare — the strokes alone in currentColor. For sitting beside a wordmark,
 *     where a second background shape would compete with the text.
 *
 * The strokes are deliberately unevenly spaced. A regular grid reads as a
 * barcode; the drift is what makes it look hand-marked.
 */
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
  tile = true,
  className,
  title,
}: {
  size?: number
  tile?: boolean
  className?: string
  /** Supply only when the mark stands alone; a bare mark beside a wordmark is
   *  decoration and should stay out of the accessibility tree. */
  title?: string
}) {
  if (!tile) {
    return (
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role={title ? 'img' : 'presentation'}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className={cn('shrink-0', className)}
      >
        <Strokes />
      </svg>
    )
  }

  const id = `tab-tile-${size}`
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
        {/* Ids must be unique per rendered instance or two marks on one page
            share a gradient and the second silently reuses the first's. */}
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9793f" />
          <stop offset="1" stopColor="#c2603a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${id})`} />
      <g stroke="#fdf6ec">
        <Strokes />
      </g>
    </svg>
  )
}

/**
 * Mark plus wordmark, for the places that name the product.
 *
 * `bare` is the default because the sidebar and the sign-in screens already have
 * a typographic hierarchy, and a second coloured tile next to a serif wordmark
 * fights it. The tile variant exists for a spot with no text at all.
 */
export function TabLogo({
  markSize = 22,
  wordmark = 'Tab',
  tile = false,
  className,
  markClassName,
}: {
  markSize?: number
  wordmark?: string
  tile?: boolean
  className?: string
  markClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <TabMark
        size={markSize}
        tile={tile}
        className={cn(!tile && 'text-terracotta', markClassName)}
      />
      <span className="font-serif tracking-tight">{wordmark}</span>
    </span>
  )
}
