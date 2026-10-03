import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, Lock, LockOpen, StickyNote, Trash2 } from 'lucide-react'

import type { Category } from '#/lib/db/schema'
import type { MemberListItem } from '#/lib/space.functions'
import type { SplitDraft } from '#/components/expense/SplitEditor'
import type { ExpenseRow } from '#/lib/expense.functions'
import { Sheet } from '#/components/AppShell'
import { Avatar } from '#/components/Avatar'
import { Button } from '#/components/ui/Button'
import { DateField } from '#/components/ui/DateField'
import { Input, Label, Textarea } from '#/components/ui/Input'
import { Listbox } from '#/components/ui/Listbox'
import { CategoryDot } from '#/components/CategoryDot'
import { SplitEditor } from '#/components/expense/SplitEditor'
import {
  addExpenseNote,
  createExpense,
  deleteExpense,
  listExpenseNotes,
  setExpenseLock,
  updateExpense,
} from '#/lib/expense.functions'
import {
  MAX_AMOUNT,
  MAX_AMOUNT_MINOR,
  formatMoney,
  isAmountTooLarge,
  parseAmountToMinor,
} from '#/lib/money'
import { today } from '#/lib/period'
import { useMayEditExpense } from '#/hooks/useMayEditExpense'
import { cn } from '#/lib/cn'

/**
 * New-expense entry, editing an existing one, and viewing one you cannot edit.
 *
 * A bottom sheet on mobile (the entry point is a phone at a checkout) and a
 * centred dialog on desktop.
 *
 * Edit is not a separate component: the validation rules, the split editor and
 * the amount preview are the same either way, and the only real difference is
 * which server function is called at the end. Two copies of a split editor
 * would drift, and they always do.
 *
 * Read-only is not a separate component either, for the same reason. A row you
 * cannot edit still opens — a row that refuses to open reads as broken — and
 * the same sheet renders with every field inert, a banner saying whose entry
 * this is, and the notes underneath still writable. The notes are deliberately
 * *not* gated on edit rights: a note changes nothing about the amount, and
 * someone who cannot touch an entry is exactly who most needs to write under it.
 *
 * @param editing the entry to edit, or null to create. Prefill happens in an
 *   effect keyed on the id, so re-opening for a different entry refills the
 *   form while re-rendering the same one does not fight the user's typing.
 */
