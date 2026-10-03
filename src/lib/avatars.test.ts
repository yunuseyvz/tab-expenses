/**
 * Determinism tests for the avatar system.
 *
 * The one property that actually matters is that an id always produces the same
 * avatar: if it did not, two devices would show a person's face changing on
 * every render, and a household would slowly stop recognising itself.
 */
import { describe, expect, it } from 'vitest'

import {
  AVATAR_GROUPS,
  AVATAR_ICONS,
  avatarSrc,
  identicon,
  isAvatarIcon,
  photoUrl,
  seedFrom,
} from './avatars'

const decode = (uri: string) => decodeURIComponent(uri)

describe('seedFrom', () => {
  it('is stable for the same input', () => {
    expect(seedFrom('abc')).toBe(seedFrom('abc'))
  })

  it('differs for different inputs', () => {
    expect(seedFrom('abc')).not.toBe(seedFrom('abd'))
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'user-1', 'x'.repeat(200), 'ünïcødé']) {
      const h = seedFrom(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('identicon', () => {
  it('is identical for the same seed', () => {
    expect(identicon('abc')).toBe(identicon('abc'))
  })

  it('differs for different seeds', () => {
    expect(identicon('abc')).not.toBe(identicon('abd'))
  })

  it('is a self-contained SVG data URI', () => {
    const uri = identicon('user-1')
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true)
    const svg = decode(uri)
    expect(svg).toContain('<svg')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('</svg>')
  })

  it('mirrors about its vertical axis', () => {
    // The grid is symmetric about x=8, so the partner of a cell at x is at
    // 16 - x. That gives the pairs (0,16), (4,12) and (8,8) — the centre column
    // is its own partner, which is why the generator skips mirroring it.
    const xs = [...decode(identicon('user-1')).matchAll(/x="(-?\d+)"/g)].map(
      (m) => Number(m[1]),
    )
    expect(xs.length).toBeGreaterThan(0)
    for (const x of xs) {
      expect(xs).toContain(16 - x)
    }
  })

  it('stays within the 20x20 viewBox', () => {
    for (const seed of ['a', 'bbbb', 'user-42', 'ünïcødé', '']) {
      for (const m of decode(identicon(seed)).matchAll(/x="(-?\d+)"/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(0)
        expect(Number(m[1])).toBeLessThan(20)
      }
    }
  })

  it('keeps every mark inside the viewBox for a space too', () => {
    // Circles carry `cx`/`cy` rather than `x`, so the bounds check above does not
    // cover them and a pip could hang off the edge without this noticing.
    for (const seed of ['a', 'bbbb', 'user-42', 'ünïcødé', '']) {
      const svg = decode(identicon(seed, 'space'))
      for (const m of svg.matchAll(/c[xy]="(-?[\d.]+)"/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(0)
        expect(Number(m[1])).toBeLessThanOrEqual(20)
      }
      for (const m of svg.matchAll(/r="([\d.]+)"/g)) {
        expect(Number(m[1])).toBeGreaterThan(0)
        expect(Number(m[1])).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('generated marks are told apart', () => {
  const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`)

  /** The hue out of the first `oklch(...)` colour in the markup. */
  function hueOf(svg: string): number {
    const m = decode(svg).match(/oklch\(([\d.]+) [\d.]+ ([\d.]+)/)
    if (!m) throw new Error(`no oklch colour in: ${svg.slice(0, 120)}`)
    return Number(m[2])
  }

  it('spans the wheel rather than clustering in one family', () => {
    // The regression this guards: the hue used to be `18 + hash % 78`, a band
    // covering orange through yellow-green, so a household's generated avatars
    // came out assorted shades of the same green. Asserting a spread of hues is
    // the only way that stays fixed — nothing about a single avatar fails when
    // every avatar is the same colour.
    for (const kind of ['person', 'space'] as const) {
      const hues = seeds.map((s) => hueOf(identicon(s, kind)))
      const min = Math.min(...hues)
      const max = Math.max(...hues)
      expect(max - min).toBeGreaterThan(200)
      // And not just two anchors either: more than a quarter of the samples must
      // land in distinct 30-degree buckets, or it is "green plus one other".
      const buckets = new Set(hues.map((h) => Math.floor(h / 30)))
      expect(buckets.size).toBeGreaterThanOrEqual(4)
    }
  })

  it('draws a person as squares and a household as pips', () => {
    for (const seed of seeds) {
      expect(decode(identicon(seed, 'person'))).toContain('<rect')
      expect(decode(identicon(seed, 'person'))).not.toContain('<circle')
      expect(decode(identicon(seed, 'space'))).toContain('<circle')
      expect(decode(identicon(seed, 'space'))).not.toContain('<rect')
    }
  })

  it('gives the same seed two visibly different marks', () => {
    // Same id, two kinds: this is what stops a household's generated avatar from
    // being mistaken for a member of it.
    for (const seed of seeds) {
      expect(identicon(seed, 'person')).not.toBe(identicon(seed, 'space'))
    }
  })

  it('never leaves a household mark without a middle row', () => {
    for (const seed of seeds) {
      expect(decode(identicon(seed, 'space'))).toMatch(/cy="10"/)
    }
  })

  it('is deterministic per kind', () => {
    for (const seed of seeds) {
      for (const kind of ['person', 'space'] as const) {
        expect(identicon(seed, kind)).toBe(identicon(seed, kind))
      }
    }
  })

  it('does not let a person and a household share a colour outright', () => {
    // Shape already separates them, but a shared colour removes the second cue.
    const collisions = seeds.filter(
      (s) => hueOf(identicon(s, 'person')) === hueOf(identicon(s, 'space')),
    )
    expect(collisions.length).toBe(0)
  })
})

describe('avatarSrc', () => {
  it('falls back to an identicon when nothing is set', () => {
    const result = avatarSrc(null, 'user-1')
    expect(result.kind).toBe('identicon')
  })

  it('falls back for an unrecognised key rather than rendering nothing', () => {
    // A blank circle is the failure mode this guards: the key is stored, the
    // name is not in the set, and the user gets an empty hole.
    expect(avatarSrc('nonsense', 'user-1').kind).toBe('identicon')
  })

  it('resolves a known icon', () => {
    const result = avatarSrc('cat', 'user-1')
    expect(result.kind).toBe('icon')
  })

  it('resolves a photo key to a vendored path', () => {
    expect(photoUrl('photo:kai')).toBe('/avatars/kai.svg')
    expect(avatarSrc('photo:kai', 'u').kind).toBe('photo')
  })

  it('refuses a photo key that tries to escape the assets directory', () => {
    // Otherwise a stored key could make the app request anything at all.
    expect(photoUrl('photo:../../etc/passwd')).toBeNull()
    expect(photoUrl('photo:a/b')).toBeNull()
    expect(photoUrl('photo:UPPER')).toBeNull()
  })
})

describe('the icon set', () => {
  it('has unique names', () => {
    const names = AVATAR_ICONS.map((i) => i.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is long enough to tell two people apart', () => {
    expect(AVATAR_ICONS.length).toBeGreaterThanOrEqual(30)
  })

  it('has a component for every name it advertises', () => {
    for (const { name, icon } of AVATAR_ICONS) {
      expect(isAvatarIcon(name)).toBe(true)
      expect(typeof icon).toBe('object')
    }
  })

  /**
   * The flat list and the grouped list are two views of one set, and the flat one
   * is what the validator and the resolver read. They drifting apart would mean
   * an icon that renders nowhere but validates, or the reverse.
   */
  it('flattens to exactly what the groups contain', () => {
    const grouped = AVATAR_GROUPS.flatMap((g) => g.icons.map((i) => i.name))
    expect(AVATAR_ICONS.map((i) => i.name)).toEqual(grouped)
  })

  /**
   * The set grew by adding lucide glyphs, and some of them are tempting twice:
   * Cherry is both a fruit and a nature symbol, Wheat is both a plant and a loaf.
   * Reusing a glyph under two names is fine visually but means the *label* — what
   * a screen reader announces and what the picker shows as the tooltip — is
   * ambiguous, so the same key resolves to whichever was defined last.
   */
  it('reuses a glyph at most once, so every name has one label', () => {
    const byIcon = new Map<unknown, Array<string>>()
    for (const { name, icon } of AVATAR_ICONS) {
      const seen = byIcon.get(icon) ?? []
      seen.push(name)
      byIcon.set(icon, seen)
    }
    const reused = [...byIcon.entries()].filter(([, names]) => names.length > 1)
    expect(reused.map(([, names]) => names)).toEqual([])
  })

  it('offers the person-shaped icons people ask for by name', () => {
    // Someone choosing an avatar for a household wants to find "Man" and "Woman"
    // without hunting. If these go, the picker has lost the reason it was
    // enlarged.
    for (const name of ['venus', 'mars', 'user', 'users', 'user-round']) {
      expect(isAvatarIcon(name)).toBe(true)
    }
  })

  it('groups every icon under a non-empty heading', () => {
    for (const g of AVATAR_GROUPS) {
      expect(g.group.trim().length).toBeGreaterThan(0)
      expect(g.icons.length).toBeGreaterThan(0)
    }
    // At least the groups a person would look in first.
    expect(AVATAR_GROUPS.map((g) => g.group)).toContain('People')
  })
})
