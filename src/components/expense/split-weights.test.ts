/**
 * The split weights, as maths rather than as pixels.
 *
 * Two things are asserted here, and the second one exists because the first was
 * got wrong.
 *
 * The invariant is that `releaseWeight` — unticking somebody — leaves the total
 * at exactly 10 000. That one always held, and it is what stops unticking from
 * stranding the sheet at "50% left to assign" with no slider on screen to fix it.
 *
 * The regression is the other direction. Dragging one slider USED to rescale
 * everyone else so the total could never break, and that was tried here because
 * the failure it fixed is real: a total that drifts blocks Save with only the
 * drift to explain it. But renormalising on every edit means a person cannot
 * type a split they meant — set 60, then 30, and the third lands nowhere they
 * chose, because the second keystroke had already rescaled the first row's
 * neighbour. A 60/30/10 dinner bill, the most common entry in the whole sheet,
 * was unreachable by three careful steps.
 *
 * So the rows are independent and the maths says so. `setWeight` moves exactly
 * one row and is asserted to touch nothing else, which is the behaviour that was
 * quietly assumed before it was ever checked.
 */
import { describe, expect, it } from 'vitest'

import type { SplitDraft } from '#/components/expense/SplitEditor'
import {
  equalWeights,
  releaseWeight,
  setWeight,
} from '#/components/expense/SplitEditor'

const sum = (drafts: Array<SplitDraft>) =>
  drafts.reduce((s, d) => s + d.weightBp, 0)

const weights = (drafts: Array<SplitDraft>) =>
  Object.fromEntries(drafts.map((d) => [d.memberId, d.weightBp]))

const three: Array<SplitDraft> = [
  { memberId: 'sam', weightBp: 3334 },
  { memberId: 'alex', weightBp: 3333 },
  { memberId: 'robin', weightBp: 3333 },
]

describe('equalWeights', () => {
  it('is exactly 100% for any roster size', () => {
    // 10 000 is not divisible by 3, by 6 or by 7, so these are the sizes where
    // a naive divide leaves people a fraction of a percent short.
    for (let n = 1; n <= 12; n++) {
      expect(equalWeights(n).reduce((a, b) => a + b, 0)).toBe(10_000)
    }
  })

  it('splits as evenly as integers allow', () => {
    const w = equalWeights(3)
    expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(1)
  })
})

describe('setWeight', () => {
  it('moves exactly one row and touches nothing else', () => {
    // The assertion that was missing when this was proportional. If it ever goes
    // back to rescaling the others, this line catches it, and the reason is in
    // the file header: renormalising makes a typed split unreachable.
    expect(weights(setWeight(three, 'sam', 6000))).toEqual({
      sam: 6000,
      alex: 3333,
      robin: 3333,
    })
  })

  it('leaves a typed 60/30/10 exactly as typed', () => {
    // The regression, in the form it reached a person: three keystrokes on a
    // dinner bill. Under proportional rebalancing the third row landed at 10
    // and the first at 33, which is not the split anybody meant to enter.
    let d = setWeight(three, 'sam', 6000)
    d = setWeight(d, 'alex', 3000)
    d = setWeight(d, 'robin', 1000)
    expect(weights(d)).toEqual({ sam: 6000, alex: 3000, robin: 1000 })
  })

  it('reverses cleanly, because nothing else moved', () => {
    expect(setWeight(setWeight(three, 'sam', 7240), 'sam', 3334)).toEqual(three)
  })

  it('reports an out-of-range total rather than silently correcting it', () => {
    // 60 + 30 + 0 = 90. The status line says "10% left to assign" and Save waits,
    // which is a visible state with a one-tap way out. Quietly moving those 10
    // points into somebody else's row is the alternative, and it is worse: the
    // sheet can then disagree with what was typed.
    let d = setWeight(three, 'sam', 6000)
    d = setWeight(d, 'alex', 3000)
    d = setWeight(d, 'robin', 0)
    expect(sum(d)).toBe(9000)
  })

  it('clamps outside 0-100 rather than producing a negative share', () => {
    expect(weights(setWeight(three, 'sam', -500))).toEqual({
      sam: 0,
      alex: 3333,
      robin: 3333,
    })
    expect(weights(setWeight(three, 'sam', 99_999))).toEqual({
      sam: 10_000,
      alex: 3333,
      robin: 3333,
    })
  })

  it('rounds the value typed into the percentage box', () => {
    // "74.8" arrives as 7480.xx and has to become whole basis points, or the
    // field holds a fraction of a percent the slider cannot even represent.
    expect(weights(setWeight(three, 'sam', 7480.4))).toEqual({
      sam: 7480,
      alex: 3333,
      robin: 3333,
    })
  })

  it('does not add a person who is not in the split', () => {
    expect(setWeight(three, 'nobody', 5000)).toEqual(three)
  })
})

