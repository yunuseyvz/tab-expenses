/**
 * Curated category swatches.
 *
 * Deliberately NOT a free colour picker: free HSL pickers reliably produce
 * illegible charts. These are pre-tuned in OKLCH so every slice has enough
 * contrast against --paper, in both light and dark mode.
 */
export interface Swatch {
  /** stable key, stored in the DB as category.color */
  key: string
  label: string
  light: string
  dark: string
  /** lucide-react icon name, rendered at small size */
  icon: string
}

export const SWATCHES: ReadonlyArray<Swatch> = [
  {
    key: 'terracotta',
    label: 'Terracotta',
    light: 'oklch(0.62 0.13 45)',
    dark: 'oklch(0.7 0.11 45)',
    icon: 'home',
  },
  {
    key: 'sage',
    label: 'Sage',
    light: 'oklch(0.6 0.075 150)',
    dark: 'oklch(0.72 0.07 150)',
    icon: 'leaf',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    light: 'oklch(0.55 0.11 240)',
    dark: 'oklch(0.68 0.09 240)',
    icon: 'book-open',
  },
  {
    key: 'ochre',
    label: 'Ochre',
    light: 'oklch(0.74 0.12 80)',
    dark: 'oklch(0.8 0.1 80)',
    icon: 'sun',
  },
  {
    key: 'plum',
    label: 'Plum',
    light: 'oklch(0.55 0.13 300)',
    dark: 'oklch(0.7 0.1 300)',
    icon: 'sparkles',
  },
  {
    key: 'teal',
    label: 'Teal',
    light: 'oklch(0.58 0.1 190)',
    dark: 'oklch(0.7 0.09 190)',
    icon: 'utensils',
  },
  {
    key: 'oxblood',
    label: 'Oxblood',
    light: 'oklch(0.6 0.14 20)',
    dark: 'oklch(0.68 0.12 20)',
    icon: 'heart-pulse',
  },
  {
    key: 'moss',
    label: 'Moss',
    light: 'oklch(0.52 0.06 130)',
    dark: 'oklch(0.66 0.06 130)',
    icon: 'car',
  },
]

const BY_KEY = new Map(SWATCHES.map((s) => [s.key, s]))

export function swatch(key: string): Swatch | undefined {
  return BY_KEY.get(key)
}

/**
 * Resolve a stored swatch key to a CSS colour for the current theme.
 * Unknown keys fall back to terracotta rather than rendering `undefined`,
 * so a stale or hand-edited DB value can never blank a chart.
 *
 * Passes through raw CSS colours (`var(--…)` and `#…`) untouched. The
 * Uncategorised pseudo-category is not a swatch — grey is not a choice anyone
 * should paint a category — so it carries its colour literally rather than
 * taking up a swatch slot.
 */
export function swatchColor(
  key: string,
  opts: { dark?: boolean } = {},
): string {
  if (key.startsWith('var(') || key.startsWith('#')) return key
  const s = swatch(key)
  if (!s) return opts.dark ? 'oklch(0.7 0.11 45)' : 'oklch(0.62 0.13 45)'
  return opts.dark ? s.dark : s.light
}

/** Every swatch, as inline `color` values, for Recharts. */
export function swatchSeries(dark: boolean): Array<string> {
  return SWATCHES.map((s) => (dark ? s.dark : s.light))
}
