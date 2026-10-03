/**
 * Who paid, and how the cost is shared.
 *
 * One control, not two. It used to be a "Paid by" dropdown above a "Split
 * between members" switch, which asked the same question twice and had a third
 * state to reason about: with the switch off the split editor was hidden and the
 * payer took 100%, so ticking two people required discovering a switch first,
 * and the switch said nothing about whether it was the right thing to do.
 *
 * Ticking somebody now *is* the split. The first person ticked is the payer who
 * fronted the money; everybody ticked shares it. Nothing is hidden behind a
 * toggle because there is no toggle to hide behind.
 *
 * Equal is the default, because it is right far more often than anything else
 * and a household that wants 60/40 can drag to it. The split is not renormalised
 * behind anyone's back either: the remainder is stated, loudly, rather than
 * silently rescaling what was entered.
 *
 * The euro figure is live while dragging, so rounding is visible and the number
 * is trustworthy rather than something to verify after saving.
 */
import { useMemo } from 'react'

import type { SpaceMember } from '#/lib/db/schema'
import { NumberField } from '#/components/ui/NumberField'
import { allocate, formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

export interface SplitDraft {
  memberId: string
  weightBp: number
}

/**
 * Ticking one more person changes what "equal" means for everybody.
 *
 * 3 people sharing → tick a 4th → four equal quarters, not three (or a 4th at
 * whatever percentage made the total work). Leaving the existing weights alone
 * would leave the sheet showing 100% assigned the moment a person is added,
 * which reads as a bug: you ticked somebody and the numbers refused to move.
 * Re-equalising is the only thing that matches what the tick meant.
 */
function equalWeights(count: number): Array<number> {
  const even = Math.floor(10_000 / count)
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? 10_000 - even * (count - 1) : even,
  )
}

