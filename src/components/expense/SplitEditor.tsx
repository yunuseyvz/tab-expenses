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
import { Label, Select } from '#/components/ui/Input'
import { NumberField } from '#/components/ui/NumberField'
import { Switch } from '#/components/ui/Switch'
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
        <Select
          id="paid-by"
          aria-label="Paid by"
          value={paidByMemberId ?? ''}
          onChange={(e) => onPaidByChange(e.target.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center justify-between py-1">
        <Label className="mb-0" htmlFor="split-toggle">
          Split between members
        </Label>
        <Switch
          id="split-toggle"
          checked={split}
          onChange={(next) => {
            onSplitChange(next)
            if (next && drafts.length === 0 && members.length > 0) {
              // Pre-fill from each member's default weight, falling back to an
              // even split when nobody has set one.
              const hasDefaults = members.some((m) => m.defaultWeightBp > 0)
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
        />
      </div>

      {split && (
        <div className="space-y-3">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={presetEvenPairs}
              className="text-xs text-terracotta-ink underline underline-offset-2"
            >
              50 / 50
            </button>
            <button
              type="button"
              onClick={presetEqual}
              className="text-xs text-terracotta-ink underline underline-offset-2"
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
                    <NumberField
                      value={String(d.weightBp / 100)}
                      onChange={(next) =>
                        setWeight(d.memberId, Number(next) * 100)
                      }
                      label={`${name} percent`}
                      suffix="%"
                      min={0}
                      max={100}
                      step={1}
                    />
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
                  className="range-tactile"
                  // --fill drives the whole track, so the filled and unfilled
                  // lengths cannot drift apart the way two separate values in a
                  // background gradient could.
                  style={{ '--fill': `${pct}%` } as React.CSSProperties}
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
