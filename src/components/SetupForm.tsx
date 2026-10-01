import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { MySpace } from '#/lib/space.types'
import { TabLogo } from '#/components/TabLogo'
import { APP_NAME } from '#/lib/app-meta'
import { Button } from '#/components/ui/Button'
import { Input, Label, Select } from '#/components/ui/Input'
import { rememberSpace } from '#/lib/auth.functions'
import { createSpace } from '#/lib/space.functions'
import { spaceKeys } from '#/lib/session'
import { SWATCHES, swatchColor } from '#/lib/swatches'

/** A short, common set. Currencies people actually hold a household ledger in. */
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'PLN']

/**
 * @param title heading text, so the same form can introduce either a first
 *   household or an additional one.
 * @param blurb supporting line under the heading.
 */
export function SetupForm({
  title = 'Set up your ledger',
  blurb = "A space holds one household's expenses. You can add more later.",
}: {
  title?: string
  blurb?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Whether there is anywhere to go back to. `/setup` has no Cancel because
  // there is nothing behind it: an account with no space has no screen to return
  // to, and the honest thing is to not offer one.
  const [canCancel, setCanCancel] = useState(false)
  useEffect(() => {
    // Read after mount, so this is not a render-time history access.
    setCanCancel(window.history.length > 1)
  }, [])

  // History rather than a named route, because the caller is whichever switcher
  // the person used: the sidebar's "New space" and the floating bar's are the
  // same link and neither of them has a canonical previous page.
  const back = () => {
    if (window.history.length > 1) window.history.back()
    else void navigate({ to: '/setup' })
  }

  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState('terracotta')

  const create = useMutation({
    mutationFn: () =>
      createSpace({
        data: { name, currency, displayName, color },
      }),
    onSuccess: (result) => {
      // Write the value we just learned synchronously rather than relying on
      // an invalidation to land before the next navigation.
      //
      // This matters more than it looks: signing in already navigated to
      // /dashboard, whose loader found no spaces and redirected to /setup —
      // priming the cache with an empty list. `invalidateQueries` on an
      // inactive query only marks it stale, so the /_protected loader could
      // read that same empty list and redirect straight back to /setup. The
      // user fills in the form, presses the button, and lands on the form
      // again with no error. Setting the data removes the race entirely.
      queryClient.setQueryData<Array<MySpace>>(spaceKeys.mySpaces, (prev) => [
        {
          id: result.space.id,
          name: result.space.name,
          currency: result.space.currency,
          role: 'owner',
          memberId: result.member.id,
        },
        ...(prev ?? []).filter((s) => s.id !== result.space.id),
      ])

      // Then refresh in the background so a space created in another tab shows
      // up. Awaiting this would delay the navigation for no benefit now that
      // the cache is already correct.
      void queryClient.invalidateQueries({ queryKey: spaceKeys.mySpaces })

      // The URL below pins the space, but the nav links carry none and would
      // fall back to whichever household was last used. Say which one this is.
      void rememberSpace({ data: { spaceId: result.space.id } }).then(() =>
        queryClient.invalidateQueries({
          queryKey: spaceKeys.rememberedSpace,
        }),
      )

      toast.success('Space created')
      void navigate({
        to: '/dashboard',
        search: {
          space: result.space.id,
          period: 'thisMonth',
          cats: undefined,
          from: undefined,
          to: undefined,
        },
      })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not create space')
    },
  })

  return (
    <div className="w-full max-w-md">
      <header className="mb-6">
        <TabLogo wordmark={APP_NAME} markSize={24} className="mb-4" />
        <h1 className="text-3xl mt-1 tracking-tight">{title}</h1>
        <p className="text-sm text-ink-muted mt-1.5">{blurb}</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
        className="space-y-5"
      >
        <div>
          <Label htmlFor="space-name">Space name</Label>
          <Input
            id="space-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Flat on Hauptstraße"
          />
        </div>

        <div>
          <Label htmlFor="currency">Currency</Label>
          <Select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-faint mt-1.5">
            One currency per space, so sums are always meaningful.
          </p>
        </div>

        <div>
          <Label htmlFor="display-name">Your name in this space</Label>
          <Input
            id="display-name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Vale"
          />
        </div>

        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1.5">
            Your colour
          </legend>
          <div className="flex gap-2 flex-wrap">
            {SWATCHES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setColor(s.key)}
                aria-label={s.label}
                aria-pressed={color === s.key}
                className={`h-9 w-9 rounded-full transition-transform duration-150
                  ${color === s.key ? 'scale-110' : 'hover:scale-105'}`}
                style={{
                  background: swatchColor(s.key),
                  // Never encode selection in colour alone — the check glyph
                  // and the border weight carry it too.
                  boxShadow:
                    color === s.key
                      ? '0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-ink)'
                      : 'var(--shadow-raise)',
                }}
              >
                {color === s.key && (
                  <span aria-hidden className="text-ink text-sm font-bold">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex gap-2.5">
          <Button
            type="submit"
            size="lg"
            className="flex-1"
            disabled={create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create space'}
          </Button>
          {/* Cancel, and only when there is somewhere to cancel back to.
           *
           * `/setup` is the first-run flow: there is nothing behind it, the
           * account has no space at all, and the only way out is signing out. A
           * Cancel that could not do either of those would be a control that
           * lies about being able to leave.
           *
           * `/spaces/new` is reached *from* the app, by tapping "New space", so
           * there is a real previous page. It goes back with the browser history
           * rather than a hard-coded path, because the switcher is in the sidebar
           * and the floating bar on a phone and neither of those is "/settings";
           * history is the only thing that knows where you actually came from. */}
          {canCancel && (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={back}
              disabled={create.isPending}
            >
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
