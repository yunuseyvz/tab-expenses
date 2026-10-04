import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, Lock, LockOpen, Plus, StickyNote, Trash2, X } from 'lucide-react'

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
  deleteExpenseNote,
  listExpenseNotes,
  setExpenseLock,
  updateExpense,
} from '#/lib/expense.functions'
import { getSession } from '#/lib/auth.functions'
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
  const me = useQuery({ queryKey: ['session'], queryFn: () => getSession() })

  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  // The note field on a NEW expense only. It is sent with the create and stored
  // as the entry's first note — there is no second place to write the same
  // thing any more. Edits never touch it: remarks live in the notes section.
  const [firstNote, setFirstNote] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [spentOn, setSpentOn] = useState(today)
  const [paidByMemberId, setPaidByMemberId] = useState<string>('')
  const [drafts, setDrafts] = useState<Array<SplitDraft>>([])
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [noteBody, setNoteBody] = useState('')
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)
  // The lock as last seen from the server, so the toggle reflects a write
  // without waiting for the list to refetch — the parent holds a row snapshot,
  // not a live subscription, so `editing.locked` goes stale the moment this
  // sheet changes it.
  const [locked, setLocked] = useState(false)

  const editingId = editing?.id ?? null
  const formId = useId()

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
      setFirstNote('')
      setCategoryId('')
      setPaidByMemberId('')
      setDrafts([])
      // New entries start locked: the author decides whether the household may
      // change them. See `expense.locked`.
      setLocked(true)
      return
    }
    setAmount((editing.amountMinor / 100).toFixed(2))
    setPurpose(editing.purpose)
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
              note: firstNote.trim() || null,
              locked,
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

  const removeNote = useMutation({
    mutationFn: (noteId: string) =>
      deleteExpenseNote({
        data: { spaceId: spaceId!, expenseId: editingId!, noteId },
      }),
    onMutate: (noteId) => setDeletingNoteId(noteId),
    onSettled: () => setDeletingNoteId(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['spaces', spaceId, 'notes', editingId],
      })
      invalidateLedger()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not delete the note',
      )
    },
  })

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
    setFirstNote('')
    setCategoryId('')
    setPaidByMemberId('')
    setDrafts([])
    setLocked(true)
    setConfirmingDelete(false)
    setNoteBody('')
    setDeletingNoteId(null)
  }

  if (!open) return null

  const title = !editing
    ? 'New expense'
    : readOnly
      ? 'View expense'
      : 'Edit expense'

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={title}
        headerAction={
          // On a new expense the toggle is local state that rides along with
          // the create: you are the author of what you are typing, so it is
          // always yours to press. On an existing one it writes through
          // `setExpenseLock`, author-only.
          <button
            type="button"
            disabled={
              editing ? !editState.isAuthor || flipLock.isPending : false
            }
            onClick={() =>
              editing ? flipLock.mutate(!locked) : setLocked(!locked)
            }
            // No aria-label, deliberately. It used to name the ACTION
            // ("Unlock this expense") while the visible text named the STATE,
            // and since aria-label wins, a screen reader heard the opposite of
            // what was on screen — the badge said Locked and the announcement
            // said Unlock. The name is the visible word now, and aria-pressed
            // carries that it is a toggle.
            aria-pressed={locked}
            title={
              !editing || editState.isAuthor
                ? locked
                  ? 'Locked — only you can change this'
                  : 'Unlocked — anyone can change this'
                : locked
                  ? 'Locked by the person who added this'
                  : 'Unlocked'
            }
            className={cn(
              // A badge, not a bare icon. The lock is the only thing in the
              // sheet that changes what other people may do to the entry, and an
              // unlabelled padlock in the corner says neither what it controls
              // nor which way it is set — the icon flips between two glyphs that
              // are near-identical at 17px. The word carries the state, the icon
              // carries the meaning, and the fill carries that it is pressable.
              'inline-flex items-center gap-1.5 h-8 shrink-0',
              'pl-2.5 pr-3 rounded-full',
              'text-[0.7rem] font-medium uppercase tracking-wide',
              'transition-colors duration-150',
              locked
                ? 'text-[var(--color-terracotta)] bg-[var(--color-paper-sunk)]'
                : 'text-ink-faint hover:text-ink hover:bg-[var(--color-paper-sunk)]',
              'disabled:opacity-70 disabled:pointer-events-none',
            )}
          >
            {locked ? (
              <Lock size={14} aria-hidden />
            ) : (
              <LockOpen size={14} aria-hidden />
            )}
            {locked ? 'Locked' : 'Unlocked'}
          </button>
        }
        footer={
          <div
            className="px-5 pt-3
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
            ) : (
              // The two footers crossfade through AnimatePresence in "wait"
              // mode rather than swapping synchronously — and that is
              // load-bearing, not polish. Flipping `confirmingDelete` back
              // unmounts the pressed Keep button mid-dispatch while the
              // replacement holds the form's submit button, and the browser
              // then completes the gesture on Save, silently saving whatever
              // is typed (reproduced with event tracing: submitter=Save, no
              // click on Save). With an exit animation the pressed footer
              // stays mounted through the whole dispatch and unmounts later,
              // asynchronously, with no gesture left to complete onto
              // anything. `mode="wait"` so the two never overlap into a
              // double-height footer.
              <AnimatePresence mode="wait" initial={false}>
                {confirmingDelete ? (
                  <motion.div
                    key="confirm"
                    className="flex gap-2.5 items-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    {/* Neither button submits: the confirm calls the delete
                    directly, and Keep only flips this footer back. */}
                    <Button
                      type="button"
                      variant="danger"
                      size="lg"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate()}
                      className="flex-1"
                    >
                      {remove.isPending ? 'Deleting…' : 'Delete expense'}
                    </Button>
                    <Button
                      type="button"
                      // Secondary, matching Cancel. Keep is the same action as
                      // Cancel — leave the sheet as it was — so it gets the same
                      // treatment. As a ghost it had no edge at all, and beside a
                      // full-width danger button it read as loose text rather
                      // than as the other half of a choice.
                      variant="secondary"
                      size="lg"
                      disabled={remove.isPending}
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="actions"
                    className="flex gap-2.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
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
                      form={formId}
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
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        }
      >
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault()
            if (!readOnly) save.mutate()
          }}
          className="space-y-4 pb-4"
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
                That is more than {formatMoney(MAX_AMOUNT_MINOR, currency)}.
                Check for a units slip — a total typed in cents, say.
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

          {/* The note field lives on a new expense only, where it becomes the
            entry's first note. On an existing expense there is exactly one
            place to write — the notes below — and this field used to be a
            second one with different rules and no link between them. */}
          {!editing && (
            <div>
              <Label htmlFor="note">Note (optional)</Label>
              <Textarea
                id="note"
                rows={2}
                value={firstNote}
                onChange={(e) => setFirstNote(e.target.value)}
                placeholder="Receipt in the drawer…"
              />
            </div>
          )}

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
                <p className="text-sm text-oxblood-ink">
                  Could not load notes.
                </p>
              ) : noteList.length === 0 ? (
                <p className="text-sm text-ink-faint">
                  Nothing here yet. Leave the first one.
                </p>
              ) : (
                <ul className="space-y-2">
                  {noteList.map((n) => {
                    // Yours to take back, or under your entry to moderate.
                    // Anyone else's remark on anyone else's entry is not yours
                    // to touch.
                    const mayRemoveNote =
                      (me.data?.user.id != null &&
                        n.authorUserId === me.data.user.id) ||
                      editState.isAuthor
                    return (
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
                          {mayRemoveNote && (
                            <button
                              type="button"
                              onClick={() => removeNote.mutate(n.id)}
                              disabled={deletingNoteId === n.id}
                              aria-label={`Delete note by ${n.authorName}`}
                              title={`Delete note by ${n.authorName}`}
                              className="ml-auto grid place-items-center size-6 shrink-0
                              rounded-full text-ink-faint
                              transition-[color,background-color,opacity] duration-150
                              hover:text-[var(--color-danger-fill)]
                              hover:bg-[var(--color-paper-raised)]
                              disabled:opacity-40"
                            >
                              <X size={13} aria-hidden />
                            </button>
                          )}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* The input is a fixed-height field and the icon button is a fixed
                  square; without items-center the two sit on different
                  baselines and the plus reads as floating. */}
              <div className="flex gap-2 mt-2.5 items-center">
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
                {/* A plus, not a word. The input already says what it does, so a
                    label beside it repeats the sentence — and a round plus reads
                    as "add one more", which is what a sticky note is. */}
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  disabled={!noteBody.trim() || leaveNote.isPending}
                  onClick={() => leaveNote.mutate(noteBody.trim())}
                  aria-label="Add note"
                  title="Add note"
                  className="shrink-0"
                >
                  <Plus size={17} aria-hidden />
                </Button>
              </div>
            </section>
          )}

          {/* Provenance, set small and quiet at the bottom of the sheet: who
              typed this in and when. It is the only place the author is named
              in full, which is also what makes a read-only entry legible as
              somebody else's rather than as a dead end. Nothing to tap, so it
              is a paragraph and not a row.

              Its own rule above it, because it is not part of the form: the
              fields stop, and this is the entry's own record. Without the rule
              it read as one more line of the notes block above it, and the
              dates in the two are different dates — when it was added, not when
              somebody last said something about it. */}
          {editing && (
            <p className="text-xs text-ink-faint mt-5 border-t border-rule pt-3.5">
              Added by {editing.createdByName ?? 'someone'}
              {' · '}
              <time dateTime={editing.createdAt}>
                {new Date(editing.createdAt).toLocaleDateString('en', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </time>
            </p>
          )}
        </form>
      </Sheet>
    </>
  )
}