export function SplitEditor({
  members,
  amountMinor,
  currency,
  paidByMemberId,
  drafts,
  onPaidByChange,
  onDraftsChange,
}: {
  members: Array<SpaceMember>
  amountMinor: number
  currency: string
  paidByMemberId: string | null
  drafts: Array<SplitDraft>
  onPaidByChange: (memberId: string) => void
  onDraftsChange: (next: Array<SplitDraft>) => void
}) {
  const remainderBp = useMemo(
    () => 10_000 - drafts.reduce((s, d) => s + d.weightBp, 0),
    [drafts],
  )
  const valid = remainderBp === 0 && drafts.length > 0

  // Uses the same allocate() the server uses, so the figure on screen is the
  // figure that gets stored.
  const preview = useMemo(() => {
    if (!valid) return new Map<string, number>()
    try {
      const shares = allocate(
        amountMinor,
        drafts.map((d) => d.weightBp),
      )
      return new Map(drafts.map((d, i) => [d.memberId, shares[i]!]))
    } catch {
      return new Map<string, number>()
    }
  }, [amountMinor, drafts, valid])

  function setWeight(memberId: string, bp: number) {
    const clamped = Math.max(0, Math.min(10_000, Math.round(bp)))
    onDraftsChange(
      drafts.map((d) =>
        d.memberId === memberId ? { ...d, weightBp: clamped } : d,
      ),
    )
  }

  /** Tick or untick, keeping the roster order so the payer stays first-ticked. */
  function toggle(memberId: string) {
    const included = drafts.some((d) => d.memberId === memberId)
    if (included) {
      const next = drafts.filter((d) => d.memberId !== memberId)
      onDraftsChange(next)
      // The payer cannot be someone who is not in the split. The first
      // remaining tick inherits it, which is what somebody unticking themselves
      // from a shared purchase would expect.
      if (paidByMemberId === memberId) {
        onPaidByChange(next[0]?.memberId ?? '')
      }
      return
    }

    const next = [...drafts, { memberId, weightBp: 0 }].sort(
      (a, b) =>
        members.findIndex((m) => m.id === a.memberId) -
        members.findIndex((m) => m.id === b.memberId),
    )
    // Re-equalised rather than zeroed: a 0% row is not a participation, it is a
    // validation error waiting to happen.
    const weights = equalWeights(next.length)
    onDraftsChange(
      next.map((d, i) => ({ memberId: d.memberId, weightBp: weights[i]! })),
    )
    if (!paidByMemberId) onPaidByChange(memberId)
  }

  function presetEqual() {
    if (drafts.length === 0) return
    const weights = equalWeights(drafts.length)
    onDraftsChange(drafts.map((d, i) => ({ ...d, weightBp: weights[i]! })))
  }

  function presetEvenPairs() {
    if (drafts.length < 2) return
    onDraftsChange(drafts.map((d, i) => ({ ...d, weightBp: i < 2 ? 5000 : 0 })))
  }

  const inSplit = new Set(drafts.map((d) => d.memberId))

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1.5">
        Paid by
      </legend>

      {members.length === 0 && (
        <p className="text-sm text-ink-faint">
          Add someone to this household first.
        </p>
      )}

      <div className="space-y-2.5">
        {members.map((m) => {
          const draft = drafts.find((d) => d.memberId === m.id)
          const included = inSplit.has(m.id)
          const isPayer = paidByMemberId === m.id
          const pct = draft ? draft.weightBp / 100 : 0

          return (
            <div key={m.id}>
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => toggle(m.id)}
                  aria-label={`${m.displayName} is part of this expense`}
                  className="size-[1.15rem] rounded accent-[var(--color-terracotta)]
                    shrink-0 cursor-pointer"
                />
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: swatchColor(m.color) }}
                />
                <span className="text-sm truncate min-w-0 flex-1">
                  {m.displayName}
                </span>
                {isPayer && (
                  <span className="text-[0.7rem] uppercase tracking-wide text-ink-faint shrink-0">
                    Paid
                  </span>
                )}
              </label>

              {/*
                Sliders appear for ticked members only, and a slider for one
                person is a useless 0-or-100 control — so a single tick shows the
                share as a figure and nothing else.
              */}
              {included && drafts.length > 1 && (
                <div className="pl-[2.65rem] mt-1.5">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="tnum text-xs text-ink-faint">
                      {preview.has(m.id)
                        ? formatMoney(preview.get(m.id)!, currency)
                        : '—'}
                    </span>
                    <NumberField
                      value={String(draft!.weightBp / 100)}
                      onChange={(next) => setWeight(m.id, Number(next) * 100)}
                      label={`${m.displayName} percent`}
                      suffix="%"
                      min={0}
                      max={100}
                      step={1}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={pct}
                    onChange={(e) =>
                      setWeight(m.id, Number(e.target.value) * 100)
                    }
                    aria-label={`${m.displayName} split`}
                    className="range-tactile"
                    // --fill drives the whole track, so filled and unfilled
                    // lengths cannot drift apart the way two values in a
                    // background gradient could.
                    style={{ '--fill': `${pct}%` } as React.CSSProperties}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {drafts.length > 1 && (
        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={presetEvenPairs}
            className="text-xs text-terracotta-ink underline underline-offset-2"
          >
            First two only
          </button>
          <button
            type="button"
            onClick={presetEqual}
            className="text-xs text-terracotta-ink underline underline-offset-2"
          >
            Equal
          </button>
        </div>
      )}

      <p
        role="status"
        className="tnum text-sm font-medium"
        style={{
          color: valid ? 'var(--color-sage)' : 'var(--color-oxblood)',
        }}
      >
        {drafts.length === 0
          ? 'Nobody is sharing this yet'
          : valid
            ? drafts.length === 1
              ? `${members.find((m) => m.id === drafts[0]!.memberId)?.displayName ?? 'They'} paid all of it`
              : 'Totals 100%'
            : remainderBp > 0
              ? `${remainderBp / 100}% left to assign`
              : `${-remainderBp / 100}% over-assigned`}
      </p>
    </fieldset>
  )
}
