import { useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { FileDown, FileUp, LogOut, Plus, UserPlus, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { PeriodPreset } from '#/lib/period'
import type { CategoryIconName } from '#/lib/category-icons'
import type { RemovalKind } from '#/components/settings/ConfirmRemoval'
import { iconFor } from '#/lib/category-icons'
import { getSession, listMySpaces, updateProfile } from '#/lib/auth.functions'
import { AppShell, Sheet } from '#/components/AppShell'
import { authClient } from '#/lib/auth-client'
import { Avatar } from '#/components/Avatar'
import { AvatarPicker } from '#/components/AvatarPicker'
import { IconPicker } from '#/components/IconPicker'
import { InvitePanel } from '#/components/InvitePanel'
import { ImportCard } from '#/components/settings/ImportCard'
import { ConfirmRemoval } from '#/components/settings/ConfirmRemoval'
import { SettingsGroup, SettingsRow } from '#/components/settings/SettingsGroup'
import { Button } from '#/components/ui/Button'
import { Input, Label, Select } from '#/components/ui/Input'
import { Switch } from '#/components/ui/Switch'
import { SWATCHES, swatchColor } from '#/lib/swatches'
import { useCurrentSpace } from '#/hooks/useCurrentSpace'
import { resolveSpaceId } from '#/lib/space-preference'
import {
  archiveCategory,
  archiveMember,
  createCategory,
  createMember,
} from '#/lib/space.functions'
import {
  categoriesQuery,
  membersQuery,
  rememberedSpaceQuery,
  spaceKeys,
} from '#/lib/session'
import { ThemePicker } from '#/components/ThemePicker'
import { exportCsv } from '#/lib/csv.functions'

/**
 * Settings: one screen, four groups, nothing hidden behind a tap.
 *
 * This went to drill-down sub-pages for Members, Categories, Invites, Import and
 * Export, on the reasoning that an operating system's settings are a list you
 * tap through. That was wrong for this app. A household is a handful of people
 * and a handful of categories, so every one of those pages held two or three
 * rows and a form, and reaching the fifth member meant a page change to read a
 * list you could have seen at a glance. The depth cost a screen's worth of taps
 * and gave back nothing.
 *
 * So: everything is here, and compactness comes from the forms rather than from
 * the navigation. A roster you can read without tapping is worth far more than a
 * roster on its own page, and the only thing still worth a page is the thing too
 * big to sit in a row: the CSV importer's preview table.
 *
 * The ordering is by how often you come here, not by how important each thing
 * sounds. Household first, because nearly every visit is about the ledger.
 * Account last, because your own avatar is set once and then never again, and a
 * row you will not touch does not belong above the ones you will.
 *
 * Categories is a group of its own rather than a tail on Household: it is the
 * longest list on the page, and putting it in the same card made "Groceries"
 * read as a fourth person. Household then holds the people and the invitation,
 * which are the same subject.
 *
 * Add-forms are collapsed until asked for. An empty name field and a colour
 * swatch are eleven controls of furniture for something you do once: nothing
 * when closed, and a screenful when open.
 */

export const Route = createFileRoute('/_protected/settings')({
  validateSearch: (s: Record<string, unknown>) => ({
    space: typeof s.space === 'string' ? s.space : undefined,
    period: (typeof s.period === 'string' ? s.period : 'all') as PeriodPreset,
  }),
  // Warm the roster and the categories so both lists are there on the first
  // paint. This screen shows them rather than counting them, so a slow roster
  // means a visibly half-empty page.
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

    await Promise.all([
      qc.ensureQueryData(membersQuery(spaceId)),
      qc.ensureQueryData(categoriesQuery(spaceId)),
    ])
  },
  component: SettingsRoute,
})

/** Which inline form, if any, is open. One at a time: two open is just clutter. */
type Open = null | 'member' | 'category'

function SettingsRoute() {
  const search = useSearch({ from: '/_protected/settings' })
  const { space, spaceId } = useCurrentSpace(search.space)
  const queryClient = useQueryClient()

  const [signingOut, setSigningOut] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [avatarSheet, setAvatarSheet] = useState(false)
  const [importSheet, setImportSheet] = useState(false)
  const [inviteSheet, setInviteSheet] = useState(false)
  const [removing, setRemoving] = useState<{
    kind: RemovalKind
    id: string
    name: string
  } | null>(null)

  const [memberName, setMemberName] = useState('')
  const [memberColor, setMemberColor] = useState('sage')
  const [categoryName, setCategoryName] = useState('')
  const [categoryColor, setCategoryColor] = useState('indigo')
  const [categoryIcon, setCategoryIcon] = useState<CategoryIconName>('receipt')
  const [personal, setPersonal] = useState(false)
  const [personalOwner, setPersonalOwner] = useState('')

  const me = useQuery({ queryKey: ['session'], queryFn: () => getSession() })
  const members = useQuery({
    ...membersQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })
  const categories = useQuery({
    ...categoriesQuery(spaceId ?? ''),
    enabled: Boolean(spaceId),
  })

  // Members, categories and everything derived from them. One key rather than
  // three: an archived member still appears on old expenses, so a stale name or
  // colour anywhere in the app is wrong, not just in this list.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['spaces', spaceId] })

  // A full navigation rather than a router refresh: Better Auth clears the
  // session cookie, and every loader on every route is keyed to it, so this is
  // the one action where an in-app transition would show the previous user's
  // screen for a frame.
  async function signOut() {
    setSigningOut(true)
    await authClient.signOut()
    window.location.href = '/login'
  }

  const saveAvatar = useMutation({
    mutationFn: (avatar: string | null) => updateProfile({ data: { avatar } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session'] })
      toast.success('Avatar updated')
      setAvatarSheet(false)
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not save'),
  })

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
      setOpen(null)
      await invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      archiveMember({ data: { spaceId: spaceId!, memberId } }),
    onSuccess: async () => {
      toast.success('Member removed')
      setRemoving(null)
      await invalidate()
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed')
      setRemoving(null)
    },
  })

  const addCategory = useMutation({
    mutationFn: () =>
      createCategory({
        data: {
          spaceId: spaceId!,
          name: categoryName,
          color: categoryColor,
          icon: categoryIcon,
          scope: personal ? 'personal' : 'shared',
          ownerMemberId: personal ? personalOwner || null : null,
          sortOrder: 0,
        },
      }),
    onSuccess: async () => {
      toast.success('Category added')
      setCategoryName('')
      setOpen(null)
      await invalidate()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })

  const removeCategory = useMutation({
    mutationFn: (categoryId: string) =>
      archiveCategory({ data: { spaceId: spaceId!, categoryId } }),
    onSuccess: () => {
      setRemoving(null)
      void invalidate()
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Failed')
      setRemoving(null)
    },
  })

  const ownerName = (memberId: string | null) =>
    members.data?.find((m) => m.id === memberId)?.displayName

  /**
   * Whether *this* member can be removed.
   *
   * Per row, not per household. The server's rule concerns owners only: it
   * refuses to archive the last remaining owner, because a household with no
   * owner cannot be managed. Archiving anyone else is safe even with a single
   * owner, which is the ordinary case: one person owns the ledger and everybody
   * else is on it.
   *
   * This was one flag for the whole list, "are there more than one owner", used
   * to decide whether anybody got a button. So a household with one owner and
   * three members had a roster with no way to remove anyone at all, including the
   * three for whom it is perfectly safe. The delete button could not be found
   * because there was not one.
   */
  const ownerCount = members.data?.filter((m) => m.role === 'owner').length ?? 0
  const canRemove = (m: { role: string }) =>
    m.role !== 'owner' || ownerCount > 1

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <h1 className="text-2xl sm:text-3xl mb-6 tracking-tight">Settings</h1>

        <SettingsGroup
          title="Household"
          hint={space ? `${space.name} · ${space.currency}` : undefined}
        >
          {(members.data ?? []).map((m) => (
            <SettingsRow
              key={m.id}
              label={
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: swatchColor(m.color) }}
                  />
                  <span className="truncate">{m.displayName}</span>
                </span>
              }
              value={`${m.userId ? 'registered' : 'virtual'} · ${m.role}`}
            >
              {canRemove(m) && (
                <RemoveButton
                  label={`Remove ${m.displayName}`}
                  onClick={() =>
                    setRemoving({
                      kind: 'member',
                      id: m.id,
                      name: m.displayName,
                    })
                  }
                />
              )}
            </SettingsRow>
          ))}
          {(members.data ?? []).length === 0 && (
            <SettingsRow label="Nobody in this household yet" />
          )}

          {open === 'member' ? (
            <InlineForm>
              <div>
                <Label htmlFor="member-name">Name</Label>
                <Input
                  id="member-name"
                  required
                  autoFocus
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Vater"
                />
              </div>
              <SwatchField
                value={memberColor}
                onChange={setMemberColor}
                label="Colour"
              />
              <Submit
                label="Add member"
                busy={addMember.isPending}
                disabled={!memberName.trim()}
                onSubmit={() => addMember.mutate()}
                onCancel={() => setOpen(null)}
              />
            </InlineForm>
          ) : (
            <AddRow
              label="Add a virtual member"
              hint="No account needed"
              onClick={() => setOpen('member')}
            />
          )}

          {space?.role === 'owner' && (
            <SettingsRow
              icon={UserPlus}
              label="Invite people"
              hint="Via a link"
              onClick={() => setInviteSheet(true)}
            />
          )}
        </SettingsGroup>

        <SettingsGroup
          title="Categories"
          hint={space ? `${space.name}'s categories` : undefined}
        >
          {(categories.data ?? []).map((c) => {
            const Glyph = iconFor(c.icon)
            const owner = ownerName(c.ownerMemberId)
            return (
              <SettingsRow
                key={c.id}
                label={
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="grid place-items-center size-7 shrink-0 rounded-[7px]"
                      style={{
                        background: `color-mix(in oklab, ${swatchColor(c.color)} 18%, transparent)`,
                      }}
                    >
                      <Glyph size={15} />
                    </span>
                    <span className="truncate">{c.name}</span>
                  </span>
                }
                value={
                  c.scope === 'personal'
                    ? owner
                      ? `personal · ${owner}`
                      : 'personal'
                    : 'shared'
                }
              >
                <RemoveButton
                  label={`Archive ${c.name}`}
                  onClick={() =>
                    setRemoving({ kind: 'category', id: c.id, name: c.name })
                  }
                />
              </SettingsRow>
            )
          })}
          {(categories.data ?? []).length === 0 && (
            <SettingsRow label="No categories yet" />
          )}

          {open === 'category' ? (
            <InlineForm>
              <div>
                <Label htmlFor="category-name">Name</Label>
                <div className="flex gap-2">
                  <IconPicker value={categoryIcon} onChange={setCategoryIcon} />
                  <Input
                    id="category-name"
                    required
                    autoFocus
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                    placeholder="Health"
                  />
                </div>
              </div>
              <Switch
                checked={personal}
                onChange={setPersonal}
                label="Personal, counted only in one member's totals"
              />
              {personal && (
                <div>
                  <Label htmlFor="personal-owner">Owner</Label>
                  <Select
                    id="personal-owner"
                    aria-label="Owner"
                    value={personalOwner}
                    onChange={(e) => setPersonalOwner(e.target.value)}
                  >
                    <option value="">Choose...</option>
                    {(members.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <SwatchField
                value={categoryColor}
                onChange={setCategoryColor}
                label="Colour"
              />
              <Submit
                label="Add category"
                busy={addCategory.isPending}
                disabled={!categoryName.trim()}
                onSubmit={() => addCategory.mutate()}
                onCancel={() => setOpen(null)}
              />
            </InlineForm>
          ) : (
            <AddRow
              label="Add a category"
              onClick={() => setOpen('category')}
            />
          )}
        </SettingsGroup>

        <SettingsGroup title="Data">
          <SettingsRow
            // Down for import, up for export: the arrows point the way the file
            // travels. Import brings data *into* the app, export takes it out,
            // and FileUp on the import row had it exactly backwards.
            icon={FileDown}
            label="Import from a spreadsheet"
            hint="CSV"
            onClick={() => setImportSheet(true)}
          />
          <SettingsRow
            icon={FileUp}
            label="Export"
            hint="All expenses"
            onClick={() => void runExport(spaceId, space?.name ?? null)}
          />
        </SettingsGroup>

        <SettingsGroup title="Account">
          <SettingsRow
            label={
              <span className="flex items-center gap-2.5">
                <Avatar
                  avatarKey={me.data?.user.avatar ?? null}
                  // The id, not the name: renaming yourself should not change your face.
                  seed={me.data?.user.id ?? 'anonymous'}
                  name={me.data?.user.name}
                  size={26}
                />
                <span className="truncate">{me.data?.user.name}</span>
              </span>
            }
            value={me.data?.user.email}
            onClick={() => setAvatarSheet(true)}
          />
          <SettingsRow label="Appearance">
            <ThemePicker heading={false} />
          </SettingsRow>
          <SettingsRow
            label="Sign out"
            hint={signingOut ? 'Signing you out…' : undefined}
          >
            <Button
              variant="secondary"
              size="sm"
              disabled={signingOut}
              onClick={() => void signOut()}
              className="shrink-0"
            >
              <LogOut size={15} aria-hidden />
              Sign out
            </Button>
          </SettingsRow>
        </SettingsGroup>
      </main>

      {avatarSheet && (
        <Sheet open onClose={() => setAvatarSheet(false)} title="Your avatar">
          <div className="pb-4">
            <p className="text-xs text-ink-faint mb-3 leading-relaxed">
              Pick one, or keep the generated mark.
            </p>
            <AvatarPicker
              value={me.data?.user.avatar ?? null}
              seed={me.data?.user.id ?? 'anonymous'}
              name={me.data?.user.name}
              onChange={(next) => saveAvatar.mutate(next)}
              label="Your avatar"
            />
          </div>
        </Sheet>
      )}

      {importSheet && (
        <Sheet
          open
          onClose={() => setImportSheet(false)}
          title="Import from a spreadsheet"
        >
          <p className="text-xs text-ink-faint mb-3 leading-relaxed">
            Paste CSV contents.
          </p>
          <ImportCard spaceId={spaceId} />
        </Sheet>
      )}

      {removing && (
        <ConfirmRemoval
          kind={removing.kind}
          name={removing.name}
          busy={
            removing.kind === 'member'
              ? removeMember.isPending
              : removeCategory.isPending
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            removing.kind === 'member'
              ? removeMember.mutate(removing.id)
              : removeCategory.mutate(removing.id)
          }
        />
      )}

      {inviteSheet && spaceId && (
        <Sheet open onClose={() => setInviteSheet(false)} title="Invite people">
          <InvitePanel spaceId={spaceId} />
        </Sheet>
      )}
    </AppShell>
  )
}

/** Download the ledger as CSV. Errors are reported rather than swallowed. */
async function runExport(spaceId: string | null, name: string | null) {
  if (!spaceId) return
  try {
    const csv = await exportCsv({ data: { spaceId } })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name ?? 'ledger'}-export.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not export')
  }
}

/** A row that opens something, distinguished from one that navigates. */
function AddRow({
  label,
  hint,
  onClick,
}: {
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left
        transition-colors duration-150
        hover:bg-[var(--color-paper-sunk)]"
    >
      <Plus size={15} aria-hidden className="shrink-0 text-ink-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink-muted">{label}</span>
        {hint && (
          <span className="block text-xs text-ink-faint mt-0.5 leading-snug">
            {hint}
          </span>
        )}
      </span>
    </button>
  )
}

/**
 * Removing a person or a category.
 *
 * A small X with the name in its accessible label, rather than the word
 * "Remove" beside every row: on a list of eight people, eight identical buttons
 * is a wall of text and the reader has to match each one to its row by eye. The
 * X sits inside the row it belongs to, so position says what the label cannot.
 *
 * Archive, not delete, for both. An expense that names someone keeps that
 * person's name on it after they leave, which is the point: the ledger records
 * what happened, and a household that dissolved and a flat that was sold are
 * different facts.
 */
function RemoveButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 grid place-items-center size-8 rounded-full
        text-ink-faint transition-[color,background-color] duration-150
        hover:text-ink hover:bg-[var(--color-paper-raised)]"
    >
      <X size={15} aria-hidden />
    </button>
  )
}

/**
 * The open add-form, padded and inset from the rows it interrupts.
 *
 * Padded further than a row is, so it reads as a different kind of thing rather
 * than as two more rows: this one is a form, and a form crammed to the same left
 * edge as a roster would look like two more people.
 */
function InlineForm({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-4 space-y-4">{children}</div>
}

function Submit({
  label,
  busy,
  disabled,
  onSubmit,
  onCancel,
}: {
  label: string
  busy: boolean
  disabled: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex gap-2">
      <Button
        type="button"
        onClick={onSubmit}
        disabled={busy || disabled}
        className="flex-1"
      >
        {label}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}

function SwatchField({
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
              // Never selection by colour alone: the tick and the ring weight
              // both carry it.
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
