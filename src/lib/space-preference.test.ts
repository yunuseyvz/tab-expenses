import { describe, expect, it } from 'vitest'

import { resolveSpaceId } from './space-preference'

const spaces = [
  { id: 'a', name: 'Hauptstraße' },
  { id: 'b', name: 'Ferienhaus' },
]

describe('resolveSpaceId', () => {
  it('honours an explicit ?space= that belongs to the user', () => {
    expect(resolveSpaceId(spaces, 'b', 'a')).toBe('b')
  })

  it('falls back to the remembered space when the URL says nothing', () => {
    expect(resolveSpaceId(spaces, undefined, 'b')).toBe('b')
    expect(resolveSpaceId(spaces, '', 'b')).toBe('b')
  })

  it('lets the URL beat the remembered space', () => {
    // Sharing a link to one specific space must actually land on that space,
    // not on whatever this browser happened to use last.
    expect(resolveSpaceId(spaces, 'a', 'b')).toBe('a')
  })

  it('ignores a ?space= that is not one of the user’s spaces', () => {
    // A hand-edited id from another household must not select it — and must not
    // blank the screen either, so it falls through to the remembered space.
    expect(resolveSpaceId(spaces, 'someones-else', 'b')).toBe('b')
    expect(resolveSpaceId(spaces, 'someones-else', null)).toBe('a')
  })

  it('ignores a remembered space the user has since lost access to', () => {
    // Membership can be removed while a cookie lives on for a year.
    expect(resolveSpaceId(spaces, undefined, 'gone')).toBe('a')
  })

  it('uses the first space when nothing else applies', () => {
    expect(resolveSpaceId(spaces, undefined, null)).toBe('a')
  })

  it('returns null for a user with no spaces, so onboarding can start', () => {
    expect(resolveSpaceId([], undefined, 'a')).toBeNull()
    expect(resolveSpaceId([], 'a', null)).toBeNull()
  })
})
