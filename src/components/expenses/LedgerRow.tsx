import { Lock, StickyNote } from 'lucide-react'

import type { ExpenseRow } from '#/lib/expense.functions'
import { MemberAvatar } from '#/components/MemberAvatar'
import { useMayEditExpense } from '#/hooks/useMayEditExpense'
import { formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

/**
 * One ledger row, the same everywhere a ledger appears.
 *
 * Extracted from the expenses list when the calendar's day panel needed the
 * identical row: a row that looks or behaves differently between two places on
 * the same screen is two things to learn where one would do — and the subtler
 * version of that bug is a copy that starts identical and quietly stays behind
 * when one of them learns something.
 *
 * May-edit is decided in here rather than passed in, so the two call sites
 * cannot disagree about which entries open read-only.
 */
export function LedgerRow({
  row,
  currency,
  onOpen,
}: {
  row: ExpenseRow
  currency: string
  onOpen: (row: ExpenseRow) => void
}) {
  const mayEdit = useMayEditExpense()
  const edit = mayEdit(row)

  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      aria-label={
        edit.canEdit
          ? `Edit ${row.purpose}, ${formatMoney(row.amountMinor, currency)}`
          : `View ${row.purpose}, ${formatMoney(row.amountMinor, currency)}. ${edit.reason}`
      }
      className="w-full flex items-center gap-3 px-4 py-3 text-left
        border-b border-rule last:border-b-0
        transition-colors duration-150
        enabled:hover:bg-[var(--color-paper-sunk)]"
    >
      <span
        aria-hidden
        className="h-8 w-1 rounded-sm shrink-0"
        style={{
          background:
            row.categoryColor !== null
              ? swatchColor(row.categoryColor)
              : 'var(--color-rule)',
        }}
      />
      <span className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium block">
          {row.purpose}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 mt-0.5">
          {/* The payer's face, not their name alone. On a household ledger "who
              is this" is asked far more often than "how much", and a column of
              identical text asked the reader to hold the roster in their head
              to answer it. */}
          <MemberAvatar
            memberId={row.paidByMemberId}
            avatar={row.paidByAvatar}
            name={row.paidByName}
            size={15}
          />
          <span className="truncate text-xs text-ink-faint">
            {row.paidByName}
          </span>
          <span className="truncate text-xs text-ink-faint/70">
            {row.categoryName ?? 'Uncategorised'}
            {row.splits.length > 1 && ` · split ${row.splits.length} ways`}
          </span>
        </span>
      </span>
      {/* Read-only and conversation markers, beside the amount rather than
          under it: the row's job is to say at a glance whether this opens
          editable, and whether there is anything to read under it. */}
      {!edit.canEdit && (
        <Lock size={13} aria-hidden className="shrink-0 text-ink-faint" />
      )}
      {row.noteCount > 0 && (
        <span className="flex items-center gap-1 shrink-0 text-ink-faint">
          <StickyNote size={13} aria-hidden />
          <span className="text-xs tnum">{row.noteCount}</span>
        </span>
      )}
      <span className="tnum text-sm font-medium shrink-0">
        {formatMoney(row.amountMinor, currency)}
      </span>
    </button>
  )
}
