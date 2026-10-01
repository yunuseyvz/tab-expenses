/**
 * The split editor.
 *
 * Toggle Split off → one row, the payer takes 100%. On → a row per member with
 * a tactile slider and a numeric field, pre-filled from each member's
 * defaultWeightBp.
 *
 * Two deliberate choices:
 *  · The per-member euro preview is live while dragging, so rounding is visible
 *    and the number is trustworthy rather than something to verify after save.
 *  · Weights are never renormalised behind the user's back. The remainder is
 *    shown prominently instead, because silently rescaling 60/40 to 63/37
 *    would misrepresent what was entered.
 */
import { useMemo } from 'react'

import type { SpaceMember } from '#/lib/db/schema'
import { Label } from '#/components/ui/Input'
import { allocate, formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

export interface SplitDraft {
  memberId: string
  weightBp: number
}

export function SplitEditor({
  members,
  amountMinor,
  currency,
  paidByMemberId,
  split,
  drafts,
  onSplitChange,
  onPaidByChange,
  onDraftsChange,
}: {
  members: Array<SpaceMember>
  amountMinor: number
  currency: string
  paidByMemberId: string | null
  split: boolean
  drafts: Array<SplitDraft>
  onSplitChange: (v: boolean) => void
  onPaidByChange: (memberId: string) => void
  onDraftsChange: (next: Array<SplitDraft>) => void
}) {
  const remainderBp = useMemo(
    () => 10_000 - drafts.reduce((s, d) => s + d.weightBp, 0),
    [drafts],
  )
  const valid = remainderBp === 0

  // Preview uses the same allocate() the server uses, so the number on screen
  // is the number that gets stored.
  const preview = useMemo(() => {
    if (!valid || drafts.length === 0) return new Map<string, number>()
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

  function presetEqual() {
    if (members.length === 0) return
    const even = Math.floor(10_000 / members.length)
    onDraftsChange(
      members.map((m, i) => ({
        memberId: m.id,
        // The first member absorbs the rounding remainder so the total is exact.
        weightBp: i === 0 ? even + (10_000 - even * members.length) : even,
      })),
    )
  }

  function presetEvenPairs() {
    if (members.length === 0) return
    const half = members.slice(0, 2)
    onDraftsChange([
      { memberId: half[0]!.id, weightBp: 5000 },
      { memberId: (half[1] ?? half[0]!).id, weightBp: 5000 },
    ])
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="paid-by">Paid by</Label>
        <select
          id="paid-by"
          value={paidByMemberId ?? ''}
          onChange={(e) => onPaidByChange(e.target.value)}
          required
          className="w-full bg-paper-sunk px-3 py-2 text-ink rounded-[3px]
            shadow-[var(--shadow-deboss)] border-b-2 border-transparent
            focus:shadow-[var(--shadow-raise)] focus:border-terracotta
            focus:outline-none"
        >
          <option value="" disabled>
            Choose…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between py-1">
        <Label className="mb-0" htmlFor="split-toggle">
          Split between members
        </Label>
        <button
          id="split-toggle"
          type="button"
          role="switch"
          aria-checked={split}
          onClick={() => {
            const next = !split
            onSplitChange(next)
            if (next && drafts.length === 0 && members.length > 0) {
              // Pre-fill from each member's default weight, falling back to an
              // even split when nobody has set one.
              const hasDefaults = members.some(
                (m) => m.defaultWeightBp > 0,
              )
              if (hasDefaults) {
                onDraftsChange(
                  members.map((m) => ({
                    memberId: m.id,
                    weightBp: m.defaultWeightBp,
                  })),
                )
              } else {
                presetEqual()
              }
            }
          }}
          className="relative h-6 w-11 shrink-0 rounded-full transition-shadow duration-150"
          style={{
            background: split
              ? 'var(--color-terracotta)'
              : 'var(--color-paper-sunk)',
            boxShadow: split ? 'var(--shadow-raise)' : 'var(--shadow-deboss)',
          }}
        >
          {/* Physical switch: thumb translates, track shifts deboss → raise. */}
          <span
            aria-hidden
            className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white
              transition-transform duration-150"
            style={{
              transform: split ? 'translateX(20px)' : 'translateX(0)',
              boxShadow: 'var(--shadow-raise)',
            }}
          />
        </button>
      </div>

      {split && (
        <div className="space-y-3">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={presetEvenPairs}
              className="text-xs text-terracotta underline underline-offset-2"
            >
              50 / 50
            </button>
            <button
              type="button"
              onClick={presetEqual}
              className="text-xs text-terracotta underline underline-offset-2"
            >
              Equal
            </button>
          </div>

          {drafts.map((d) => {
            const member = members.find((m) => m.id === d.memberId)
            const name = member?.displayName ?? 'Member'
            const pct = d.weightBp / 100
            return (
              <div key={d.memberId}>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-sm flex items-center gap-1.5 min-w-0 truncate">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: swatchColor(member?.color ?? '') }}
                    />
                    {name}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {/* Live euro preview: rounding made visible. */}
                    <span className="tnum text-xs text-ink-faint">
                      {preview.has(d.memberId)
                        ? formatMoney(preview.get(d.memberId)!, currency)
                        : '—'}
                    </span>
                    <div className="relative">
                      <input
                        type="number"
                        value={d.weightBp / 100}
                        step={1}
                        min={0}
                        max={100}
                        onChange={(e) =>
                          setWeight(d.memberId, Number(e.target.value) * 100)
                        }
                        aria-label={`${name} percent`}
                        className="tnum w-16 bg-paper-sunk pl-2 pr-5 py-1 text-right
                          text-sm rounded-[3px] shadow-[var(--shadow-deboss)]
                          border-b-2 border-transparent focus:outline-none
                          focus:shadow-[var(--shadow-raise)]
                          focus:border-terracotta"
                      />
                      <span
                        aria-hidden
                        className="absolute right-1.5 top-1/2 -translate-y-1/2
                          text-xs text-ink-faint pointer-events-none"
                      >
                        %
                      </span>
                    </div>
                  </span>
                </div>
                {/* Tactile thumb on a debossed groove. */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={d.weightBp / 100}
                  onChange={(e) =>
                    setWeight(d.memberId, Number(e.target.value) * 100)
                  }
                  aria-label={`${name} split slider`}
                  className="w-full h-1.5 rounded-full cursor-pointer appearance-none
                    shadow-[var(--shadow-deboss)]"
                  style={{
                    background: `linear-gradient(to right,
                      var(--color-terracotta) ${pct}%,
                      var(--color-paper-sunk) ${pct}%)`,
                  }}
                />
              </div>
            )
          })}

          <p
            role="status"
            className="tnum text-sm font-medium"
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
        </div>
      )}
    </div>
  )
}
