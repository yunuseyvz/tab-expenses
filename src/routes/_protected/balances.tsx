import { useMemo } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import type { PeriodPreset } from '#/lib/period'
import { CountUp } from '#/components/CountUp'
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
import { MemberAvatar } from '#/components/MemberAvatar'
import { swatchColor } from '#/lib/swatches'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { resolveSpaceId } from '#/lib/space-preference'
import { PeriodFilter } from '#/components/PeriodFilter'

export const Route = createFileRoute('/_protected/balances')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    // Undefined when the URL says nothing, which is not the same as "all": it
    // means "the default", and the component resolves that to this month. A
    // period param is cast rather than checked — an unrecognised key resolves to
    // no bounds, which `presetToPeriod`'s default branch handles deliberately.
    period:
      typeof s.period === 'string' ? (s.period as PeriodPreset) : undefined,
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
      balancesQuery(
        spaceId,
        resolvePeriod(deps.period ?? 'thisMonth', deps.from, deps.to),
      ),
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

  // Same resolution as the loader, from the same source: the URL, else this
  // month. A settlement cycle was tried here — one setting saying how often the
  // household settles, so Balances opened on a fortnight rather than a month —
  // and it was reverted. The screen was one click from any other window anyway,
  // so the setting bought a default and cost a column, a settings group and a
  // second list of the same names to keep in step.
  const effectivePreset = search.period ?? 'thisMonth'
  const period = useMemo(
    () => resolvePeriod(effectivePreset, search.from, search.to),
    [effectivePreset, search.from, search.to],
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
        <h1 className="text-2xl sm:text-3xl mb-1 tracking-tight">Balances</h1>
        <p className="text-xs text-ink-faint mb-4 tnum">
          paid − share. Positive means the household owes them.
        </p>

        <PeriodFilter
          current={effectivePreset}
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
              <CountUp
                // The sans, for the same reason as the dashboard totals: the
                // wordmark's serif is a display cut and reads as decoration at
                // figure sizes. See Dashboard.tsx.
                className="tnum text-3xl mt-1"
                // Signed, so the tween runs between the two real figures rather
                // than through zero: a position falling from +€1,400 to −€200
                // would otherwise sweep through €600 on the way, which is a
                // number that never existed.
                value={yourNet}
                format={(v) =>
                  (v >= 0 ? '+' : '−') + formatMoney(Math.abs(v), currency)
                }
                style={{
                  color:
                    yourNet >= 0 ? 'var(--color-sage)' : 'var(--color-oxblood)',
                }}
              />
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
                  {/* The face, with the colour dot kept beside it: the dot
                      identifies them at a glance across a long list, and the
                      face is what tells you *which* Alex. */}
                  <MemberAvatar
                    memberId={b.memberId}
                    avatar={b.avatar}
                    name={b.displayName}
                    size={26}
                  />
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full shrink-0"
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
                  Everyone is square. No payments needed.
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
