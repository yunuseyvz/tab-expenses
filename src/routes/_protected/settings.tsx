import { useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { PeriodPreset } from '#/lib/period'
import { listMySpaces } from '#/lib/auth.functions'
import { AppShell } from '#/components/AppShell'
import { Button } from '#/components/ui/Button'
import {
  Card,
  CardHeader,
  CardTitle,
  Row,
  SectionTitle,
} from '#/components/ui/Card'
import { Input, Label, Textarea } from '#/components/ui/Input'
import { SWATCHES, swatchColor } from '#/lib/swatches'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import {
  archiveCategory,
  createCategory,
  createMember,
} from '#/lib/space.functions'
import { categoriesQuery, membersQuery, spaceKeys } from '#/lib/session'
import { ThemePicker } from '#/components/ThemePicker'
import { exportCsv } from '#/lib/csv.functions'
import { commitImport, previewImport } from '#/lib/csv-import.functions'

/**
 * CSV import, the migration path from the spreadsheet this app replaces.
 *
 * Two steps on purpose: preview reports exactly what would happen, then commit.
 * Importing a file straight into a shared ledger is not a thing to do
 * optimistically.
 */
export function ImportCard({ spaceId }: { spaceId: string | null }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewImport>
  > | null>(null)

  const runPreview = useMutation({
    mutationFn: () => previewImport({ data: { spaceId: spaceId!, csv: text } }),
    onSuccess: setPreview,
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Could not read that file'),
  })

  const commit = useMutation({
    mutationFn: () => commitImport({ data: { spaceId: spaceId!, csv: text } }),
    onSuccess: async (r) => {
      toast.success(
        `Imported ${r.created} row(s)` +
          (r.skippedDuplicates > 0
            ? `, skipped ${r.skippedDuplicates} duplicate(s)`
            : ''),
      )
      setText('')
      setPreview(null)
      await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] })
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Import failed'),
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Import from a spreadsheet</CardTitle>
      </CardHeader>
      <p className="text-xs text-ink-faint mb-3">
        CSV with the columns{' '}
        <code className="font-mono">
          date, purpose, amount, category, paid_by, note
        </code>
        . Categories and members are matched by name and created if missing.
        Re-running skips rows already present.
      </p>

      <div className="flex gap-2 mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Choose a CSV file"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setText(await file.text())
            setPreview(null)
          }}
          className="text-sm"
        />
      </div>

      <Textarea
        rows={4}
        aria-label="CSV contents"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPreview(null)
        }}
        placeholder="date,purpose,amount,category,paid_by,note"
        className="font-mono text-xs"
      />

      <div className="flex gap-2 mt-3">
        <Button
          disabled={
            !spaceId || text.trim().length === 0 || runPreview.isPending
          }
          onClick={() => runPreview.mutate()}
        >
          {runPreview.isPending ? 'Checking…' : 'Preview'}
        </Button>
        {preview?.ok && (
          <Button
            disabled={!preview.importable || commit.isPending}
            onClick={() => commit.mutate()}
          >
            {commit.isPending
              ? 'Importing…'
              : `Import ${preview.importable} row(s)`}
          </Button>
        )}
      </div>

      {preview && (
        <div className="mt-3 text-sm">
          {preview.ok ? (
            <p className="text-sage">
              {preview.importable} row(s) ready to import.
              {preview.skippedDuplicates > 0 &&
                ` ${preview.skippedDuplicates} already present and will be skipped.`}
              {preview.createdCategories.length > 0 &&
                ` New categories to create: ${preview.createdCategories
                  .map((c) => c.name)
                  .join(', ')}.`}
            </p>
          ) : (
            <>
              <p className="text-oxblood-ink">
                {preview.problems.length} problem(s) — nothing will be imported.
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {preview.problems.slice(0, 10).map((p, i) => (
                  <li key={i}>
                    Line {p.line}: {p.message}
                  </li>
                ))}
                {preview.problems.length > 10 && (
                  <li>…and {preview.problems.length - 10} more.</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

export const Route = createFileRoute('/_protected/settings')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'all') as PeriodPreset,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const spaces = await context.queryClient.ensureQueryData({
      queryKey: spaceKeys.mySpaces,
      queryFn: () => listMySpaces(),
    })
    const spaceId =
      (deps.space ? spaces.find((s) => s.id === deps.space) : spaces[0])?.id ??
      null
    if (!spaceId) return

    await Promise.all([
      context.queryClient.ensureQueryData(membersQuery(spaceId)),
      context.queryClient.ensureQueryData(categoriesQuery(spaceId)),
    ])
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const search = useSearch({ from: '/_protected/settings' })
  const { space, spaceId, spaces, isLoading } = useCurrentSpace(search.space)
  const queryClient = useQueryClient()

  const [memberName, setMemberName] = useState('')
  const [memberColor, setMemberColor] = useState('sage')
  const [categoryName, setCategoryName] = useState('')
  const [categoryColor, setCategoryColor] = useState('indigo')
  const [personalOwner, setPersonalOwner] = useState('')
  const [personal, setPersonal] = useState(false)

  const members = useQuery({
    ...membersQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  const categories = useQuery({
    ...categoriesQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] })

  const addMember = useMutation({
    mutationFn: () =>
      createMember({
        data: {
          spaceId: spaceId!,
          displayName: memberName,
          color: memberColor,
          defaultWeightBp: 0,
        },
      }),
    onSuccess: async () => {
      toast.success('Member added')
      setMemberName('')
      await invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const addCategory = useMutation({
    mutationFn: () =>
      createCategory({
        data: {
          spaceId: spaceId!,
          name: categoryName,
          color: categoryColor,
          icon: 'tag',
          scope: personal ? 'personal' : 'shared',
          ownerMemberId: personal ? personalOwner || null : null,
          sortOrder: 0,
        },
      }),
    onSuccess: async () => {
      toast.success('Category added')
      setCategoryName('')
      await invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const removeCategory = useMutation({
    mutationFn: (categoryId: string) =>
      archiveCategory({ data: { spaceId: spaceId!, categoryId } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  if (isLoading) {
    return (
      <AppShell>
        <main id="main" className="p-6">
          <p className="text-sm text-ink-muted">Loading…</p>
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">
        <h1 className="font-serif text-2xl sm:text-3xl mb-4">Settings</h1>

        {spaces.length > 1 && (
          <Card className="mb-4">
            <SectionTitle>Your spaces</SectionTitle>
            <ul className="mt-2 space-y-1 text-sm">
              {spaces.map((s) => (
                <li
                  key={s.id}
                  className={
                    s.id === spaceId ? 'font-medium' : 'text-ink-muted'
                  }
                >
                  {s.name} · {s.currency} · {s.role}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <p className="text-xs text-ink-faint mb-3">
            A member with no login is a <strong>virtual member</strong> — they
            carry a share without ever registering.
          </p>

          {(members.data ?? []).map((m) => (
            <Row key={m.id}>
              <span
                aria-hidden
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: swatchColor(m.color) }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{m.displayName}</p>
                <p className="text-xs text-ink-faint">
                  {m.userId ? 'registered' : 'virtual'} · {m.role}
                  {m.defaultWeightBp > 0 &&
                    ` · default ${m.defaultWeightBp / 100}%`}
                </p>
              </div>
            </Row>
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              addMember.mutate()
            }}
            className="mt-4 space-y-3"
          >
            <div>
              <Label htmlFor="member-name">Add a member</Label>
              <Input
                id="member-name"
                required
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Vater"
              />
            </div>
            <SwatchRow
              value={memberColor}
              onChange={setMemberColor}
              label="Member colour"
            />
            <Button type="submit" disabled={addMember.isPending}>
              Add member
            </Button>
          </form>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Categories</CardTitle>
          </CardHeader>
          {(categories.data ?? []).map((c) => (
            <Row key={c.id}>
              <span
                aria-hidden
                className="h-3 w-3 rounded-sm shrink-0"
                style={{ background: swatchColor(c.color) }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{c.name}</p>
                <p className="text-xs text-ink-faint">
                  {c.scope === 'personal'
                    ? `personal${
                        members.data?.find((m) => m.id === c.ownerMemberId)
                          ?.displayName
                          ? ` · ${members.data.find((m) => m.id === c.ownerMemberId)!.displayName}`
                          : ''
                      }`
                    : 'shared'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeCategory.mutate(c.id)}
                aria-label={`Archive ${c.name}`}
              >
                Archive
              </Button>
            </Row>
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              addCategory.mutate()
            }}
            className="mt-4 space-y-3"
          >
            <div>
              <Label htmlFor="category-name">Add a category</Label>
              <Input
                id="category-name"
                required
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Health"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={personal}
                onChange={(e) => setPersonal(e.target.checked)}
              />
              Personal category (only in this member’s totals)
            </label>

            {personal && (
              <div>
                <Label htmlFor="personal-owner">Owner</Label>
                <select
                  id="personal-owner"
                  value={personalOwner}
                  onChange={(e) => setPersonalOwner(e.target.value)}
                  required
                  className="w-full bg-paper-sunk px-3 py-2 text-ink rounded-[3px]
                    shadow-[var(--shadow-deboss)]"
                >
                  <option value="">Choose…</option>
                  {(members.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <SwatchRow
              value={categoryColor}
              onChange={setCategoryColor}
              label="Category colour"
            />
            <Button type="submit" disabled={addCategory.isPending}>
              Add category
            </Button>
          </form>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <ThemePicker />
        </Card>

        <ImportCard spaceId={spaceId} />

        <Card>
          <CardHeader>
            <CardTitle>Export</CardTitle>
          </CardHeader>
          <p className="text-xs text-ink-faint mb-3">
            {space?.name} is denominated in {space?.currency}.
          </p>
          <Button
            variant="secondary"
            disabled={!spaceId}
            onClick={async () => {
              if (!spaceId) return
              const csv = await exportCsv({ data: { spaceId } })
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${space?.name ?? 'ledger'}-export.csv`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Export CSV
          </Button>
        </Card>
      </main>
    </AppShell>
  )
}

function SwatchRow({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-ink-muted mb-1.5">
        {label}
      </legend>
      <div className="flex gap-2 flex-wrap">
        {SWATCHES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange(s.key)}
            aria-label={s.label}
            aria-pressed={value === s.key}
            className="h-8 w-8 rounded-full transition-transform duration-150
              hover:scale-105"
            style={{
              background: swatchColor(s.key),
              boxShadow:
                value === s.key
                  ? '0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-ink)'
                  : 'var(--shadow-raise)',
            }}
          >
            {value === s.key && (
              <span aria-hidden className="text-ink text-xs font-bold">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
