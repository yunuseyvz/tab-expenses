import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { Category, SpaceMember } from '#/lib/db/schema'
import type {SplitDraft} from '#/components/expense/SplitEditor';
import { Sheet } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'
import { Input, Label, Textarea } from '#/components/ui/Input'
import {  SplitEditor } from '#/components/expense/SplitEditor'
import { createExpense } from '#/lib/expense.functions'
import { parseAmountToMinor } from '#/lib/money'
import { today } from '#/lib/period'
import { swatchColor } from '#/lib/swatches'

/**
 * New-expense entry. A bottom sheet on mobile (the entry point is a phone at a
 * checkout) and an inline panel on desktop.
 */
export function ExpenseSheet({
  open,
  onClose,
  spaceId,
  categories,
  members,
  currency = 'EUR',
}: {
  open: boolean
  onClose: () => void
  spaceId: string | null
  categories: Array<Category>
  members: Array<SpaceMember>
  currency?: string
}) {
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [spentOn, setSpentOn] = useState(today)
  const [paidByMemberId, setPaidByMemberId] = useState<string>('')
  const [split, setSplit] = useState(false)
  const [drafts, setDrafts] = useState<Array<SplitDraft>>([])

  // Guard the parse: a half-typed amount should not throw during render.
  const amountMinor = useMemo(() => {
    try {
      return amount ? parseAmountToMinor(amount) : 0
    } catch {
      return 0
    }
  }, [amount])

  const remainderBp = 10_000 - drafts.reduce((s, d) => s + d.weightBp, 0)
  const canSave =
    Boolean(spaceId) &&
    amountMinor > 0 &&
    purpose.trim().length > 0 &&
    paidByMemberId.length > 0 &&
    (!split || remainderBp === 0)

  const save = useMutation({
    mutationFn: () =>
      createExpense({
        data: {
          spaceId: spaceId!,
          amount,
          purpose: purpose.trim(),
          note: note.trim() || null,
          categoryId: categoryId || null,
          paidByMemberId,
          spentOn,
          splits: split ? drafts : [],
        },
      }),
    onSuccess: () => {
      toast.success('Expense added')
      // Every mutation invalidates the space-scoped keys: the headline, the
      // donut, the list, and the balances all read from them.
      void queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] })
      reset()
      onClose()
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the expense',
      )
    },
  })

  function reset() {
    setAmount('')
    setPurpose('')
    setNote('')
    setCategoryId('')
    setPaidByMemberId('')
    setSplit(false)
    setDrafts([])
  }

  if (!open) return null

  return (
    <Sheet open={open} onClose={onClose} title="New expense">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="amount">Amount</Label>
          <Input
            id="amount"
            // inputMode numeric gives a number pad on a phone without
            // blocking a comma decimal separator on a desktop keyboard.
            inputMode="decimal"
            autoComplete="off"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            aria-invalid={amount !== '' && amountMinor === 0}
            className="tnum text-2xl font-serif"
          />
        </div>

        <div>
          <Label htmlFor="purpose">What was it for</Label>
          <Input
            id="purpose"
            required
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Weekly shop"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="spent-on">Date</Label>
            <Input
              id="spent-on"
              type="date"
              required
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-paper-sunk px-3 py-2 text-ink rounded-[3px]
                shadow-[var(--shadow-deboss)] border-b-2 border-transparent
                focus:shadow-[var(--shadow-raise)] focus:border-terracotta
                focus:outline-none"
            >
              <option value="">Uncategorised</option>
              {categories
                .filter((c) => c.scope === 'shared' || c.ownerMemberId === paidByMemberId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.scope === 'personal' ? ' (personal)' : ''}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {categories
              .filter((c) => c.scope === 'shared' || c.ownerMemberId === paidByMemberId)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={categoryId === c.id}
                  className="text-xs px-2 py-1 rounded-[3px] border-l-4
                    bg-paper-sunk text-ink-muted"
                  style={{
                    borderLeftColor: swatchColor(c.color),
                    fontWeight: categoryId === c.id ? 600 : 400,
                  }}
                >
                  {c.name}
                </button>
              ))}
          </div>
        )}

        <hr className="border-rule" />

        <SplitEditor
          members={members}
          amountMinor={amountMinor}
          currency={currency}
          paidByMemberId={paidByMemberId}
          split={split}
          drafts={drafts}
          onSplitChange={setSplit}
          onPaidByChange={setPaidByMemberId}
          onDraftsChange={setDrafts}
        />

        <div>
          <Label htmlFor="note">Note (optional)</Label>
          <Textarea
            id="note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            size="lg"
            className="flex-1"
            disabled={!canSave || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save expense'}
          </Button>
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
