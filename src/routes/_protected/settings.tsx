import { useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import {
  Crown,
  DoorOpen,
  FileDown,
  FileUp,
  LogOut,
  Plus,
  UserPlus,
  X,
} from 'lucide-react'
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
import { MemberAvatar } from '#/components/MemberAvatar'
import { AvatarPicker } from '#/components/AvatarPicker'
import { IconPicker } from '#/components/IconPicker'
import { InvitePanel } from '#/components/InvitePanel'
import { ImportCard } from '#/components/settings/ImportCard'
import { ConfirmRemoval } from '#/components/settings/ConfirmRemoval'
import { ConfirmAccountDeletion } from '#/components/settings/ConfirmAccountDeletion'
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from '#/components/settings/SettingsGroup'
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
  leaveSpace,
} from '#/lib/space.functions'
import {
  categoriesQuery,
  membersQuery,
  rememberedSpaceQuery,
  spaceKeys,
} from '#/lib/session'
import { ThemePicker } from '#/components/ThemePicker'
import { exportCsv } from '#/lib/csv.functions'
import { accountDeletionPreview, deleteAccount } from '#/lib/account.functions'

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
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [profileSheet, setProfileSheet] = useState(false)
  const [profileName, setProfileName] = useState<string | null>(null)
  const [profileAvatar, setProfileAvatar] = useState<string | null | undefined>(
    undefined,
  )
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
  // Only fetched once the dialog is open. It is a per-account query about
  // households this page has not loaded, and there is no reason to pay for it
  // on every visit to Settings.
  const consequences = useQuery({
    queryKey: ['account-deletion'],
    queryFn: () => accountDeletionPreview(),
    enabled: deletingAccount,
  })
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

  /**
   * Delete the account, then leave.
   *
   * A full navigation for the same reason as sign-out: the session is gone, so
   * every loader is keyed to something that no longer exists. An in-app transition
   * would render a frame of a signed-in app for an account that no longer is.
   */
  const removeAccount = useMutation({
    mutationFn: (email: string) =>
      deleteAccount({ data: { confirmEmail: email } }),
    onSuccess: () => {
      window.location.href = '/login'
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not delete'),
  })

  /**
   * Your own name and face. One save for both, from local state seeded when the
   * sheet opens — the picker and the field are drafts until then, not writes.
   */
  const saveProfile = useMutation({
    mutationFn: (patch: { name?: string; avatar?: string | null }) =>
      updateProfile({ data: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session'] })
      // Household rosters carry your display name per space, which is separate
      // and stays as it is — this is only the account name.
      toast.success('Profile updated')
      setProfileSheet(false)
      setProfileName(null)
      setProfileAvatar(undefined)
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not save'),
  })

  const openProfile = () => {
    setProfileName(me.data?.user.name ?? '')
    setProfileAvatar(me.data?.user.avatar ?? null)
    setProfileSheet(true)
  }

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

  /**
   * Leave the household.
   *
   * A full navigation when done, and it is not optional here: with zero spaces
   * every protected route redirects to /setup, and an in-app transition would
   * render one frame of a household this person is no longer in. `listMySpaces`
   * is invalidated first so the space list is already correct by the time the
   * next loader asks.
   */
  const leaveHousehold = useMutation({
    mutationFn: () => leaveSpace({ data: { spaceId: spaceId! } }),
    onSuccess: () => {
      toast.success('You left the household')
      void queryClient.invalidateQueries({ queryKey: spaceKeys.mySpaces })
      setRemoving(null)
      window.location.href = '/dashboard'
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not leave')
      setRemoving(null)
    },
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

  /**
   * Whether *this* member can be removed, and by whom.
   *
   * Two conditions, and the first one used to be missing here. The server has
   * always required an owner to archive anybody — `archiveMember` calls
   * `requireSpaceOwner` — but the button was rendered for everyone who passed
   * the last-owner check. So an ordinary member saw a delete button on every row
   * of the household they belonged to, and clicking it produced a permission
   * error from a screen that had just told them they could do it. Offering a
   * control the server will refuse is worse than not offering it: it teaches
   * people the app is unreliable.
   *
   * The X is now owner-only. A plain member gets no removal control on other
   * rows, and gets `Leave household` for their own row further down, which is the
   * thing they actually have a right to do.
   */
  const isOwner = space?.role === 'owner'
  const canRemove = (m: { role: string }) =>
    isOwner && (m.role !== 'owner' || ownerCount > 1)

  /** The viewer's own roster row, for the leave button. */
  const myMember = (members.data ?? []).find(
    (m) => m.userId === me.data?.user.id,
  )

  return (
    <AppShell>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
        <h1 className="text-2xl sm:text-3xl mb-6 tracking-tight">Settings</h1>

        {/*
          Three levels, and the page is the top one.

          Household is a SECTION with each of its three lists as a GROUP inside
          it, because that is the truth of the data: one household, with people,
          with categories, with a ledger. They were three sibling sections, which
          said the household, its people and its categories were peers of each
          other and of Account — and the reader had to work out from the words
          which of those things contained which.

          App settings and Account are sections of their own at the end. They are
          not about the household at all, and neither is a list.

          Account is last on purpose, and the reason predates this layout: the
          only irreversible control on the screen is `Delete account`, and the
          last row of a page is the one nobody reaches by accident. Putting a
          growing `App settings` section underneath it would move that row into
          the middle of the page for no gain.
        */}
        <SettingsSection
          title="Household"
          hint={space ? `${space.name} · ${space.currency}` : undefined}
        >
          <SettingsGroup title="Members">
            {/*
              No household-wide permission switch here any more, and that is the
              point rather than an absence. "Members can edit each other's
              expenses" was one answer to a question that is not one question: a
              deposit you had to correct yourself and a grocery round you would
              rather nobody touched are the same size of edit and not the same
              amount of comfort. Set once for the whole ledger, the switch had to
              be the most cautious value anybody in the household ever needed,
              which made it useless for every entry that did not need it.

              Each entry now carries its own lock instead — the padlock at the top
              of an expense, set by whoever added it. The column, and the cost of
              an owner not being able to overrule it, are documented on
              `expense.locked`.
            */}
            {(members.data ?? []).map((m) => (
              <SettingsRow
                key={m.id}
                label={
                  <span className="flex items-center gap-2.5">
                    <MemberAvatar
                      memberId={m.id}
                      avatar={m.userAvatar}
                      name={m.displayName}
                      size={22}
                    />
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: swatchColor(m.color) }}
                    />
                    <span className="truncate">{m.displayName}</span>
                    {/* The crown carries the role, so the value column does not
                      also have to spell it out. A mark beside the name says
                      "owner of this household" without making the reader parse a
                      word in a status column, and it travels with the name
                      instead of sitting at the far end of the row. */}
                    {m.role === 'owner' && (
                      <Crown
                        size={14}
                        aria-label="Owner of this household"
                        className="shrink-0 text-[var(--color-terracotta)]"
                      />
                    )}
                  </span>
                }
                value={m.userId ? 'registered' : 'virtual'}
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
                    placeholder="Noor"
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

            {isOwner && (
              <SettingsRow
                icon={UserPlus}
                label="Invite people"
                hint="Via a link"
                onClick={() => setInviteSheet(true)}
              />
            )}

            {/* Leaving is available to everybody, and is a different gesture from
              being removed: it is the one thing on a roster that is always
              yours to do, and somebody removed from a household they no longer
              belong to cannot come back and press it. */}
            {myMember && (
              <SettingsRow
                // A mark in the same left-hand slot the roster and the import rows
                // use, so the column of leading icons still lines up. DoorOpen
                // rather than LogOut: the sign-out row in Account already uses the
                // latter, and two rows meaning "you are leaving something" with the
                // same glyph is a worse confusion than the near-duplicate.
                icon={DoorOpen}
                label="Leave this household"
                hint={
                  myMember.role === 'owner'
                    ? 'Someone else becomes the owner'
                    : 'You can rejoin with an invite'
                }
                onClick={() =>
                  setRemoving({
                    kind: 'leave',
                    id: myMember.id,
                    name: space?.name ?? 'this household',
                  })
                }
              />
            )}
          </SettingsGroup>

          <SettingsGroup title="Categories">
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
                    <IconPicker
                      value={categoryIcon}
                      onChange={setCategoryIcon}
                    />
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

          <SettingsGroup
            title="Data"
            hint={space ? 'Everyone sees the same ledger' : undefined}
          >
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
        </SettingsSection>

        {/*
          Its own section, and not a row under Account. The theme is a property
          of the app rather than of the person signed into it, and the section is
          where the next ones will go — a heading that already exists is a cheaper
          thing to add to than a row that has to be found a home each time.
        */}
        <SettingsSection title="App settings">
          <SettingsGroup>
            <SettingsRow label="Appearance">
              <ThemePicker heading={false} />
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>

        <SettingsSection title="Account">
          <SettingsGroup>
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
                  <span className="min-w-0">
                    <span className="block truncate">{me.data?.user.name}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {me.data?.user.email}
                    </span>
                  </span>
                </span>
              }
              onClick={openProfile}
            />
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
            {/* Last row on the page, and the only irreversible thing in it. It
                gets no button of its own to mis-click: the row is the target, the
                dialog is the confirmation, and the dialog asks for the address. */}
            <SettingsRow
              label="Delete account"
              hint="Cannot be undone"
              onClick={() => setDeletingAccount(true)}
            />
          </SettingsGroup>
        </SettingsSection>
      </main>

      {profileSheet && (
        <Sheet open onClose={() => setProfileSheet(false)} title="Your profile">
          <div className="pb-4 space-y-4">
            <div>
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={profileName ?? ''}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="What should we call you"
                maxLength={80}
              />
              <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
                Your household nicknames are per space and stay as they are.
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-faint mb-3 leading-relaxed">
                Pick one, or keep the generated mark.
              </p>
              <AvatarPicker
                value={profileAvatar ?? null}
                seed={me.data?.user.id ?? 'anonymous'}
                name={profileName ?? me.data?.user.name}
                onChange={setProfileAvatar}
                label="Your avatar"
              />
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted mb-1.5">
                Sign-in address
              </span>
              <p className="text-sm tnum truncate">{me.data?.user.email}</p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={
                  saveProfile.isPending ||
                  !(profileName ?? '').trim() ||
                  ((profileName ?? '').trim() === (me.data?.user.name ?? '') &&
                    (profileAvatar ?? null) === (me.data?.user.avatar ?? null))
                }
                onClick={() =>
                  saveProfile.mutate({
                    name: (profileName ?? '').trim(),
                    avatar: profileAvatar ?? null,
                  })
                }
                className="flex-1"
              >
                {saveProfile.isPending ? 'Saving…' : 'Save profile'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setProfileSheet(false)}
              >
                Cancel
              </Button>
            </div>
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
          isOwner={myMember?.role === 'owner'}
          busy={
            removing.kind === 'member'
              ? removeMember.isPending
              : removing.kind === 'category'
                ? removeCategory.isPending
                : leaveHousehold.isPending
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            if (removing.kind === 'member') removeMember.mutate(removing.id)
            else if (removing.kind === 'category')
              removeCategory.mutate(removing.id)
            else leaveHousehold.mutate()
          }}
        />
      )}

      {inviteSheet && spaceId && (
        <Sheet open onClose={() => setInviteSheet(false)} title="Invite people">
          <InvitePanel spaceId={spaceId} />
        </Sheet>
      )}

      {deletingAccount && me.data && (
        <ConfirmAccountDeletion
          email={me.data.user.email}
          staying={consequences.data?.staying ?? 0}
          going={consequences.data?.going ?? 0}
          orphaned={consequences.data?.orphaned ?? 0}
          // The counts are about households this page has not loaded, so there is
          // nothing on the client to fall back on. Say so rather than defaulting
          // to zero, which would read as "nothing is lost".
          loading={consequences.isPending}
          failed={consequences.isError}
          busy={removeAccount.isPending}
          onCancel={() => setDeletingAccount(false)}
          onConfirm={(email) => removeAccount.mutate(email)}
        />
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
