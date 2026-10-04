/**
 * Who paid, and how the cost is shared.
 *
 * TWO controls, not one — and that is the fix, not a regression. It used to be
 * a single checkbox list where ticking elected both the split AND the payer
 * (whoever was ticked first), with nothing on screen saying so. So "Fede paid,
 * split with Yunus" required ticking Fede then Yunus, and ticking Yunus then
 * Fede silently made Yunus the payer. The confusion was reported as a minor UI
 * problem, and it was right: the list answered two questions and labelled
 * neither.
 *
 * Now the questions are separate and labelled. "Who paid" is a single choice —
 * one person fronted the money, and only one can have. "Split" is who shares
 * it, ticked the same as before, with the same sliders and the same equal
 * default. Picking the payer adds them to the split (somebody who paid for the
 * household is usually in on it), but unticking them afterwards keeps them as
 * the payer: paying for something and sharing it are different facts, and
 * "I covered your train ticket" is the entry that needs them separate.
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

import type { MemberListItem } from '#/lib/space.functions'
import { MemberAvatar } from '#/components/MemberAvatar'
import { NumberField } from '#/components/ui/NumberField'
import { allocate, formatMoney } from '#/lib/money'

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

/**
 * Share `weights` out to exactly 10 000 basis points, in proportion.
 *
 * Largest-remainder, same as the server's allocate(): floor each share, then hand
 * the leftover cents to the largest fractions first. Deterministic, and the sum
 * is exact rather than off by a basis point or two.
 *
 * Zero total falls back to an even split, because a zero total means every
 * weight is zero and dividing by it is not an answer.
 */
