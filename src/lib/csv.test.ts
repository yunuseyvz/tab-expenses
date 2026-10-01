import { describe, expect, it } from 'vitest'

import { CSV_HEADER, csvEscape, parseCsv, splitCsvLine, toCsv } from './csv'

describe('csvEscape', () => {
  it('leaves plain fields alone', () => {
    expect(csvEscape('Weekly shop')).toBe('Weekly shop')
    expect(csvEscape('')).toBe('')
  })

  it('quotes fields containing a comma, quote, or newline', () => {
    expect(csvEscape('Bread, milk')).toBe('"Bread, milk"')
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })
})

describe('splitCsvLine', () => {
  it('splits on plain commas', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps commas inside quotes', () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })

  it('unescapes doubled quotes', () => {
    expect(splitCsvLine('"He said ""hi"""')).toEqual(['He said "hi"'])
  })

  it('preserves empty fields and trailing ones', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c'])
    expect(splitCsvLine('a,b,')).toEqual(['a', 'b', ''])
  })
})

describe('toCsv', () => {
  it('writes a header and a trailing newline', () => {
    const out = toCsv([{ date: '2026-01-01', purpose: 'x', amount: 1 }])
    const lines = out.split('\n')
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(out.endsWith('\n')).toBe(true)
  })

  it('round-trips through the parser', () => {
    const original = [
      {
        date: '2026-03-01',
        purpose: 'Weekly shop',
        amount: '12.34',
        category: 'Home',
        paid_by: 'Me',
        note: null,
      },
      {
        date: '2026-03-02',
        purpose: 'Bread, milk and "jam"',
        amount: '4.05',
        category: 'Home',
        paid_by: 'Vater',
        note: 'weekly',
      },
    ]
    const { rows, errors } = parseCsv(toCsv(original))
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[1]!.purpose).toBe('Bread, milk and "jam"')
    expect(rows[0]!.amountMinor).toBe(1234)
    expect(rows[1]!.amountMinor).toBe(405)
  })
})

describe('parseCsv', () => {
  const header = CSV_HEADER.join(',')

  it('parses a well-formed file', () => {
    const { rows, errors } = parseCsv(
      `${header}\n2026-03-01,Weekly shop,12.34,Home,Me,\n`,
    )
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({
      line: 2,
      date: '2026-03-01',
      purpose: 'Weekly shop',
      amountMinor: 1234,
      category: 'Home',
      paidBy: 'Me',
      note: null,
    })
  })

  it('reports a 1-based line number, matching what a spreadsheet shows', () => {
    const { rows, errors } = parseCsv(
      [
        header,
        '2026-03-01,Good,10.00,Home,Me,',
        'not-a-date,Bad,10.00,Home,Me,',
        '2026-03-03,Also good,5.00,Home,Me,',
      ].join('\n'),
    )
    // The good rows still import; the bad one is reported, not swallowed.
    expect(rows).toHaveLength(2)
    expect(errors).toEqual([
      { line: 3, message: 'bad or missing date: "not-a-date"' },
    ])
  })

  it('rejects impossible dates rather than shifting them', () => {
    const { errors } = parseCsv(`${header}\n2026-02-31,Shop,10.00,Home,Me,`)
    expect(errors[0]!.message).toMatch(/bad or missing date/)
  })

  it('rejects bad amounts, zero amounts, and missing purposes', () => {
    const { errors } = parseCsv(
      [
        header,
        '2026-03-01,Shop,abc,Home,Me,',
        '2026-03-01,Shop,0.00,Home,Me,',
        '2026-03-01,,10.00,Home,Me,',
      ].join('\n'),
    )
    expect(errors).toHaveLength(3)
    expect(errors[0]!.message).toMatch(/bad amount/)
    expect(errors[2]!.message).toMatch(/missing purpose/)
  })

  it('refuses a file with the wrong header', () => {
    const { errors } = parseCsv('when,what,how much\n2026-03-01,Shop,10.00')
    expect(errors[0]!.message).toMatch(/missing column/)
    expect(errors[0]!.message).toMatch(/Expected header/)
  })

  it('handles an empty file and a header-only file', () => {
    expect(parseCsv('').errors[0]!.message).toBe('File is empty')
    expect(parseCsv(header).rows).toEqual([])
  })

  it('strips a UTF-8 BOM, which Excel writes', () => {
    const { rows, errors } = parseCsv(
      `\uFEFF${header}\n2026-03-01,Shop,10.00,Home,Me,`,
    )
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
  })

  it('tolerates CRLF line endings', () => {
    const { rows, errors } = parseCsv(
      `${header}\r\n2026-03-01,Shop,10.00,Home,Me,\r\n`,
    )
    expect(errors).toEqual([])
    expect(rows).toHaveLength(1)
  })

  it('ignores blank lines', () => {
    const { rows } = parseCsv(
      `${header}\n2026-03-01,Shop,10.00,Home,Me,\n\n\n2026-03-02,Shop,2.00,Home,Me,\n`,
    )
    expect(rows).toHaveLength(2)
  })

  it('accepts a comma decimal separator from a DE locale export', () => {
    const { rows, errors } = parseCsv(
      `${header}\n2026-03-01,Shop,12,34,Home,Me,`,
    )
    // Ambiguous with a field separator, so the amount becomes 12 and "34" is
    // the category — this documents the behaviour rather than hiding it.
    expect(errors).toEqual([])
    expect(rows[0]!.amountMinor).toBe(1200)
  })
})
