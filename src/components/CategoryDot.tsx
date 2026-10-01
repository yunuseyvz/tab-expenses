import { cn } from '#/lib/cn'
import { swatchColor } from '#/lib/swatches'

/**
 * A category's colour, as a dot.
 *
 * The badge row this replaces showed the same four names as coloured chips with
 * a left border, directly under a dropdown listing the same four names. Two
 * controls, one set of options, and the chips were the one people used — so the
 * dropdown was decoration and the chips were the real control, which is a
 * strange thing for a form to do with a field.
 *
 * A dot carries the same colour in a fraction of the width, leaves the names
 * aligned, and does not compete with the label above it. Colour is never the
 * only thing distinguishing two options — the name is right beside it — so this
 * is not a colour-only encoding.
 */
export function CategoryDot({
  color,
  size = 10,
  className,
}: {
  color: string
  size?: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('shrink-0 rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: swatchColor(color),
        // A hairline of the surface behind it, so a light swatch still reads as
        // a disc rather than dissolving into the field.
        boxShadow: '0 0 0 1px rgb(28 34 46 / 0.14)',
      }}
    />
  )
}