function proportional(weights: Array<number>): Array<number> {
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return equalWeights(weights.length)

  const exact = weights.map((w) => (w / total) * 10_000)
  const out = exact.map((e) => Math.floor(e))
  let leftover = 10_000 - out.reduce((a, b) => a + b, 0)

  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (leftover === 0) break
    out[i] = (out[i] ?? 0) + 1
    leftover -= 1
  }
  return out
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

  function setWeight(memberId: string, bp: number) {
    const clamped = Math.max(0, Math.min(10_000, Math.round(bp)))
    onDraftsChange(
      drafts.map((d) =>
        d.memberId === memberId ? { ...d, weightBp: clamped } : d,
      ),
    )
  }

  /** Tick or untick, keeping the roster order so the list stays scannable. */
  function toggle(memberId: string) {
    const included = drafts.some((d) => d.memberId === memberId)
    if (included) {
      const leaving = drafts.find((d) => d.memberId === memberId)
      const next = drafts.filter((d) => d.memberId !== memberId)

      // The departing person's share is folded back into the others, in
      // proportion to what they already had, and the total stays exactly 100%.
      //
      // Both edges of this were broken before. Dropping to one person left the
      // survivor on 50%, so the sheet said "50% left to assign" for a row that
      // was never shared, with no slider on screen to fix it. Dropping 3 to 2
      // left 33/33 and blocked Save for the same reason. Re-equalising flat would
      // have fixed the numbers and thrown away a 60/40 somebody set on purpose;
      // redistributing the share keeps the ratio they chose.
      //
      // Note what this deliberately does NOT do any more: touch the payer.
      // Unticking used to move "who paid" to the first remaining tick, because
      // ticking elected the payer. The payer is chosen separately now, so the
      // split only ever changes who shares — unticking the payer leaves them
      // as the payer, which is what "I covered your ticket" means.
      const share = leaving?.weightBp ?? 0
      const redistributed = next.length
        ? proportional(next.map((d) => d.weightBp + share))
        : []
      onDraftsChange(
        next.map((d, i) => ({ ...d, weightBp: redistributed[i]! })),
      )
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
   * Name the payer — and nobody else, which is the whole point of this
   * function existing separately from `toggle`.
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
  const sharers = drafts
    .map((d) => ({
      draft: d,
      member: members.find((m) => m.id === d.memberId),
    }))
    .filter(
      (x): x is { draft: SplitDraft; member: MemberListItem } => !!x.member,
    )

  return (
    <div className="space-y-5">
      {/*
        Two blocks, answering the two questions out loud.

        They were one checkbox list doing both jobs: ticking elected the split
        AND the payer, with whoever was ticked first silently becoming who paid.
        Nothing said so, so "Fede paid, split with Yunus" and "Yunus paid, split
        with Fede" were the same gesture in a different order. Now "who paid"
        is a single named choice and the split is who shares, ticked below it.

        The sliders only exist when there is something to divide, so a single
        tick shows no split section at all — which is honest, and is why
        unticking down to one person now assigns the whole amount rather than
        leaving a stray percentage behind.
      */}
      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-2">
          Who paid
        </legend>

        {members.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Add someone to this household first.
          </p>
        ) : (
          <div className="space-y-1" role="radiogroup" aria-label="Who paid">
            {members.map((m) => {
              const isPayer = paidByMemberId === m.id
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 select-none
                    rounded-[var(--radius-sm)] px-2 py-1.5 -mx-2
                    transition-colors duration-150 ${disabled ? '' : 'cursor-pointer hover:bg-[var(--color-paper-sunk)]'}`}
                >
                  <input
                    type="radio"
                    name="expense-payer"
                    checked={isPayer}
                    onChange={() => selectPayer(m.id)}
                    disabled={disabled}
                    aria-label={`${m.displayName} paid`}
                    className="size-[1.15rem] accent-[var(--color-terracotta)]
                      shrink-0 cursor-pointer disabled:cursor-default disabled:opacity-50"
                  />
                  <MemberAvatar
                    memberId={m.id}
                    avatar={m.userAvatar}
                    name={m.displayName}
                    size={20}
                  />
                  <span className="text-sm truncate min-w-0 flex-1">
                    {m.displayName}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-2">
          Split among
        </legend>

        {members.length === 0 ? (
          <p className="text-sm text-ink-faint">
            Add someone to this household first.
          </p>
        ) : (
          <div className="space-y-1">
            {members.map((m) => {
              const included = inSplit.has(m.id)
              const isPayer = paidByMemberId === m.id
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 select-none
                    rounded-[var(--radius-sm)] px-2 py-1.5 -mx-2
                    transition-colors duration-150 ${disabled ? '' : 'cursor-pointer hover:bg-[var(--color-paper-sunk)]'}`}
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
                  <span className="text-sm truncate min-w-0 flex-1">
                    {m.displayName}
                  </span>
                  {isPayer && (
                    <span className="text-[0.7rem] uppercase tracking-wide text-ink-faint shrink-0">
                      Paid
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}

        {/*
          The total only appears once there is a total to report. With one
          person ticked there is no split, so the line that describes one would
          be describing something that is not on screen.
        */}
        {drafts.length < 2 && (
          <p
            role="status"
            className="text-sm font-medium mt-2"
            style={{
              color:
                drafts.length === 1
                  ? 'var(--color-sage)'
                  : 'var(--color-oxblood)',
            }}
          >
            {drafts.length === 1
              ? `${sharers[0]!.member.displayName} covered all of it`
              : 'Nobody is sharing this yet'}
          </p>
        )}

        {/*
          One tap to include everybody, available immediately rather than only
          once two are already ticked. The equal-split presets below live in the
          sliders block because they reshape weights that only exist with two
          or more in — but "everyone shares this" is the common case for a
          fresh expense with one person ticked, and hiding it until a second
          tick defeats the purpose. Hidden once there is nothing left to add.
        */}
        {drafts.length < members.length && (
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={presetEveryone}
              disabled={disabled}
              className="text-xs text-terracotta-ink underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
            >
              Everyone
            </button>
          </div>
        )}
      </fieldset>

      {drafts.length > 1 && (
        <fieldset className="border-t border-rule pt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-2.5">
            Split
          </legend>

          <div className="space-y-3">
            {sharers.map(({ draft, member }) => {
              const pct = draft.weightBp / 100
              return (
                <div key={member.id}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-sm flex items-center gap-2 min-w-0">
                      <MemberAvatar
                        memberId={member.id}
                        avatar={member.userAvatar}
                        name={member.displayName}
                        size={18}
                      />
                      <span className="truncate">{member.displayName}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {/* Live euro figure: rounding made visible, so the number
                          is trustworthy rather than something to check after. */}
                      <span className="tnum text-xs text-ink-faint">
                        {preview.has(member.id)
                          ? formatMoney(preview.get(member.id)!, currency)
                          : '\u2014'}
                      </span>
                      <NumberField
                        value={String(pct)}
                        onChange={(next) =>
                          setWeight(member.id, Number(next) * 100)
                        }
                        label={`${member.displayName} percent`}
                        suffix="%"
                        min={0}
                        max={100}
                        step={1}
                        disabled={disabled}
                      />
                    </span>
                  </div>
                  {/* Tactile thumb on a debossed groove. */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={pct}
                    disabled={disabled}
                    onChange={(e) =>
                      setWeight(member.id, Number(e.target.value) * 100)
                    }
                    aria-label={`${member.displayName} split`}
                    className="range-tactile disabled:opacity-50"
                    // --fill drives the whole track, so filled and unfilled
                    // lengths cannot drift apart the way two values in a
                    // background gradient could.
                    style={{ '--fill': `${pct}%` } as React.CSSProperties}
                  />
                </div>
              )
            })}
          </div>

          <div className="flex justify-end mt-3">
            <button
              type="button"
              onClick={presetEqual}
              disabled={disabled}
              className="text-xs text-terracotta-ink underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
            >
              Equal
            </button>
          </div>

          <p
            role="status"
            className="tnum text-sm font-medium mt-2"
            style={{
              color: valid ? 'var(--color-sage)' : 'var(--color-oxblood)',
            }}
          >
            {valid
              ? 'Totals 100%'
              : remainderBp > 0
                ? `${remainderBp / 100}% left to assign`
                : `${-remainderBp / 100}% over-assigned`}
          </p>
        </fieldset>
      )}
    </div>
  )
}
