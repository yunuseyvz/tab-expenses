/**
 * Who paid, and how the cost is shared.
 *
 * ONE list, not three. This section used to be three stacked blocks — "Who paid"
 * as a radio list, "Split among" as a checkbox list, "Split" as a slider list —
 * over the same roster, so a three-person household listed nine names and nine
 * avatars and carried three uppercase headings to answer two questions. The
 * questions were separated for a real reason (they used to be one checkbox list
 * where ticking elected both the split AND the payer, with nothing on screen
 * saying so), but the answer did not have to be three copies of the roster.
 *
 * Now every fact about a person lives on their row: the tick is whether they
 * are in the split, the pill on the right is who paid, and the share is the
 * euro figure and slider underneath, shown only for people who are actually in
 * it. One name, one avatar, one row. The two questions stay separately labelled
 * and separately operable; they just stopped repeating themselves.
 *
 * The pill is a radio behind the scenes, so it is one-per-group by construction
 * rather than by a handler that has to untick the last one by hand.
 *
 * Equal is still the default, because it is right far more often than anything
 * else and a household that wants 60/40 can drag to it. Rows are independent of
 * each other, deliberately: renormalising every edit made a typed 60/30/10
 * unreachable, and a status line that reports a total which is not 100% is a
 * better trade than a control that rewrites the numbers you did not touch.
 *
 * The euro figure is live while dragging, so rounding is visible and the number
 * is trustworthy rather than something to verify after saving. It is also the
 * loudest thing on the row and the percentage the quiet one, because "Fede is
 * owed €12.50" is the fact this sheet exists to record and 25% is not.
 */
import { useMemo } from 'react'

import type { MemberListItem } from '#/lib/space.functions'
import { MemberAvatar } from '#/components/MemberAvatar'
import { NumberField } from '#/components/ui/NumberField'
import { allocate, formatMoney } from '#/lib/money'
import { cn } from '#/lib/cn'

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
 *
 * The rounding lands on the first row rather than being spread a basis point at
 * a time, so two rows never read 33.33% while a third absorbs the difference.
 */
export function equalWeights(count: number): Array<number> {
  return evenSplit(count, 10_000)
}

/** The same thing at any total, because a departing member's share arrives as
 * one. A plain 100/3 is only available at 10 000. */
function evenSplit(count: number, totalBp: number): Array<number> {
  if (count === 0) return []
  const even = Math.floor(totalBp / count)
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? totalBp - even * (count - 1) : even,
  )
}

/**
 * Hand `totalBp` basis points out to `weights`, in proportion, exactly.
 *
 * Largest-remainder, same idea as the server's allocate(): floor each share, then
 * hand the leftover to the largest fractions first. Deterministic, and the sum
 * is exactly `totalBp` rather than a basis point or two out — which is the whole
 * point here, because the total is what Save checks.
 *
 * A zero weight sum falls back to an even split, because it means every weight
 * is zero and dividing by it is not an answer.
 */
function apportion(weights: Array<number>, totalBp: number): Array<number> {
  const count = weights.length
  if (count === 0) return []

  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return evenSplit(count, totalBp)

  const exact = weights.map((w) => (w / sum) * totalBp)
  const out = exact.map((e) => Math.floor(e))
  let leftover = totalBp - out.reduce((a, b) => a + b, 0)

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (leftover === 0) break
    out[i] = out[i]! + 1
    leftover -= 1
  }
  return out
}

/**
 * Move one person's share, and leave everybody else's alone.
 *
 * This was proportional for a while, and it was wrong. Renormalising on every
 * edit means a person can never type a split they actually meant: set 60, then
 * 30, and the third lands somewhere nobody chose, because the second keystroke
 * already rescaled the first row's neighbour. For a three-way dinner bill —
 * 60/30/10, the single most common thing anyone enters here — the canonical
 * answer was literally unreachable, arrived at by three careful steps.
 *
 * Independent rows can be wrong in aggregate, which is why the status line
 * reports it and why Save waits. That is a visible, explicable state with a
 * one-tap way out. An invisible rule that quietly rewrites the numbers beside the
 * one being edited is a different thing, and it is worse: the sheet and the
 * ledger can disagree about what was typed.
 *
 * Pure and exported so that "only this row moved" is asserted rather than
 * assumed, having been assumed once already.
 */
export function setWeight(
  drafts: Array<SplitDraft>,
  memberId: string,
  bp: number,
): Array<SplitDraft> {
  return drafts.map((d) =>
    d.memberId === memberId
      ? { ...d, weightBp: Math.max(0, Math.min(10_000, Math.round(bp))) }
      : d,
  )
}

