/**
 * CSV round-trip for the spreadsheet this app replaces.
 *
 * The import parser is deliberately strict and returns per-row errors with a
 * 1-based line number: a silent partial import into a shared ledger is worse
 * than a failed one, because nobody notices the missing rows.
 */
import { z } from 'zod'

import { isoDateSchema } from './guards'
import { parseAmountToMinor } from './money'

export const CSV_HEADER = [
  'date',
  'purpose',
  'amount',
  'category',
  'paid_by',
  'note',
] as const

/** Quote a field only when it needs it, doubling embedded quotes. */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(
  rows: ReadonlyArray<Record<string, string | number | null>>,
): string {
  const lines = [CSV_HEADER.join(',')]
  for (const row of rows) {
    lines.push(CSV_HEADER.map((h) => csvEscape(String(row[h] ?? ''))).join(','))
  }
  // Trailing newline: POSIX text files end with one, and Excel is happier.
  return `${lines.join('\n')}\n`
}

export interface ParsedRow {
  line: number
  date: string
  purpose: string
  amountMinor: number
  category: string
  paidBy: string
  note: string | null
}

export interface ParseResult {
  rows: Array<ParsedRow>
  errors: Array<{ line: number; message: string }>
}

/**
 * Split a CSV line honouring quoted fields and escaped quotes. Handles the
 * `""` escape and commas inside quotes, which a naive `split(',')` gets wrong
 * on any real spreadsheet export.
 */
export function splitCsvLine(line: string): Array<string> {
  const out: Array<string> = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

const categorySchema = z.string().max(60)

export function parseCsv(text: string): ParseResult {
  const rows: Array<ParsedRow> = []
  const errors: Array<{ line: number; message: string }> = []

  const lines = text
    // Strip the UTF-8 BOM. Excel writes one, and it would otherwise make the
    // first header cell "\ufeffdate" and fail the column check.
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)

  if (lines.length === 0) {
    return { rows, errors: [{ line: 0, message: 'File is empty' }] }
  }

  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase())
  const missing = CSV_HEADER.filter((h) => !header.includes(h))
  if (missing.length > 0) {
    return {
      rows,
      errors: [
        {
          line: 1,
          message: `missing column(s): ${missing.join(', ')}. Expected header: ${CSV_HEADER.join(',')}`,
        },
      ],
    }
  }

  const col = (name: (typeof CSV_HEADER)[number]) => header.indexOf(name)

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1 // 1-based, matching what a spreadsheet shows
    const cells = splitCsvLine(lines[i]!)
    const get = (name: (typeof CSV_HEADER)[number]) =>
      (cells[col(name)] ?? '').trim()

    const date = get('date')
    const purpose = get('purpose')
    const amount = get('amount')
    const category = categorySchema.safeParse(get('category'))
    const paidBy = get('paid_by')
    const note = get('note')

    if (!isoDateSchema.safeParse(date).success) {
      errors.push({ line: lineNo, message: `bad or missing date: "${date}"` })
      continue
    }
    if (purpose.length === 0) {
      errors.push({ line: lineNo, message: 'missing purpose' })
      continue
    }
    let amountMinor: number
    try {
      amountMinor = parseAmountToMinor(amount)
      if (amountMinor <= 0) throw new Error('zero')
    } catch {
      errors.push({ line: lineNo, message: `bad amount: "${amount}"` })
      continue
    }
    if (!category.success) {
      errors.push({ line: lineNo, message: 'category name too long' })
      continue
    }

    rows.push({
      line: lineNo,
      date,
      purpose,
      amountMinor,
      category: category.data,
      paidBy,
      note: note.length > 0 ? note : null,
    })
  }

  return { rows, errors }
}
