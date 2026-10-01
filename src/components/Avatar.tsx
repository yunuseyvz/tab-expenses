import type { AvatarKind } from '#/lib/avatars'
import { avatarSrc } from '#/lib/avatars'
import { cn } from '#/lib/cn'

/**
 * Draws a person's or household's avatar.
 *
 * Three shapes, resolved by avatarSrc: a vendored photo, a chosen icon, or a
 * deterministic identicon. The point of routing all three through one component
 * is that nothing above this line has to care which one it got.
 *
 * @param key the stored avatar key, or null for "derive one".
 * @param seed a stable id — the user id or space id, never the display name, so
 *   renaming someone does not change their face.
 * @param kind whether this is a person or a household. Only affects a *generated*
 *   mark; a chosen icon is chosen from one set and looks the same either way.
 *   Defaults to a person, which is wrong in exactly one place — every call site
 *   that renders a space now passes it — so the default is the safe one.
 */
export function Avatar({
  avatarKey,
  seed,
  name,
  kind = 'person',
  size = 40,
  className,
}: {
  avatarKey: string | null | undefined
  seed: string
  name?: string
  kind?: AvatarKind
  size?: number
  className?: string
}) {
  const resolved = avatarSrc(avatarKey, seed, kind)
  const common = cn(
    'shrink-0 overflow-hidden rounded-full',
    'bg-[var(--color-paper-sunk)]',
    className,
  )

  if (resolved.kind === 'photo') {
    return (
      <img
        src={resolved.src}
        // The initials are the alt text because the photograph is decoration
        // here: every place an avatar appears also has the name beside it.
        alt=""
        aria-hidden
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={cn(common, 'object-cover')}
      />
    )
  }

  if (resolved.kind === 'icon') {
    const Icon = resolved.icon
    return (
      <span
        aria-hidden
        title={name}
        style={{ width: size, height: size }}
        className={cn(common, 'grid place-items-center text-ink-muted')}
      >
        <Icon size={Math.round(size * 0.52)} strokeWidth={1.75} />
      </span>
    )
  }

  return (
    <img
      src={resolved.src}
      alt=""
      aria-hidden
      title={name}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn(common, 'object-cover')}
    />
  )
}

/** Initials, for anywhere a photo is genuinely unavailable. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
