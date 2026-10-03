/**
 * Confirming the removal of a member or a category.
 *
 * One dialog for both, because the decision is the same shape: "this person or
 * this thing stops being part of the ledger, and here is exactly what that does
 * and does not undo". The two differ only in the nouns and in one line of
 * consequence, which is what `kind` is for.
 *
 * The wording is the whole point of having this at all. "Are you sure?" asks
 * nothing and answers nothing, so it trains people to click through dialogs. What
 * somebody actually wants to know before removing a housemate is whether the
 * last three months of groceries will suddenly be unaccounted for, and the
 * answer is no: archiving keeps every split that referenced them, with their
 * name and colour, exactly as it was.
 *
 * So the dialog says that plainly rather than treating it as a warning.
 */
import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'

export type RemovalKind = 'member' | 'category' | 'leave'

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
  const isMember = kind === 'member'
  const isLeave = kind === 'leave'

  return (
    <Sheet
      open
      onClose={onCancel}
      title={
        isLeave
          ? `Leave ${name}?`
          : isMember
            ? `Remove ${name}?`
            : `Archive ${name}?`
      }
    >
      <div className="pb-4 space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          {isLeave ? (
            <>
              You will lose access to{' '}
              <strong className="text-ink font-medium">{name}</strong>. You can
              join again only if an owner invites you back.
            </>
          ) : isMember ? (
            <>
              <strong className="text-ink font-medium">{name}</strong> will stop
              being assignable to new expenses, and will no longer be offered in
              the payer or split lists.
            </>
          ) : (
            <>
              <strong className="text-ink font-medium">{name}</strong> will no
              longer be offered when adding an expense.
            </>
          )}
        </p>

        {/*
         * The reassurance, as its own block rather than a second sentence in the
         * one above. This is the part people are actually anxious about, and it
         * is the opposite of a warning: nothing is rewritten and no history is
         * lost.
         */}
        <p className="text-sm leading-relaxed rounded-[var(--radius-md)] border border-rule bg-[var(--color-paper-sunk)] p-3">
          {isLeave ? (
            <>
              Your name stays on every expense you were part of. Nothing in the
              ledger is rewritten, and no history is lost.
            </>
          ) : isMember ? (
            <>
              Expenses already split with {name} keep their name, their colour
              and their share. Nothing in the ledger is rewritten, and no
              history is lost.
            </>
          ) : (
            <>
              Expenses already filed under {name} keep it. Nothing in the ledger
              is rewritten, and no history is lost.
            </>
          )}
        </p>

        {isMember && (
          <p className="text-xs leading-relaxed text-ink-faint">
            They also lose access to this household, so they will no longer be
            able to see it or add to it.
          </p>
        )}

        {/* The owner handover, said out loud because it is the one part of
            leaving that is not obvious: somebody else is about to be able to
            remove members from this household because of you. */}
        {isLeave && isOwner && (
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
            {busy
              ? isLeave
                ? 'Leaving…'
                : 'Removing…'
              : isLeave
                ? 'Leave household'
                : isMember
                  ? 'Remove member'
                  : 'Archive category'}
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
