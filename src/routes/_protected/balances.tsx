import { useMemo } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import type { PeriodPreset } from '#/lib/period'
import { AppShell } from '#/components/AppShell'
import {
  Card,
  CardHeader,
  CardTitle,
  Row,
  SectionTitle,
} from '#/components/ui/Card'
import { balancesQuery, rememberedSpaceQuery, spaceKeys } from '#/lib/session'
import { listMySpaces } from '#/lib/auth.functions'
import { formatMoney } from '#/lib/money'
import { resolvePeriod } from '#/lib/period'
import { swatchColor } from '#/lib/swatches'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { resolveSpaceId } from '#/lib/space-preference'
import { PeriodFilter } from '#/components/PeriodFilter'

export const Route = createFileRoute('/_protected/balances')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'all') as PeriodPreset,
    // Balances had no custom range at all: two screens offered it and one did
    // not, so the same control meant different things per page.
    from: typeof s.from === 'string' ? s.from : undefined,
    to: typeof s.to === 'string' ? s.to : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const qc = context.queryClient

    const spaces = await qc.ensureQueryData({
      queryKey: spaceKeys.mySpaces,
      queryFn: () => listMySpaces(),
    })
    const spaceId = resolveSpaceId(
      spaces,
      deps.space,
      await qc.ensureQueryData(rememberedSpaceQuery()),
    )
    if (!spaceId) return

    await qc.ensureQueryData(
      balancesQuery(spaceId, resolvePeriod(deps.period, deps.from, deps.to)),
    )
  },
  component: BalancesRoute,
})

function BalancesRoute() {
  const search = useSearch({ from: '/_protected/balances' })
  const navigate = useNavigate()
  const { space, spaceId } = useCurrentSpace(search.space)

  const go = (
    patch: Partial<{
      space: string | undefined
      period: PeriodPreset
      from: string | undefined
      to: string | undefined
    }>,
  ) => {
    void navigate({ to: '/balances', search: { ...search, ...patch } })
  }

  const period = useMemo(
    () => resolvePeriod(search.period, search.from, search.to),
    [search.period, search.from, search.to],
  )

  const balances = useQuery({
    ...balancesQuery(spaceId ?? '', period),
    enabled: Boolean(spaceId),
  })

  const currency = space?.currency ?? 'EUR'
  const data = balances.data
  const yourNet = data?.yourNetMinor ?? 0

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <h1 className="font-serif text-2xl sm:text-3xl mb-1">Balances</h1>
        <p className="text-xs text-ink-faint mb-4 tnum">
          paid − share. Positive means the household owes them.
        </p>

        <PeriodFilter
          current={search.period}
          from={search.from}
          to={search.to}
          onChange={(patch) => go(patch)}
        />

        {balances.isPending ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : !data ? (
          <p className="text-sm text-ink-muted">No data.</p>
        ) : (
          <div className="space-y-4">
            <Card>
              <SectionTitle>Your position</SectionTitle>
              <p
                className="tnum font-serif text-3xl mt-1"
                style={{
                  color:
                    yourNet >= 0 ? 'var(--color-sage)' : 'var(--color-oxblood)',
                }}
              >
                {yourNet >= 0 ? '+' : '−'}
                {formatMoney(Math.abs(yourNet), currency)}
              </p>
              <p className="text-sm text-ink-muted mt-1">
                {yourNet > 0
                  ? 'The household owes you this.'
                  : yourNet < 0
                    ? 'You owe the household this.'
                    : 'You are square.'}
              </p>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Per member</CardTitle>
              </CardHeader>
              {data.balances.map((b) => (
                <Row key={b.memberId}>
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: swatchColor(b.color) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {b.displayName}
                      {b.memberId === data.yourMemberId && (
                        <span className="text-ink-faint"> (you)</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-faint tnum">
                      paid {formatMoney(b.paidMinor, currency)} · share{' '}
                      {formatMoney(b.shareMinor, currency)}
                    </p>
                  </div>
                  <span
                    className="tnum text-sm font-medium shrink-0"
                    style={{
                      color:
                        b.netMinor > 0
                          ? 'var(--color-sage)'
                          : b.netMinor < 0
                            ? 'var(--color-oxblood)'
                            : 'var(--color-ink-faint)',
                    }}
                  >
                    {b.netMinor > 0 ? '+' : b.netMinor < 0 ? '−' : ''}
                    {formatMoney(Math.abs(b.netMinor), currency)}
                  </span>
                </Row>
              ))}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Settle up</CardTitle>
              </CardHeader>
              {data.settlements.length === 0 ? (
                <p className="text-sm text-ink-faint py-2">
                  Everyone is square — no payments needed.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.settlements.map((s, i) => (
                    <li
                      key={`${s.fromMemberId}-${s.toMemberId}-${i}`}
                      className="text-sm"
                    >
                      <span className="font-medium">{s.fromName}</span> owes{' '}
                      <span className="font-medium">{s.toName}</span>{' '}
                      <span className="tnum">
                        {formatMoney(s.amountMinor, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </main>
    </AppShell>
  )
}
