import { describe, expect, it } from 'vitest'

import { greeting, partOfDay } from '#/lib/greeting'

describe('partOfDay', () => {
  it('uses the four traditional boundaries, not an even split', () => {
    // A quarter of the day each would put afternoon at 6am, which is a time no
    // one has ever called the afternoon.
    expect(partOfDay(4)).toBe('night')
    expect(partOfDay(5)).toBe('morning')
    expect(partOfDay(11)).toBe('morning')
    expect(partOfDay(12)).toBe('afternoon')
    expect(partOfDay(16)).toBe('afternoon')
    expect(partOfDay(17)).toBe('evening')
    expect(partOfDay(21)).toBe('evening')
    expect(partOfDay(22)).toBe('night')
  })

  it('wraps cleanly at both ends of the day', () => {
    expect(partOfDay(0)).toBe('night')
    expect(partOfDay(23)).toBe('night')
  })
})

describe('greeting', () => {
  it('opens with the time of day and the first name', () => {
    expect(greeting('Vale', 9)).toBe('Good morning, Vale')
    expect(greeting('Vale', 14)).toBe('Good afternoon, Vale')
    expect(greeting('Vale', 19)).toBe('Good evening, Vale')
  })

  it('says hello rather than good night before five', () => {
    // Someone opening an app at 2am is not going to bed, and "Good night"
    // reads as a farewell rather than a welcome.
    expect(greeting('Vale', 2)).toBe('Hello, Vale')
  })

  it('falls back to the bare greeting without a name', () => {
    // Registration predates the name field, so this is a real state and not an
    // error to paper over. "Hello, there" would be worse than nothing.
    expect(greeting(undefined, 9)).toBe('Good morning')
    expect(greeting(null, 9)).toBe('Good morning')
    expect(greeting('   ', 9)).toBe('Good morning')
  })

  it('takes the first token of a full name', () => {
    expect(greeting('Anna Maria', 9)).toBe('Good morning, Anna')
    // Never wrong, sometimes short — see the note in greeting().
    expect(greeting('Dr Ana Reyes', 9)).toBe('Good morning, Dr')
  })

  it('tolerates ragged whitespace', () => {
    expect(greeting('  Vale  ', 9)).toBe('Good morning, Vale')
  })

  it("defaults to the reader's own clock", () => {
    // `new Date().getHours()` is deliberately called twice rather than reusing
    // the one inside greeting(): an hour boundary crossing between the two calls
    // would fail this test for a reason that has nothing to do with the code.
    const word = {
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
      night: 'Hello',
    }[partOfDay(new Date().getHours())]
    expect(greeting('Vale')).toBe(`${word}, Vale`)
  })
})
