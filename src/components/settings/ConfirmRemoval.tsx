/**
 * Confirming the removal of a member, a category, a leave, or a payment.
 *
 * One dialog for all four, because the decision is the same shape: "this stops
 * being part of the ledger, and here is exactly what that does and does not
 * undo". They differ only in the nouns, in one line of consequence, and in
 * whether the reassurance is "nothing is lost" or its mirror image, "the debt
 * comes back".
 *
 * The wording is the whole point of having this at all. "Are you sure?" asks
 * nothing and answers nothing, so it trains people to click through dialogs. What
 * somebody actually wants to know before removing a housemate is whether the last
 * three months of groceries will suddenly be unaccounted for, and the answer is
 * no. What somebody wants to know before removing a recorded payment is the
 * opposite, and that is why the copy is a table rather than a chain of ternaries:
 * the four kinds disagree about the important line, and nesting that disagreement
 * three levels deep is how one of them ends up saying the wrong thing.
 */
import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'

export type RemovalKind = 'member' | 'category' | 'leave' | 'settlement'

interface Copy {
  title: (name: string) => string
  question: (name: string) => React.ReactNode
  /**
   * The line people are anxious about. For the first three it reassures that
   * nothing is rewritten; for a payment it is the reverse, because undoing one
   * genuinely does put a debt back.
   */
  consequence: (name: string) => React.ReactNode
  confirm: string
  busy: string
}

const COPY: Record<RemovalKind, Copy> = {
  leave: {
    title: (n) => `Leave ${n}?`,
    question: (n) => (
      <>
        You will lose access to{' '}
        <strong className="text-ink font-medium">{n}</strong>. You can join
        again only if an owner invites you back.
      </>
    ),
    consequence: () => (
      <>
        Your name stays on every expense you were part of. Nothing in the ledger
        is rewritten, and no history is lost.
      </>
    ),
    confirm: 'Leave household',
    busy: 'Leaving…',
  },
  member: {
    title: (n) => `Remove ${n}?`,
    question: (n) => (
      <>
        <strong className="text-ink font-medium">{n}</strong> will stop being
        assignable to new expenses, and will no longer be offered in the payer
        or split lists.
      </>
    ),
    consequence: (n) => (
      <>
        Expenses already split with {n} keep their name, their colour and their
        share. Nothing in the ledger is rewritten, and no history is lost.
      </>
    ),
    confirm: 'Remove member',
    busy: 'Removing…',
  },
  category: {
    title: (n) => `Archive ${n}?`,
    question: (n) => (
      <>
        <strong className="text-ink font-medium">{n}</strong> will no longer be
        offered when adding an expense.
      </>
    ),
    consequence: (n) => (
      <>
        Expenses already filed under {n} keep it. Nothing in the ledger is
        rewritten, and no history is lost.
      </>
    ),
    confirm: 'Archive category',
    busy: 'Removing…',
  },
  settlement: {
    title: () => 'Remove this payment?',
    question: (n) => (
      <>
        <strong className="text-ink font-medium">{n}</strong> stops counting
        against the balances.
      </>
    ),
    consequence: () => (
      <>
        The debt it cleared comes back. The expenses themselves are untouched,
        and you can record the payment again at any time.
      </>
    ),
    confirm: 'Remove payment',
    busy: 'Removing…',
  },
}

export function ConfirmRemoval({
  kind,
  name,
  isOwner = false,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: RemovalKind
  name: string
  /** Whether the leaver owns the household, so the handover can be mentioned. */
  isOwner?: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const copy = COPY[kind]

  return (
    <Sheet open onClose={onCancel} title={copy.title(name)}>
      <div className="pb-4 space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          {copy.question(name)}
        </p>

        {/*
         * The reassurance, as its own block rather than a second sentence in the
         * one above. This is the part people are actually anxious about.
         */}
        <p className="text-sm leading-relaxed rounded-[var(--radius-md)] border border-rule bg-[var(--color-paper-sunk)] p-3">
          {copy.consequence(name)}
        </p>

        {kind === 'member' && (
          <p className="text-xs leading-relaxed text-ink-faint">
            They also lose access to this household, so they will no longer be
            able to see it or add to it.
          </p>
        )}

        {/* The owner handover, said out loud because it is the one part of
            leaving that is not obvious: somebody else is about to be able to
            remove members from this household because of you. */}
        {kind === 'leave' && isOwner && (
          <p className="text-xs leading-relaxed text-ink-faint">
            You own this household, so the next member in will become its owner
            before you go.
          </p>
        )}

        <div className="flex gap-2.5 pt-1">
          <Button
            type="button"
            size="lg"
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? copy.busy : copy.confirm}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
