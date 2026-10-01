/**
 * Determinism tests for the avatar system.
 *
 * The one property that actually matters is that an id always produces the same
 * avatar: if it did not, two devices would show a person's face changing on
 * every render, and a household would slowly stop recognising itself.
 */
import { describe, expect, it } from 'vitest'

import {
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
    expect(photoUrl('photo:vale')).toBe('/avatars/vale.svg')
    expect(avatarSrc('photo:vale', 'u').kind).toBe('photo')
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
})
