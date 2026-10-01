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

export type RemovalKind = 'member' | 'category'

export function ConfirmRemoval({
  kind,
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: RemovalKind
  name: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const isMember = kind === 'member'

  return (
    <Sheet
      open
      onClose={onCancel}
      title={isMember ? `Remove ${name}?` : `Archive ${name}?`}
    >
      <div className="pb-4 space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          {isMember ? (
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
          {isMember ? (
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
              ? 'Removing…'
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