describe('releaseWeight', () => {
  it("hands the leaver's share back in proportion", () => {
    expect(
      weights(
        releaseWeight(
          [
            { memberId: 'sam', weightBp: 6000 },
            { memberId: 'alex', weightBp: 2500 },
            { memberId: 'robin', weightBp: 1500 },
          ],
          'robin',
        ),
      ),
      // 15 points shared between 60 and 25 in that ratio: 10.6 to Sam, 4.4 to Alex,
      // and the two extra basis points of rounding go to Sam — 70.59/29.41 rather
      // than the clean 70/30, because apportion has to land on whole points.
      //
      // The version this replaced added the whole 15 to BOTH of them and
      // renormalised, which handed Sam 65.2 and Alex 34.8. That kept the sum exact
      // and quietly flattened the ratio, which is the only part of a custom split
      // anybody chose on purpose.
    ).toEqual({ sam: 7059, alex: 2941 })
  })

  it('leaves the survivor with everything, not 50%', () => {
    // The bug this replaced: dropping to one person left the survivor on half,
    // so the sheet said "50% left to assign" for a row that was never shared,
    // with no slider on screen to fix it and Save refused to go.
    expect(releaseWeight(three, 'alex')).toEqual([
      { memberId: 'sam', weightBp: 5000 },
      { memberId: 'robin', weightBp: 5000 },
    ])
    expect(releaseWeight(releaseWeight(three, 'alex'), 'robin')).toEqual([
      { memberId: 'sam', weightBp: 10_000 },
    ])

    // Exactly 50/50. The roster the UI actually produces at three ways is
    // 3334/3333/3333, so the pair left behind is 3334/3333 — inside the one
    // basis point that three-way integers allow, and therefore already even. If
    // the leaver's 3333 were simply divided between those two it would land
    // 5001/4999: an exact total on a split nobody made uneven, which the header
    // then reads as uneven and offers to level. Flattening the pool to a true
    // 50/50 before handing the share back is what keeps it honest.
    expect(releaseWeight(three, 'alex')).toEqual([
      { memberId: 'sam', weightBp: 5000 },
      { memberId: 'robin', weightBp: 5000 },
    ])
    expect(releaseWeight(releaseWeight(three, 'alex'), 'robin')).toEqual([
      { memberId: 'sam', weightBp: 10_000 },
    ])
  })

  it('keeps the total at exactly 100% for every roster and every leaver', () => {
    const roster = ['a', 'b', 'c', 'd', 'e']
    for (let n = 2; n <= roster.length; n++) {
      // Deliberately uneven fixtures, not equal ones: a leaver's share being
      // divided proportionally is the branch with the arithmetic in it, and an
      // even roster takes the snap-to-even path instead and would never run it.
      const raw = roster
        .slice(0, n)
        .map((memberId, i) => ({ memberId, weightBp: 1000 + i * 733 }))
      // Normalised so the fixture itself is a valid split — otherwise the test
      // is asserting that an already-broken split stays broken.
      const total = raw.reduce((s, d) => s + d.weightBp, 0)
      const drafts: Array<SplitDraft> = raw.map((d) => ({
        ...d,
        weightBp: Math.round((d.weightBp / total) * 10_000),
      }))
      // The rounding remainder lands on the first row rather than being spread,
      // same rule the editor itself uses.
      drafts[0]!.weightBp += 10_000 - drafts.reduce((s, d) => s + d.weightBp, 0)
      for (const d of drafts) {
        const after = releaseWeight(drafts, d.memberId)
        if (after.length > 0) expect(sum(after)).toBe(10_000)
        expect(after).toHaveLength(drafts.length - 1)
      }
    }
  })

  it('never renumbers the roster order', () => {
    const after = releaseWeight(three, 'sam')
    expect(after.map((d) => d.memberId)).toEqual(['alex', 'robin'])
  })
})
