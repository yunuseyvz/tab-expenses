import { useEffect, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import type { CategoryTotal } from '#/lib/expense.functions'
import { formatMoney } from '#/lib/money'
import { swatchColor } from '#/lib/swatches'

/**
 * Category donut.
 *
 * Animates on data change, not on mount: the first paint is already on screen
 * when SSR hands over, and animating it would be pure cost. Capped at 400 ms
 * and disabled entirely under prefers-reduced-motion.
 */
export function CategoryDonut({
  data,
  currency,
  totalMinor,
}: {
  data: Array<CategoryTotal>
  currency: string
  totalMinor: number
}) {
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const slices = data.filter((d) => d.totalMinor > 0)

  if (slices.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-ink-faint">
        No spending in this period.
      </div>
    )
  }

  return (
    <div className="h-48">
      {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="totalMinor"
              nameKey="name"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={1.5}
              isAnimationActive={!reduceMotion}
              animationDuration={400}
            >
              {slices.map((s) => (
                <Cell key={s.id} fill={swatchColor(s.color, { dark })} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatMoney(Number(value ?? 0), currency)}
              contentStyle={{
                background: 'var(--color-paper-raised)',
                border: '1px solid var(--color-rule)',
                borderRadius: 3,
                boxShadow: 'var(--shadow-float)',
                fontVariantNumeric: 'tabular-nums',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      <p className="sr-only">
        Spending by category, {formatMoney(totalMinor, currency)} total.
      </p>
    </div>
  )
}
