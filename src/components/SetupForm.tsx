import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { MySpace } from '#/lib/space.types'
import { Button } from '#/components/ui/Button'
import { Input, Label } from '#/components/ui/Input'
import { createSpace } from '#/lib/space.functions'
import { spaceKeys } from '#/lib/session'
import { SWATCHES, swatchColor } from '#/lib/swatches'

/** A short, common set. Currencies people actually hold a household ledger in. */
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'PLN']

export function SetupForm() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

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
        <p className="text-xs uppercase tracking-[0.16em] text-ink-faint">
          Welcome
        </p>
        <h1 className="font-serif text-3xl mt-1">Set up your ledger</h1>
        <p className="text-sm text-ink-muted mt-1.5">
          A space holds one household's expenses. You can add more later.
        </p>
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
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full bg-paper-sunk px-3 py-2 text-ink rounded-[3px]
              shadow-[var(--shadow-deboss)] border-b-2 border-transparent
              focus:shadow-[var(--shadow-raise)] focus:border-terracotta
             "
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
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

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Create space'}
        </Button>
      </form>
    </div>
  )
}
