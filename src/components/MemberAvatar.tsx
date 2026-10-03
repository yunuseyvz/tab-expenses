/**
 * A person, at roster size.
 *
 * The app had one avatar component and used it for exactly two things: your own
 * face in the sidebar, and a household's mark in the switcher. Every other place
 * a person was named — the payer on an expense, a row on the balance sheet, the
 * split sliders, the household roster — showed text alone. On a household
 * ledger that is the one visual you actually want, because "who is this" is asked
 * far more often than "how much is this".
 *
 * So this is a thin wrapper rather than another avatar API to remember. It fixes
 * the two decisions that would otherwise differ at each call site:
 *
 *   · **The seed is the member id**, never the display name. Renaming someone
 *     must not change their face, and the app already depends on that for the
 *     space marks.
 *   · **A null avatar derives rather than blanks.** A virtual member has no
 *     account to hold a picture, so half the roster would otherwise be a column
 *     of holes. The identicon is seeded from the member id, so two people on the
 *     same roster still look different.
 *
 * `kind` defaults to a person, which is right here and wrong only for a space —
 * and every space call site passes `kind="space"` explicitly.
 */
import { Avatar } from '#/components/Avatar'

export function MemberAvatar({
  memberId,
  avatar,
  name,
  size = 20,
  className,
}: {
  /** Stable across renames. The member row id, never the display name. */
  memberId: string
  /** Their account avatar key, or null to derive one. */
  avatar?: string | null
  /** Used as the tooltip and the generated mark's title. */
  name?: string
  size?: number
  className?: string
}) {
  return (
    <Avatar
      avatarKey={avatar ?? null}
      seed={memberId}
      name={name}
      kind="person"
      size={size}
      className={className}
    />
  )
}