/**
 * Someone stops sharing: their share goes back to everybody else, in proportion
 * to what they already had, and the total stays exactly 10 000.
 *
 * Both edges of this were broken before. Dropping to one person left the
 * survivor on 50%, so the sheet said "50% left to assign" for a row that was
 * never shared, with no slider on screen to fix it. Dropping 3 to 2 left 33/33
 * and blocked Save for the same reason. Re-equalising flat would have fixed the
 * numbers and thrown away a 60/40 somebody set on purpose; redistributing the
 * share keeps the ratio they chose.
 *
 * Note what this deliberately does NOT do: touch the payer. Unticking used to
 * move "who paid" to the first remaining tick, because ticking elected the
 * payer. The payer is chosen separately now, so the split only ever changes
 * who shares — unticking the payer leaves them as the payer, which is what "I
 * covered your ticket" means.
 */
export function releaseWeight(
  drafts: Array<SplitDraft>,
  memberId: string,
): Array<SplitDraft> {
  const leaving = drafts.find((d) => d.memberId === memberId)
  const next = drafts.filter((d) => d.memberId !== memberId)
  if (next.length === 0) return next

  // The leaver's share is divided among whoever is left in proportion to what
  // they already had, so a 60/25/15 split that loses its 15 becomes 70.6/29.4
  // rather than 70/30 — and the ratio somebody set on purpose is still the ratio
  // afterwards.
  //
  // One exception, and it is the common case: if the people left were already
  // splitting evenly (within a basis point of it, which is all integers allow at
  // three ways), they stay even. Distributing proportionally there turns a third
  // person's departure into 50.01/49.99, which is arithmetically right and reads
  // as noise: the header would offer to "fix" a split nobody had touched.
  const pool = next.map((d) => d.weightBp)
  const share = leaving?.weightBp ?? 0

  // The pool sums to 10 000 minus the leaver's share, so handing the share back
  // out of proportion lands the total on exactly 10 000.
  //
  // The exception is a pool that was already even, where the answer is simply
  // "everyone who is left, equal" — and equalWeights is already the exact full
  // 10 000 split, so there is nothing to add. Doing it the other way, by
  // dividing the leaver's share between the two remaining rows, is what turned
  // the 3334/3333/3333 roster the UI actually produces into 5001/4999: an exact
  // total on a split nobody made uneven, which the header then reads as uneven
  // and offers to level.
  if (Math.max(...pool) - Math.min(...pool) <= 1) {
    const levelled = equalWeights(pool.length)
    return next.map((d, i) => ({ ...d, weightBp: levelled[i]! }))
  }

  const handed = apportion(pool, share)
  return next.map((d, i) => ({ ...d, weightBp: d.weightBp + handed[i]! }))
}

