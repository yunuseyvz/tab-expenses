/**
 * Confirming the deletion of your own account.
 *
 * Deliberately not ConfirmRemoval. That dialog exists to explain that nothing is
 * lost — archiving keeps every split, every name, every balance — so it reads as
 * reassurance. This one is the opposite: it is the only thing in the app that
 * cannot be undone, and a dialog whose job is to make you feel safe is the wrong
 * instrument. So it states the loss instead of softening it, and it asks you to
 * type the address on the account rather than offering a single button to regret.
 *
 * What it has to be honest about is the knock-on effects, because "your account
 * is gone" is not what actually happens to the data:
 *
 *   - Every expense you entered keeps your name on it. It has to: the ledger
 *     records what happened, and the person who typed it in is not the person who
 *     paid for it.
 *   - Households you are on survive, minus you.
 *   - A household you *own* and are the last registered member of is deleted
 *     outright, with its expenses. There is no way to keep it, because no one
 *     would be left who can open it.
 *   - A household you are merely *on* is kept even if that leaves it without an
 *     owner. It belongs to whoever owned it, and deleting somebody else's ledger
 *     because you were the last person with an account on it would be the wrong
 *     kind of tidy.
 *
 * The counts come from the server. The settings screen has loaded the roster of
 * the household currently open and nothing else, so anything about the others had
 * to be asked for rather than inferred.
 */
import { useState } from 'react'

import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'
import { Input, Label } from '#/components/ui/Input'

export function ConfirmAccountDeletion({
  email,
  staying,
  going,
  orphaned,
  loading,
  failed,
  busy,
  onCancel,
  onConfirm,
}: {
  email: string
  /** Households kept, because somebody else is still on them. */
  staying: number
  /** Households deleted, because you were the only registered member. */
  going: number
  /**
   * Households left behind with nobody able to administer them. Not deleted —
   * they belong to somebody else — but the user is the last person who could
   * have reached them, so they deserve to hear it before clicking.
   */
  orphaned: number
  /**
   * The counts are still on their way. The confirm button waits for them,
   * because a dialog reading "0 households deleted" while the real answer is
   * still loading is worse than one that has not answered yet — and a failed
   * lookup must not read as "nothing is lost" either.
   */
  loading: boolean
  failed: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: (email: string) => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim().toLowerCase() === email.toLowerCase()
  const blocked = loading || failed || busy

  return (
    <Sheet open onClose={onCancel} title="Delete your account?">
      <div className="pb-4 space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Your name, address and avatar are deleted. This cannot be undone.
        </p>

        <ul className="text-sm leading-relaxed rounded-[var(--radius-md)] border border-rule bg-[var(--color-paper-sunk)] p-3 space-y-2 list-disc pl-8 text-ink-muted">
          {loading && <li>Working out what this affects…</li>}
          {failed && (
            <li>
              Could not work out what this affects. Nothing has been deleted.
            </li>
          )}
          {!blocked && staying > 0 && (
            <li>
              You leave{' '}
              <strong className="text-ink font-medium">
                {staying} household{staying === 1 ? '' : 's'}
              </strong>
              . The others keep the ledger.
            </li>
          )}
          {!blocked && going > 0 && (
            <li>
              {going === 1 ? 'The household' : `${going} households`} you were
              the last member of {going === 1 ? 'is' : 'are'} deleted, expenses
              included.
            </li>
          )}
          {!blocked && orphaned > 0 && (
            <li>
              {orphaned === 1
                ? 'One household is'
                : `${orphaned} households are`}{' '}
              left with nobody who can run {orphaned === 1 ? 'it' : 'them'}.
              They are kept, not deleted.
            </li>
          )}
          <li>Expenses you entered keep your name on them.</li>
        </ul>

        {/*
         * The address is asked for on the client because it is the human being
         * we are checking with, and again on the server because server functions
         * are just HTTP endpoints and this check is the only thing standing
         * between a stray call and an unrecoverable delete. One of the two
         * without the other would be theatre.
         */}
        <div>
          <Label htmlFor="confirm-account">Type your address to confirm</Label>
          <Input
            id="confirm-account"
            autoComplete="off"
            autoFocus
            spellCheck={false}
            value={typed}
            placeholder={email}
            disabled={blocked}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>

        <div className="flex gap-2.5 pt-1">
          <Button
            type="button"
            size="lg"
            variant="danger"
            className="flex-1"
            disabled={blocked || !matches}
            onClick={() => onConfirm(typed)}
          >
            {busy ? 'Deleting…' : 'Delete account'}
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