export function ExpenseSheet({
  open,
  onClose,
  spaceId,
  categories,
  members,
  currency = 'EUR',
  editing = null,
}: {
  open: boolean
  onClose: () => void
  spaceId: string | null
  categories: Array<Category>
  members: Array<MemberListItem>
  currency?: string
  editing?: ExpenseRow | null
}) {
  const queryClient = useQueryClient()
  const getEdit = useMayEditExpense()

  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [spentOn, setSpentOn] = useState(today)
  const [paidByMemberId, setPaidByMemberId] = useState<string>('')
  const [drafts, setDrafts] = useState<Array<SplitDraft>>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [noteBody, setNoteBody] = useState('')
  // The lock as last seen from the server, so the toggle reflects a write
  // without waiting for the list to refetch — the parent holds a row snapshot,
  // not a live subscription, so `editing.locked` goes stale the moment this
  // sheet changes it.
  const [locked, setLocked] = useState(false)

  const editingId = editing?.id ?? null

  // The roster as of this render, for the prefill effect below to read without
  // depending on. `members` is a fresh array identity on every refetch, and an
  // effect that depends on it re-runs the prefill on every one — which is how
  // the lock toggle used to snap back to unlocked a frame after succeeding:
  // the success invalidates the space keys, the roster refetches, the effect
  // re-ran, and the stale row snapshot overwrote the new value. Worse, the
  // same re-run wiped whatever the user was typing. Keyed on the expense id
  // instead, via the ref, so background refetches cannot touch the form.
  const membersRef = useRef(members)
  membersRef.current = members

  // Prefill for an edit, and clear for a create. Keyed on the id so typing in an
  // open editor is never reset by an unrelated re-render.
  useEffect(() => {
    if (!open) return
    setConfirmingDelete(false)
    setNoteBody('')
    if (!editing) {
      // Cleared inline rather than via reset(): that function is rebuilt on
      // every render, so putting it in the deps would re-run this constantly
      // and wipe what the user is typing.
      setAmount('')
      setPurpose('')
      setNote('')
      setCategoryId('')
      setPaidByMemberId('')
      setDrafts([])
      setLocked(false)
      return
    }
    setAmount((editing.amountMinor / 100).toFixed(2))
    setPurpose(editing.purpose)
    setNote(editing.note ?? '')
    setCategoryId(editing.categoryId ?? '')
    setSpentOn(editing.spentOn)
    setPaidByMemberId(editing.paidByMemberId)
    setLocked(editing.locked)

    /**
     * Every member in the stored split comes back ticked, including when there
     * is only one. A single-row split means the payer covered it alone, and that
     * has to read as "ticked, at 100%" rather than as "nobody" — otherwise
     * opening an existing expense and saving it unchanged would send an empty
     * split and silently change who owes what.
     */
    const stored = editing.splits.length
      ? editing.splits.map((s) => ({
          memberId: s.memberId,
          weightBp: s.weightBp,
        }))
      : [{ memberId: editing.paidByMemberId, weightBp: 10_000 }]

    // A removed member is still on this expense, but is no longer on the
    // roster, so the sheet must not offer to re-tick them. Their existing row is
    // kept exactly as stored — which is why this filters rather than rebuilding.
    // Read off the ref, not the prop: see above for why this effect cannot
    // depend on `members`.
    setDrafts(
      stored.filter((s) => membersRef.current.some((m) => m.id === s.memberId)),
    )
  }, [open, editingId])

  const editState = editing
    ? getEdit({ ...editing, locked })
    : { canEdit: true, reason: null as string | null, isAuthor: true }
  const readOnly = Boolean(editing) && !editState.canEdit
  const authorName = editing?.createdByName ?? null

  // Guard the parse: a half-typed amount should not throw during render.
  const amountMinor = useMemo(() => {
    try {
      return amount ? parseAmountToMinor(amount) : 0
    } catch {
      return 0
    }
  }, [amount])

  // Personal categories belong to one member, so the list depends on who paid —
  // which is why the dropdown rebuilds when the paid-by changes.
  const categoryOptions = categories.filter(
    (c) => c.scope === 'shared' || c.ownerMemberId === paidByMemberId,
  )

  /**
   * Whether the typed amount is over the ceiling.
   *
   * Read from the string rather than from `amountMinor`, because that is 0 for an
   * amount too big as well as for one that failed to parse — the two would be
   * indistinguishable and the field would say "zero" about a nine-figure number.
   */
  const amountTooLarge = amount.trim() !== '' && isAmountTooLarge(amount)

  const remainderBp = 10_000 - drafts.reduce((s, d) => s + d.weightBp, 0)
  const canSave =
    !readOnly &&
    Boolean(spaceId) &&
    amountMinor > 0 &&
    purpose.trim().length > 0 &&
    // Somebody has to be in it. With the switch gone, "nobody ticked" is the
    // only way to reach an expense nobody owes, so it is the thing to guard.
    drafts.length > 0 &&
    remainderBp === 0

  const invalidateLedger = () => {
    void queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] })
  }

  const save = useMutation({
    mutationFn: () =>
      editingId
        ? updateExpense({
            data: {
              spaceId: spaceId!,
              expenseId: editingId,
              amount,
              purpose: purpose.trim(),
              note: note.trim() || null,
              categoryId: categoryId || null,
              paidByMemberId,
              spentOn,
              // Always sent, never `[]`. An empty array means "the payer takes
              // all of it" to the server, and with a single member ticked the
              // split is already explicit — one row at 100%.
              splits: drafts,
            },
          })
        : createExpense({
            data: {
              spaceId: spaceId!,
              amount,
              purpose: purpose.trim(),
              note: note.trim() || null,
              categoryId: categoryId || null,
              paidByMemberId,
              spentOn,
              splits: drafts,
            },
          }),
    onSuccess: () => {
      toast.success(editingId ? 'Expense updated' : 'Expense added')
      // Every mutation invalidates the space-scoped keys: the headline, the
      // donut, the list, and the balances all read from them.
      invalidateLedger()
      reset()
      onClose()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the expense',
      )
    },
  })

  const remove = useMutation({
    mutationFn: () =>
      deleteExpense({
        data: { spaceId: spaceId!, expenseId: editingId! },
      }),
    onSuccess: () => {
      toast.success('Expense deleted')
      invalidateLedger()
      reset()
      onClose()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not delete the expense',
      )
      setConfirmingDelete(false)
    },
  })

  const flipLock = useMutation({
    mutationFn: (next: boolean) =>
      setExpenseLock({
        data: { spaceId: spaceId!, expenseId: editingId!, locked: next },
      }),
    // Optimistic: the toggle is the thing being pressed, and waiting for the
    // list to refetch before it moves makes it feel stuck.
    onMutate: (next) => setLocked(next),
    onSuccess: (res) => {
      setLocked(res.locked)
      invalidateLedger()
      toast.success(
        res.locked ? 'Locked — only you can change this' : 'Unlocked',
      )
    },
    onError: (err) => {
      setLocked(editing?.locked ?? false)
      toast.error(err instanceof Error ? err.message : 'Could not save')
    },
  })

  const notes = useQuery({
    queryKey: ['spaces', spaceId, 'notes', editingId],
    queryFn: () =>
      listExpenseNotes({
        data: { spaceId: spaceId!, expenseId: editingId! },
      }),
    enabled: open && Boolean(spaceId) && Boolean(editingId),
  })
  const noteList = notes.data ?? []

  const leaveNote = useMutation({
    mutationFn: (body: string) =>
      addExpenseNote({
        data: { spaceId: spaceId!, expenseId: editingId!, body },
      }),
    onSuccess: () => {
      setNoteBody('')
      void queryClient.invalidateQueries({
        queryKey: ['spaces', spaceId, 'notes', editingId],
      })
      // The list's marker only needs the count, and it reads from the
      // space-scoped keys.
      invalidateLedger()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the note',
      )
    },
  })

  function reset() {
    setAmount('')
    setPurpose('')
    setNote('')
    setCategoryId('')
    setPaidByMemberId('')
    setDrafts([])
    setConfirmingDelete(false)
    setNoteBody('')
  }

  if (!open) return null

  const title = !editing
    ? 'New expense'
    : readOnly
      ? 'View expense'
      : 'Edit expense'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      headerAction={
        editing ? (
          <button
            type="button"
            disabled={!editState.isAuthor || flipLock.isPending}
            onClick={() => flipLock.mutate(!locked)}
            aria-label={locked ? 'Unlock this expense' : 'Lock this expense'}
            aria-pressed={locked}
            title={
              editState.isAuthor
                ? locked
                  ? 'Locked — only you can change this'
                  : 'Unlocked — anyone can change this'
                : locked
                  ? 'Locked by the person who added this'
                  : 'Unlocked'
            }
            className={cn(
              'grid place-items-center size-9 shrink-0 rounded-full',
              'transition-[color,background-color] duration-150',
              locked
                ? 'text-[var(--color-terracotta)] bg-[var(--color-paper-sunk)]'
                : 'text-ink-faint hover:text-ink hover:bg-[var(--color-paper-sunk)]',
              'disabled:opacity-70 disabled:pointer-events-none',
            )}
          >
            {locked ? (
              <Lock size={17} aria-hidden />
            ) : (
              <LockOpen size={17} aria-hidden />
            )}
          </button>
        ) : undefined
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!readOnly) save.mutate()
        }}
        className="space-y-4 pb-1"
      >
        {/* Whose entry this is, when it is not yours. The row already refused
            nothing — it opened — so this banner is what makes "read-only"
            obvious rather than a form that silently does nothing. */}
        {readOnly && editing && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-[var(--radius-md)]
              border border-rule bg-[var(--color-paper-sunk)] p-3"
          >
            <Avatar
              avatarKey={editing.createdByAvatar}
              seed={
                editing.createdByUserId ?? editing.createdByName ?? 'unknown'
              }
              name={editing.createdByName ?? undefined}
              size={26}
            />
            <p className="text-sm leading-snug min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Eye
                  size={13}
                  aria-hidden
                  className="shrink-0 text-ink-faint"
                />
                {authorName
                  ? `${authorName}'s expense`
                  : "Someone else's expense"}
              </span>
              <span className="block text-xs text-ink-muted mt-0.5">
                {editState.reason ??
                  'You can look, but only they can change it.'}
              </span>
            </p>
          </div>
        )}

        <div>
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            // inputMode numeric gives a number pad on a phone without
            // blocking a comma decimal separator on a desktop keyboard.
            inputMode="decimal"
            autoComplete="off"
            required
            disabled={readOnly}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            // `max` does nothing for a text-mode numeric field on every browser,
            // so the cap is enforced in the validator and in the database. It is
            // here as the hint a numeric keypad offers on some platforms.
            max={MAX_AMOUNT}
            aria-invalid={
              amount !== '' && (amountMinor === 0 || amountTooLarge)
            }
            // Sans, matching the figures it will become. A serif at this size
            // fought the field it sits in rather than characterising it.
            className="tnum text-2xl font-medium tracking-tight"
          />
          {amountTooLarge && (
            <p role="alert" className="text-sm text-oxblood-ink mt-1.5">
              That is more than {formatMoney(MAX_AMOUNT_MINOR, currency)}. Check
              for a units slip — a total typed in cents, say.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="purpose">What was it for</Label>
          <Input
            id="purpose"
            required
            disabled={readOnly}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Weekly shop"
          />
        </div>

        {/* The two that belong together: when this expense happened, and what it
            was for. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="spent-on">Date</Label>
            <DateField
              id="spent-on"
              label="Date of the expense"
              value={spentOn}
              onChange={setSpentOn}
              disabled={readOnly}
            />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <Listbox
              id="category"
              // The <Label htmlFor> above names the *trigger*; the panel is a
              // separate element in a portal and needs naming too, or it reaches a
              // screen reader as an unnamed list of choices.
              label="Category"
              value={categoryId}
              onChange={setCategoryId}
              disabled={readOnly}
              options={[
                { value: '', label: 'Uncategorised' },
                ...categoryOptions.map((c) => ({
                  value: c.id,
                  label: `${c.name}${
                    c.scope === 'personal' ? ' (personal)' : ''
                  }`,
                  leading: <CategoryDot color={c.color} />,
                })),
              ]}
            />
          </div>
        </div>

        <hr className="border-rule" />

        <SplitEditor
          members={members}
          amountMinor={amountMinor}
          currency={currency}
          paidByMemberId={paidByMemberId}
          drafts={drafts}
          onPaidByChange={setPaidByMemberId}
          onDraftsChange={setDrafts}
          disabled={readOnly}
        />

        <div>
          <Label htmlFor="note">Note (optional)</Label>
          <Textarea
            id="note"
            rows={2}
            disabled={readOnly}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Sticky notes: the conversation under the entry. Shown for any saved
            expense, editable or not — leaving one is not editing, and gating it
            on edit rights would silence exactly the person who needs it. */}
        {editing && (
          <section aria-label="Notes" className="border-t border-rule pt-4">
            <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted mb-2.5">
              <StickyNote size={13} aria-hidden />
              Notes
              {noteList.length > 0 && (
                <span className="tnum">· {noteList.length}</span>
              )}
            </h3>

            {notes.isPending ? (
              <p className="text-sm text-ink-faint">Loading notes…</p>
            ) : notes.isError ? (
              <p className="text-sm text-oxblood-ink">Could not load notes.</p>
            ) : noteList.length === 0 ? (
              <p className="text-sm text-ink-faint">
                Nothing here yet. Leave the first one.
              </p>
            ) : (
              <ul className="space-y-2">
                {noteList.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-[var(--radius-md)] border border-rule
                      bg-[var(--color-paper-sunk)] px-3 py-2"
                  >
                    <p className="text-sm leading-snug whitespace-pre-wrap break-words">
                      {n.body}
                    </p>
                    <p className="flex items-center gap-1.5 mt-1.5 text-xs text-ink-faint">
                      <Avatar
                        avatarKey={n.authorAvatar}
                        seed={n.authorName}
                        name={n.authorName}
                        size={16}
                      />
                      <span className="truncate font-medium">
                        {n.authorName}
                      </span>
                      <span aria-hidden>·</span>
                      <time
                        dateTime={n.createdAt}
                        className="tnum truncate"
                        title={new Date(n.createdAt).toLocaleString()}
                      >
                        {new Date(n.createdAt).toLocaleDateString('en', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </time>
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2 mt-2.5">
              <Input
                aria-label="Leave a note"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Leave a note…"
                maxLength={2000}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const body = noteBody.trim()
                    if (body && !leaveNote.isPending) leaveNote.mutate(body)
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!noteBody.trim() || leaveNote.isPending}
                onClick={() => leaveNote.mutate(noteBody.trim())}
                className="shrink-0"
              >
                {leaveNote.isPending ? 'Saving…' : 'Add'}
              </Button>
            </div>
          </section>
        )}

        <div
          className="sticky bottom-0 -mx-5 px-5 pt-3
            bg-[var(--surface-material)]
            backdrop-blur-[var(--material-blur)]
            border-t border-rule
            /* Clears the iOS home indicator, which sits over the very bottom
               of a bottom sheet. Without this the Save button is under it on
               a device that has one. */
            pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          {readOnly ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={onClose}
              className="w-full"
            >
              Close
            </Button>
          ) : confirmingDelete ? (
            <div className="flex gap-2.5 items-center">
              <Button
                type="button"
                variant="danger"
                size="lg"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                className="flex-1"
              >
                {remove.isPending ? 'Deleting…' : 'Delete this expense?'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={remove.isPending}
                onClick={() => setConfirmingDelete(false)}
              >
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex gap-2.5">
              {/* The trash, red and on the left where a destructive action
                  belongs: before the thing it destroys rather than after it.
                  Icon-only because the row already says what it deletes, and a
                  word beside every Save would teach people to read past it. */}
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label={`Delete ${editing.purpose}`}
                  title={`Delete ${editing.purpose}`}
                  className="shrink-0 px-3 text-[var(--color-danger-fill)] hover:text-[var(--color-danger-fill)]"
                >
                  <Trash2 size={18} aria-hidden />
                </Button>
              )}
              <Button
                type="submit"
                size="lg"
                className="flex-1"
                disabled={!canSave || save.isPending}
              >
                {save.isPending
                  ? 'Saving…'
                  : editing
                    ? 'Save changes'
                    : 'Save expense'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={onClose}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </form>
    </Sheet>
  )
}
