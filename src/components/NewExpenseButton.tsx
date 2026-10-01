/**
 * "Add an expense".
 *
 * This existed as two copies of the same markup in the dashboard header and the
 * expenses header. They happened to agree, but nothing made them agree — the
 * next tweak would have been applied to one and not the other, which is exactly
 * how the two screens end up looking like different applications.
 *
 * Deliberately NOT a floating action button. The circular control pinned to the
 * bottom-right corner is a Material pattern from around 2014; Apple never
 * shipped one. Their idiom for compose is an inline action in the header —
 * Notes, Reminders and Mail all put it in the navigation bar — and matching that
 * is both less dated and less in the way. A corner circle also has to be
 * positioned against a bottom bar and a safe-area inset, which is a class of bug
 * this app already had one of.
 *
 * The label is "New", not "New expense": the plus glyph plus the screen it sits
 * on makes it unambiguous, and the short word is what lets the pill stay a pill
 * on a 390px screen next to a 28px serif title. The full name lives in the
 * accessible label, so nothing is lost.
 *
 * One DOM node at every width: two elements with the same accessible name would
 * make every `getByRole('button', { name: 'New expense' })` ambiguous, and the
 * E2E suite is right to treat that as a bug rather than a test to loosen.
 */
import { Plus } from 'lucide-react'

import { cn } from '#/lib/cn'

export function NewExpenseButton({
  onClick,
  disabled,
  className,
}: {
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="New expense"
      className={cn(
        'inline-flex items-center gap-1.5 shrink-0',
        'h-9 pl-2.5 pr-3.5 rounded-full',
        'text-sm font-medium text-[var(--color-ink)]',
        'bg-[var(--color-terracotta)]',
        'shadow-[var(--shadow-raise)]',
        'transition-[background-color,box-shadow,transform] duration-150',
        'ease-[var(--ease-out-soft)]',
        'hover:bg-[var(--color-terracotta-strong)] hover:shadow-[var(--shadow-float)]',
        // A press, not a colour change. Scale is compositor-only, so it costs
        // nothing where a shadow tween would not be.
        'active:scale-[0.96] motion-reduce:active:scale-100',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <Plus size={16} aria-hidden strokeWidth={2.25} />
      New
    </button>
  )
}
