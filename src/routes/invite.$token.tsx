/**
 * Accept an invitation.
 *
 * Public, because the recipient arrives here from an emailed link while signed
 * out. Three outcomes, and the page has to distinguish all of them honestly:
 *
 *   • no session      → offer sign-in or registration, carrying this URL along
 *   • wrong session   → say which address the invitation was for
 *   • valid           → accept, then drop them into the new space
 *
 * What it must never do is accept on the strength of the link alone. The token
 * is emailed, but email is not a guarantee; acceptInvite additionally requires
 * the session's email to match, so a forwarded link is inert. This page shows
 * the invited address up front so that mismatch is visible before the user
 * bothers.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { TabLogo } from '#/components/TabLogo'
import { Button } from '#/components/ui/Button'
import { Card } from '#/components/ui/Card'
import { getSession } from '#/lib/auth.functions'
import { acceptInvite, getInvitePreview } from '#/lib/invite.functions'
import { spaceKeys } from '#/lib/session'

export const Route = createFileRoute('/invite/$token')({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === 'string' ? s.redirect : undefined,
  }),
  component: InviteRoute,
})

function InviteRoute() {
  const { token } = Route.useParams()
  const { redirect } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => getSession(),
  })
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => getInvitePreview({ data: { token } }),
  })

  const accept = useMutation({
    mutationFn: () => acceptInvite({ data: { token } }),
    onSuccess: async (result) => {
      // The space list is now stale — this account can see a household it
      // could not see a moment ago. Write the value in rather than racing an
      // invalidation, which is the same trap /setup fell into.
      await queryClient.invalidateQueries({ queryKey: spaceKeys.mySpaces })
      await queryClient.invalidateQueries({
        queryKey: spaceKeys.rememberedSpace,
      })
      // Land inside the household that was just joined, with it pinned in the
      // URL. A `redirect` carried through from the sign-in hop wins, since it
      // encodes where the user was actually headed.
      void navigate({
        to: '/dashboard',
        search: {
          space: result.spaceId,
          period: 'thisMonth',
          cats: undefined,
          from: undefined,
          to: undefined,
        },
      })
      void redirect
    },
  })

  const me = session.data?.user
  const info = preview.data
  const inviteUrl =
    typeof window === 'undefined' ? '' : window.location.pathname

  return (
    <main id="main" className="min-h-dvh flex items-center justify-center p-5">
      <Card className="w-full max-w-md">
        {preview.isPending || session.isPending ? (
          <p className="text-sm text-ink-muted">Checking the invitation…</p>
        ) : info?.status === 'invalid' ? (
          <Outcome
            title="This link is not valid"
            body="The invitation may have been replaced by a newer one, or the link was mistyped."
          />
        ) : info?.status === 'accepted' ? (
          <Outcome
            title="Already accepted"
            body="This invitation has already been used. If that was you, open the space from your space list."
          />
        ) : info?.status === 'expired' ? (
          <Outcome
            title="This invitation has expired"
            body="Ask whoever invited you to send a new one — it only takes a moment."
          />
        ) : info ? (
          <>
            <TabLogo wordmark="Invitation" markSize={20} className="mb-4" />
            <h1 className="font-serif text-2xl mt-1">Join {info.spaceName}</h1>
            <p className="text-sm text-ink-muted mt-2">
              {info.inviterName} invited you to share this household's expenses.
            </p>
            <p className="text-xs text-ink-faint mt-3">
              The invitation is for <strong>{info.email}</strong>.
            </p>

            <div className="mt-5">
              {!me ? (
                <div className="space-y-2">
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() =>
                      void navigate({
                        to: '/login',
                        search: { redirect: inviteUrl },
                      })
                    }
                  >
                    Sign in to accept
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    className="w-full"
                    onClick={() =>
                      void navigate({
                        to: '/register',
                        search: { email: info.email },
                      })
                    }
                  >
                    Create an account
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate()}
                  >
                    {accept.isPending ? 'Joining…' : `Join ${info.spaceName}`}
                  </Button>
                  {accept.error && (
                    <p role="alert" className="mt-3 text-sm text-oxblood-ink">
                      {accept.error.message}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        ) : null}
      </Card>
    </main>
  )
}

/**
 * A dead end, but a useful one: says what happened and offers the way out.
 */
function Outcome({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="font-serif text-2xl">{title}</h1>
      <p className="text-sm text-ink-muted mt-2">{body}</p>
      <Link
        to="/login"
        search={{ redirect: undefined }}
        className="mt-5 inline-block text-sm text-terracotta-ink underline underline-offset-4"
      >
        Go to sign in
      </Link>
    </>
  )
}