export function SplitEditor({
  members,
  amountMinor,
  currency,
  paidByMemberId,
  drafts,
  onPaidByChange,
  onDraftsChange,
  disabled = false,
}: {
  members: Array<MemberListItem>
  amountMinor: number
  currency: string
  paidByMemberId: string | null
  drafts: Array<SplitDraft>
  onPaidByChange: (memberId: string) => void
  onDraftsChange: (next: Array<SplitDraft>) => void
  /** Read-only: figures stay legible, every control goes inert. */
  disabled?: boolean
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

  function moveWeight(memberId: string, bp: number) {
    onDraftsChange(setWeight(drafts, memberId, bp))
  }

  /** Tick or untick, keeping the roster order so the list stays scannable. */
  function toggle(memberId: string) {
    if (drafts.some((d) => d.memberId === memberId)) {
      onDraftsChange(releaseWeight(drafts, memberId))
      return
    }

    addToSplit(memberId)
  }

  /**
   * Tick one more person, re-equalised — see `equalWeights` for why the whole
   * list moves rather than just the newcomer.
   */
  function addToSplit(memberId: string) {
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
  }

  /**
   * Name the payer — and nobody else, which is the whole point of this function
   * existing separately from `toggle`.
   *
   * Picking them adds them to the split when they are not in it: somebody who
   * paid for the household is usually sharing it, and "pick Fede, then also
   * tick Fede" would be the same undiscoverable two-step the old list had.
   * Unticking them afterwards is allowed and keeps them as the payer, so the
   * direction is one-way on purpose: choosing implies sharing, unsharing never
   * unchooses.
   */
  function selectPayer(memberId: string) {
    onPaidByChange(memberId)
    if (!isInSplit(memberId)) addToSplit(memberId)
  }

  function isInSplit(memberId: string) {
    return drafts.some((d) => d.memberId === memberId)
  }

  /** Everybody in, shares equal. One tap for the common case. */
  function presetEveryone() {
    if (members.length === 0) return
    const weights = equalWeights(members.length)
    onDraftsChange(
      members.map((m, i) => ({ memberId: m.id, weightBp: weights[i]! })),
    )
  }

  function presetEqual() {
    if (drafts.length === 0) return
    const weights = equalWeights(drafts.length)
    onDraftsChange(drafts.map((d, i) => ({ ...d, weightBp: weights[i]! })))
  }

  const inSplit = new Set(drafts.map((d) => d.memberId))

  /**
   * Whether the shares are actually uneven. One basis point of difference counts
   * as even: `equalWeights` puts the rounding remainder on the first row, so a
   * three-way split reads 3334/3333/3333 and would otherwise offer to "fix" a
   * split that is already as equal as integers allow.
   */
  const uneven = useMemo(() => {
    if (drafts.length < 2) return false
    const weights = drafts.map((d) => d.weightBp)
    return Math.max(...weights) - Math.min(...weights) > 1
  }, [drafts])

  /**
   * One reset, and only ever one, because "Everyone" and "Equal" were two
   * underlined links in two different corners doing overlapping jobs — which is
   * why neither was obvious. Whoever is not already sharing can be added, or the
   * shares can be levelled; whichever is actually outstanding gets the button,
   * and when neither is, the header just says the split is equal.
   *
   * `remainderBp !== 0` is a third reason to offer one, and it was missing for a
   * while: three people on 30/30/30 is perfectly EVEN and sums to 90, so the
   * levelling button did not appear, the header read "Split equally", Save was
   * disabled, and the only way out was to do the arithmetic by hand. A reset that
   * only shows up when its own idea of "needs fixing" lines up is not a way out;
   * Save being disabled is.
   */
  const canAddMore = drafts.length < members.length
  const offerReset =
    canAddMore || remainderBp !== 0 || (uneven && drafts.length > 1)

  return (
    <fieldset>
      {/* The real legend is for screen readers only: a <legend> inside this flex
          row would stop being a legend in most engines. */}
      <legend className="sr-only">Who paid and who it is split between</legend>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Split between
        </span>

        {offerReset ? (
          <button
            type="button"
            onClick={canAddMore ? presetEveryone : presetEqual}
            disabled={disabled}
            className="text-xs text-terracotta-ink underline underline-offset-2
              disabled:opacity-40 disabled:no-underline
              motion-reduce:no-underline"
          >
            {canAddMore ? 'Everyone' : 'Equal'}
          </button>
        ) : drafts.length > 1 ? (
          <span className="text-xs text-ink-faint">Split equally</span>
        ) : null}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-ink-faint">
          Add someone to this household first.
        </p>
      ) : (
        <div className="-mx-2">
          {members.map((m) => {
            const included = inSplit.has(m.id)
            const isPayer = paidByMemberId === m.id
            const draft = drafts.find((d) => d.memberId === m.id)
            const pct = draft ? draft.weightBp / 100 : 0
            /**
             * At most one decimal. The stored weight is exact basis points, but
             * `weightBp / 100` printed raw is "25.18", and a five-character
             * number in a field four characters wide scrolls its own last digit
             * out of sight — which then reads as a wrong number rather than a
             * clipped one. Rounding for display only: the euro figure beside it
             * is the exact one, because that is what `allocate` computes.
             */
            const pctText = Number.isInteger(pct)
              ? String(pct)
              : (Math.round(pct * 10) / 10).toFixed(1)

            return (
              <div key={m.id} className="px-2 py-1.5">
                <div className="flex items-center gap-3">
                  {/* Tick = in the split. Whole name area is the target, because
                      the checkbox is a checkbox first and a 1.15rem one.
                      Someone who is not sharing steps back here — but the payer
                      pill beside it stays at full strength, because not sharing
                      and not being able to have paid are different things. */}
                  <label
                    className={cn(
                      'flex items-center gap-3 min-w-0 flex-1',
                      'transition-opacity duration-150',
                      !included && !disabled ? 'opacity-55' : '',
                      disabled ? '' : 'cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => toggle(m.id)}
                      disabled={disabled}
                      aria-label={`${m.displayName} is part of this expense`}
                      className="size-[1.15rem] rounded accent-[var(--color-terracotta)]
                        shrink-0 cursor-pointer disabled:cursor-default disabled:opacity-50"
                    />
                    <MemberAvatar
                      memberId={m.id}
                      avatar={m.userAvatar}
                      name={m.displayName}
                      size={20}
                    />
                    <span className="text-sm truncate min-w-0">
                      {m.displayName}
                    </span>
                  </label>

                  {/*
                    Who paid, as a pill rather than another radio list. It is a
                    real radio underneath — one per group by construction, no
                    handler that has to remember to untick the last one.

                    Only the payer says Paid. Every row used to say it, filled
                    for the payer and faint for everyone else, and three PAIDs
                    read as a status column rather than a choice — nothing said
                    tappable, nothing said one. Now the unselected state is an
                    outlined action ("Set payer") and the selected state is the
                    filled fact ("Paid"), so action and state never share a word.
                    In read-only there is no action left, so only the fact shows.
                  */}
                  {disabled && !isPayer ? null : (
                    <label
                      className={cn(
                        'shrink-0 select-none',
                        disabled ? '' : 'cursor-pointer',
                      )}
                      title={
                        isPayer
                          ? `${m.displayName} paid for this`
                          : `Set ${m.displayName} as payer`
                      }
                    >
                      <input
                        type="radio"
                        name="expense-payer"
                        checked={isPayer}
                        onChange={() => selectPayer(m.id)}
                        disabled={disabled}
                        aria-label={`${m.displayName} paid`}
                        className="sr-only peer"
                      />
                      <span
                        className={cn(
                          'inline-flex items-center h-8 px-3 rounded-full border',
                          'text-[0.7rem] font-medium uppercase tracking-wide',
                          'transition-colors duration-150',
                          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
                          'peer-focus-visible:outline-[var(--color-terracotta)]',
                          // Ink on terracotta, not white, for the same reason the
                          // primary button is: 4.8:1 against 2.6:1, and it reads
                          // as ink on paper, which is the art direction anyway.
                          isPayer
                            ? 'border-transparent bg-[var(--color-terracotta)] text-ink'
                            : 'border-rule text-ink-muted hover:border-terracotta-ink hover:text-ink',
                        )}
                      >
                        {isPayer ? 'Paid' : 'Set payer'}
                      </span>
                    </label>
                  )}
                </div>

                {/*
                  The share, under the row it belongs to and only for somebody in
                  it: a person who is not sharing has no percentage to show, and
                  inventing a 0% row made a non-participation look like an error.

                  Hidden entirely at one sharer, because with nobody to take the
                  other half from, a slider there could only ever break the total.
                */}
                {included && drafts.length > 1 && (
                  <div className="pl-[2.125rem] mt-0.5 flex items-center gap-3">
                    {/* Live euro figure: rounding made visible, so the number is
                        trustworthy rather than something to check after. The
                        loud thing on the row — the percentage it is derived from
                        is the detail, not the fact. */}
                    <span
                      className="tnum text-sm font-medium text-ink
                        w-[3.5rem] shrink-0 tabular-nums"
                    >
                      {preview.has(m.id)
                        ? formatMoney(preview.get(m.id)!, currency)
                        : '—'}
                    </span>

                    {/* Tactile thumb on a debossed groove. */}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={pct}
                      disabled={disabled}
                      onChange={(e) =>
                        moveWeight(m.id, Number(e.target.value) * 100)
                      }
                      aria-label={`${m.displayName} split`}
                      className="range-tactile flex-1 min-w-0 disabled:opacity-50"
                      // --fill drives the whole track, so filled and unfilled
                      // lengths cannot drift apart the way two values in a
                      // background gradient could.
                      style={{ '--fill': `${pct}%` } as React.CSSProperties}
                    />

                    {/* The stepper stays: a slider cannot land on 33, and a
                        household ledger is full of thirds. */}
                    <NumberField
                      value={pctText}
                      onChange={(next) => moveWeight(m.id, Number(next) * 100)}
                      label={`${m.displayName} percent`}
                      suffix="%"
                      min={0}
                      max={100}
                      step={1}
                      disabled={disabled}
                      className="shrink-0"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/*
        Only ever something to fix. There used to be a sage "Totals 100%" here,
        which is true almost every time the section is on screen, and a line that
        is almost always true is a line people learn to stop reading — which is
        exactly what happens to the red one when it finally matters.

        This is the report for a total that is not 100%, and the reason the rows
        are left independent: the sheet says so, and Save waits, rather than the
        numbers next to yours quietly changing instead.
      */}
      <p
        role="status"
        className="text-sm font-medium mt-2 empty:hidden"
        style={{
          color:
            drafts.length === 1 ? 'var(--color-sage)' : 'var(--color-oxblood)',
        }}
      >
        {drafts.length === 0
          ? 'Nobody is sharing this yet'
          : drafts.length === 1
            ? `${members.find((m) => m.id === drafts[0]!.memberId)?.displayName ?? 'They'} covered all of it`
            : // Nothing to say when the total is right. Falling through to the
              // over-assigned branch here is what printed "0% over-assigned" on
              // every single split, which is worse than no line at all.
              remainderBp === 0
              ? ''
              : remainderBp > 0
                ? `${remainderBp / 100}% left to assign`
                : `${-remainderBp / 100}% over-assigned`}
      </p>
    </fieldset>
  )
}
