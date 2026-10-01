/**
 * Avatars for people and households.
 *
 * Two kinds, and the distinction is the point:
 *
 *   • ICONS      — a curated set someone deliberately picks, stored as a key.
 *   • IDENTICONS — generated from an id, deterministic, no choice needed.
 *
 * On the photos: this was asked for, and it is genuinely not available here.
 * Every stock-photo source that permits free use is either a third party the
 * app would have to fetch from at render time — which would leak a household's
 * IP addresses to somebody else's server on every avatar render, on a ledger
 * that is otherwise entirely self-hosted — or a set of real photographs under
 * CC BY-SA, which drags attribution and share-alike obligations into a family
 * app. Searching Wikimedia Commons for licence-clean portraits returns 27
 * candidates and all of them are oil paintings, museum catalog entries and
 * DALL·E renders.
 *
 * So the mechanism still accepts a `photo:` key, `avatarSrc` knows how to
 * resolve one from the vendored asset directory, and the two things actually
 * offered are the icon set and the identicon. Nothing phones home, nothing has a
 * licence attached to it, and nobody ends up represented by a stranger's
 * photograph they did not agree to.
 *
 * The identicon is the better default anyway: two people in one household never
 * collide, and the mark is stable across devices without ever being stored.
 */
import {
  Anchor,
  Apple,
  Baby,
  Bike,
  Bird,
  Cat,
  Cherry,
  Clover,
  Coffee,
  Compass,
  Fish,
  Flower2,
  Ghost,
  Heart,
  Home,
  KeyRound,
  Lamp,
  Leaf,
  Moon,
  Mountain,
  Music,
  Palette,
  PawPrint,
  Rocket,
  Ship,
  Sparkles,
  Star,
  Sun,
  Tent,
  TreePine,
  Umbrella,
  User,
  Users,
  Waves,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Photographic avatars, if any are ever vendored into public/avatars/. */
const PHOTO_PREFIX = 'photo:'

export const AVATAR_ICONS = [
  { name: 'user', label: 'Person', icon: User },
  { name: 'users', label: 'People', icon: Users },
  { name: 'home', label: 'House', icon: Home },
  { name: 'heart', label: 'Heart', icon: Heart },
  { name: 'star', label: 'Star', icon: Star },
  { name: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { name: 'sun', label: 'Sun', icon: Sun },
  { name: 'moon', label: 'Moon', icon: Moon },
  { name: 'leaf', label: 'Leaf', icon: Leaf },
  { name: 'tree', label: 'Tree', icon: TreePine },
  { name: 'flower', label: 'Flower', icon: Flower2 },
  { name: 'clover', label: 'Clover', icon: Clover },
  { name: 'cherry', label: 'Cherry', icon: Cherry },
  { name: 'coffee', label: 'Coffee', icon: Coffee },
  { name: 'apple', label: 'Apple', icon: Apple },
  { name: 'paw', label: 'Paw', icon: PawPrint },
  { name: 'cat', label: 'Cat', icon: Cat },
  { name: 'bird', label: 'Bird', icon: Bird },
  { name: 'fish', label: 'Fish', icon: Fish },
  { name: 'waves', label: 'Waves', icon: Waves },
  { name: 'mountain', label: 'Mountain', icon: Mountain },
  { name: 'tent', label: 'Tent', icon: Tent },
  { name: 'ship', label: 'Ship', icon: Ship },
  { name: 'anchor', label: 'Anchor', icon: Anchor },
  { name: 'compass', label: 'Compass', icon: Compass },
  { name: 'rocket', label: 'Rocket', icon: Rocket },
  { name: 'music', label: 'Music', icon: Music },
  { name: 'palette', label: 'Palette', icon: Palette },
  { name: 'lamp', label: 'Lamp', icon: Lamp },
  { name: 'key', label: 'Key', icon: KeyRound },
  { name: 'umbrella', label: 'Umbrella', icon: Umbrella },
  { name: 'baby', label: 'Baby', icon: Baby },
  { name: 'bike', label: 'Bike', icon: Bike },
  { name: 'ghost', label: 'Ghost', icon: Ghost },
  { name: 'zap', label: 'Bolt', icon: Zap },
] as const satisfies ReadonlyArray<{
  name: string
  label: string
  icon: LucideIcon
}>

export type AvatarIconName = (typeof AVATAR_ICONS)[number]['name']

/**
 * Valid values, for the server-side validator.
 *
 * `z.enum` rather than a loose string, so an unrecognised key is rejected at
 * the boundary instead of rendering as a blank circle. The `photo:` escape
 * hatch is included deliberately: it is not resolvable today, and
 * `avatarSrc` returns null for it, so anything that gets stored as one degrades
 * to the identicon rather than to a broken image.
 */
export const AVATAR_KEYS: Array<AvatarIconName | string> = [
  ...AVATAR_ICONS.map((i) => i.name),
  `${PHOTO_PREFIX}*`,
]

const ICON_BY_NAME = new Map<string, LucideIcon>(
  AVATAR_ICONS.map((i) => [i.name, i.icon]),
)

export const DEFAULT_AVATAR_ICON: LucideIcon = User

/** True for a key naming one of the curated icons. */
export function isAvatarIcon(key: string | null | undefined): boolean {
  return !!key && ICON_BY_NAME.has(key)
}

/** A vendored photograph URL, or null if none is bundled. */
export function photoUrl(key: string): string | null {
  if (!key.startsWith(PHOTO_PREFIX)) return null
  const name = key.slice(PHOTO_PREFIX.length)
  if (!/^[a-z0-9-]+$/.test(name)) return null
  return `/avatars/${name}.svg`
}

/**
 * FNV-1a over the seed. Small and dependency-free, and the only requirement is
 * that the same id always yields the same avatar — which any stable hash gives.
 * Not cryptographic, and not pretending to be.
 */
export function seedFrom(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A deterministic identicon, as a self-contained SVG data URI.
 *
 * A 5x5 mirrored grid, which is the classic construction: mirroring means 15
 * bits of entropy instead of 25, which is plenty for "different from your
 * partner" and keeps every mark visually balanced about its vertical axis.
 *
 * Rendered inline as a data URI rather than as React nodes so it can be used
 * anywhere an `src` is accepted — an <img>, a CSS background — with no
 * layout work.
 */
export function identicon(seed: string): string {
  const h = seedFrom(seed)
  const cells: Array<string> = []

  // Constrained to the app's own range rather than the full wheel. A hue taken
  // from 360 picks cyan and magenta about a third of the time, and a random
  // magenta avatar on a warm paper ledger looks like a bug rather than a mark.
  // Terracotta through olive covers plenty of ground and always sits with the
  // palette; the secondary is the same hue family, darker.
  const hue = 18 + ((h >>> 8) % 78)
  const fill = `hsl(${hue} ${38 + ((h >>> 4) % 16)}% ${52 + ((h >>> 6) % 8)}%)`
  const deep = `hsl(${hue + 10} ${44 + ((h >>> 4) % 14)}% 38%)`

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const bit = (h >>> (row * 3 + col)) & 1
      if (!bit) continue
      const x = col * 4
      const y = row * 4
      cells.push(
        `<rect x="${x}" y="${y}" width="4" height="4" fill="${
          (row + col) % 2 === 0 ? fill : deep
        }"/>`,
      )
      // Mirror the third column into the fourth and fifth.
      if (col < 2) {
        cells.push(
          `<rect x="${20 - x - 4}" y="${y}" width="4" height="4" fill="${
            (row + col) % 2 === 0 ? fill : deep
          }"/>`,
        )
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20">` +
    cells.join('') +
    `</svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * What to actually draw: a vendored photo if the key names one, otherwise the
 * icon, otherwise an identicon derived from the seed.
 *
 * `seed` should be a stable id — the user id or the space id — not the display
 * name, so renaming someone does not change their face.
 */
export function avatarSrc(
  key: string | null | undefined,
  seed: string,
):
  | { kind: 'photo'; src: string }
  | { kind: 'icon'; icon: LucideIcon }
  | { kind: 'identicon'; src: string } {
  if (key) {
    const photo = photoUrl(key)
    if (photo) return { kind: 'photo', src: photo }

    const icon = ICON_BY_NAME.get(key)
    if (icon) return { kind: 'icon', icon }
  }
  return { kind: 'identicon', src: identicon(seed || 'anonymous') }
}

/** Human label, for the picker and for screen readers. */
export function avatarLabel(key: string | null | undefined): string {
  if (!key) return 'Generated avatar'
  if (key.startsWith(PHOTO_PREFIX)) return 'Photo'
  return AVATAR_ICONS.find((i) => i.name === key)?.label ?? 'Avatar'
}
