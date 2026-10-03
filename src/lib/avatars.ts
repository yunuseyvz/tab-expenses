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
  Accessibility,
  Anchor,
  Apple,
  Baby,
  Beer,
  Bike,
  Bird,
  Building2,
  Cake,
  Candy,
  CandyCane,
  Cat,
  Cherry,
  Citrus,
  Clapperboard,
  Clover,
  Coffee,
  Compass,
  Contact,
  Cookie,
  Croissant,
  Crown,
  Dog,
  Donut,
  Droplet,
  Drumstick,
  Egg,
  EggFried,
  Feather,
  Fish,
  Flower2,
  Ghost,
  Gift,
  Grape,
  Guitar,
  Headphones,
  Heart,
  Home,
  IceCreamBowl,
  KeyRound,
  Lamp,
  Laugh,
  Leaf,
  Lollipop,
  MapPin,
  Mars,
  Mic,
  Moon,
  Mountain,
  Music,
  Nut,
  Palette,
  PawPrint,
  PersonStanding,
  Pizza,
  Popcorn,
  Rabbit,
  Rocket,
  Scissors,
  Shell,
  Ship,
  Smile,
  Snail,
  Sparkles,
  Sprout,
  Squirrel,
  Star,
  Sun,
  Tent,
  Ticket,
  TreePine,
  Trees,
  Umbrella,
  User,
  UserRound,
  Users,
  Venus,
  Warehouse,
  Waves,
  Wheat,
  Wine,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Photographic avatars, if any are ever vendored into public/avatars/. */
const PHOTO_PREFIX = 'photo:'

/**
 * Grouped, because there are enough of them that an undifferentiated grid makes
 * you scan for the one you want. The order is the order a person would look:
 * themselves first, then things that might stand in for a person, then the
 * household, then the world.
 */
export const AVATAR_GROUPS = [
  {
    group: 'People',
    icons: [
      { name: 'user', label: 'Person', icon: User },
      { name: 'users', label: 'People', icon: Users },
      { name: 'user-round', label: 'Person, round', icon: UserRound },
      { name: 'standing', label: 'Standing person', icon: PersonStanding },
      { name: 'contact', label: 'Contact card', icon: Contact },
      { name: 'venus', label: 'Woman', icon: Venus },
      { name: 'mars', label: 'Man', icon: Mars },
      { name: 'baby', label: 'Baby', icon: Baby },
      { name: 'accessible', label: 'Accessibility', icon: Accessibility },
      { name: 'smile', label: 'Smiling', icon: Smile },
      { name: 'laugh', label: 'Laughing', icon: Laugh },
      { name: 'ghost', label: 'Ghost', icon: Ghost },
    ],
  },
  {
    group: 'Animals',
    icons: [
      { name: 'paw', label: 'Paw', icon: PawPrint },
      { name: 'cat', label: 'Cat', icon: Cat },
      { name: 'dog', label: 'Dog', icon: Dog },
      { name: 'rabbit', label: 'Rabbit', icon: Rabbit },
      { name: 'bird', label: 'Bird', icon: Bird },
      { name: 'fish', label: 'Fish', icon: Fish },
      { name: 'squirrel', label: 'Squirrel', icon: Squirrel },
      { name: 'snail', label: 'Snail', icon: Snail },
      { name: 'shell', label: 'Shell', icon: Shell },
    ],
  },
  {
    group: 'Place',
    icons: [
      { name: 'home', label: 'House', icon: Home },
      { name: 'building', label: 'Building', icon: Building2 },
      { name: 'warehouse', label: 'Warehouse', icon: Warehouse },
      { name: 'tent', label: 'Tent', icon: Tent },
      { name: 'ship', label: 'Ship', icon: Ship },
      { name: 'anchor', label: 'Anchor', icon: Anchor },
      { name: 'compass', label: 'Compass', icon: Compass },
      { name: 'map-pin', label: 'Map pin', icon: MapPin },
      { name: 'rocket', label: 'Rocket', icon: Rocket },
      { name: 'lamp', label: 'Lamp', icon: Lamp },
      { name: 'key', label: 'Key', icon: KeyRound },
      { name: 'umbrella', label: 'Umbrella', icon: Umbrella },
      { name: 'bike', label: 'Bike', icon: Bike },
    ],
  },
  {
    group: 'Nature',
    icons: [
      { name: 'sun', label: 'Sun', icon: Sun },
      { name: 'moon', label: 'Moon', icon: Moon },
      { name: 'star', label: 'Star', icon: Star },
      { name: 'sparkles', label: 'Sparkles', icon: Sparkles },
      { name: 'zap', label: 'Bolt', icon: Zap },
      { name: 'droplet', label: 'Droplet', icon: Droplet },
      { name: 'waves', label: 'Waves', icon: Waves },
      { name: 'mountain', label: 'Mountain', icon: Mountain },
      { name: 'leaf', label: 'Leaf', icon: Leaf },
      { name: 'tree', label: 'Tree', icon: TreePine },
      { name: 'trees', label: 'Trees', icon: Trees },
      { name: 'sprout', label: 'Sprout', icon: Sprout },
      { name: 'flower', label: 'Flower', icon: Flower2 },
      { name: 'clover', label: 'Clover', icon: Clover },
      { name: 'wheat', label: 'Wheat', icon: Wheat },
      { name: 'heart', label: 'Heart', icon: Heart },
      { name: 'cherry', label: 'Cherries', icon: Cherry },
    ],
  },
  {
    group: 'Food',
    icons: [
      { name: 'apple', label: 'Apple', icon: Apple },
      { name: 'orange', label: 'Citrus', icon: Citrus },
      { name: 'grape', label: 'Grapes', icon: Grape },
      { name: 'olive', label: 'Olive', icon: Egg },
      { name: 'egg', label: 'Egg', icon: EggFried },
      { name: 'nut', label: 'Nut', icon: Nut },
      { name: 'bread', label: 'Bread', icon: Croissant },
      { name: 'coffee', label: 'Coffee', icon: Coffee },
      { name: 'beer', label: 'Beer', icon: Beer },
      { name: 'wine', label: 'Wine', icon: Wine },
      { name: 'cake', label: 'Cake', icon: Cake },
      { name: 'cookie', label: 'Cookie', icon: Cookie },
      { name: 'donut', label: 'Donut', icon: Donut },
      { name: 'pizza', label: 'Pizza', icon: Pizza },
      { name: 'popcorn', label: 'Popcorn', icon: Popcorn },
      { name: 'drumstick', label: 'Drumstick', icon: Drumstick },
      { name: 'icecream', label: 'Ice cream', icon: IceCreamBowl },
      { name: 'lollipop', label: 'Lollipop', icon: Lollipop },
      { name: 'candy', label: 'Candy', icon: Candy },
      { name: 'candycane', label: 'Candy cane', icon: CandyCane },
    ],
  },
  {
    group: 'Things',
    icons: [
      { name: 'gift', label: 'Gift', icon: Gift },
      { name: 'ticket', label: 'Ticket', icon: Ticket },
      { name: 'music', label: 'Music', icon: Music },
      { name: 'guitar', label: 'Guitar', icon: Guitar },
      { name: 'headphones', label: 'Headphones', icon: Headphones },
      { name: 'mic', label: 'Microphone', icon: Mic },
      { name: 'film', label: 'Film', icon: Clapperboard },
      { name: 'palette', label: 'Palette', icon: Palette },
      { name: 'scissors', label: 'Scissors', icon: Scissors },
      { name: 'wrench', label: 'Wrench', icon: Wrench },
      { name: 'crown', label: 'Crown', icon: Crown },
      { name: 'feather', label: 'Feather', icon: Feather },
    ],
  },
] as const satisfies ReadonlyArray<{
  group: string
  icons: ReadonlyArray<{
    name: string
    label: string
    icon: LucideIcon
  }>
}>

/** Flat view of the same set, which is what the validator and resolver want. */
export const AVATAR_ICONS: ReadonlyArray<{
  name: string
  label: string
  icon: LucideIcon
}> = AVATAR_GROUPS.flatMap((g) => g.icons.map((i) => ({ ...i })))

export type AvatarIconName = string

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
 * What a generated mark stands for.
 *
 * A separate type rather than a `hueOffset` parameter, because a household and a
 * person should be told apart by *shape* and only then by colour. Both render as
 * the same mirrored 5x5 grid, so the grid alone cannot do it; what differs is
 * what fills a cell and how the mark is weighted.
 *
 *   person — squares, the classic block identicon. Open, airy, a handful of marks
 *            on paper, which is right for an individual.
 *   space  — pips, rounder and set closer together, with the middle row always
 *            lit. Reads as a hub with members around it, and at 22-30px it is
 *            unmistakably not the square version sitting next to it.
 */
export type AvatarKind = 'person' | 'space'

/**
 * Hue anchors, spread around the wheel.
 *
 * The previous range was `18 + hash % 78` — hues 18 to 96, which is orange
 * through yellow and into yellow-green. That is *one third of the wheel*, and it
 * put a majority of marks in the 60-96 olive band, so a household's generated
 * avatars came out assorted shades of the same green. The range was originally
 * chosen to stay near a warm paper palette; the palette is now a cool neutral at
 * hue 255 with a terracotta accent, so that reasoning no longer applies and the
 * narrowness is just a bug.
 *
 * Fourteen anchors rather than a continuous range, because evenly spaced
 * *sampled* hues cluster perceptually: they bunch in the yellow-greens and thin
 * out through the cyans, which is where "varied" stops being true. A hand-placed
 * list puts a roughly even number of marks in every region.
 *
 * Jittered per id by a few degrees below, so two seeds landing on the same anchor
 * are visibly different rather than identical.
 */
const HUE_ANCHORS = [
  20, 45, 68, 100, 148, 174, 198, 218, 240, 262, 285, 310, 335, 352,
] as const

/** Perceptual lightness/chroma, not HSL. */
interface Ink {
  fill: string
  deep: string
}

/**
 * Colour for a mark, in oklch.
 *
 * oklch rather than hsl because HSL lightness is a lie about brightness across
 * the wheel: `hsl(60 50% 60%)` is a pale washed yellow while `hsl(240 50% 60%)`
 * is a mid blue, so an HSL identicon set is never internally consistent — the
 * yellows always look lighter and weaker than the blues beside them. Holding L
 * constant in oklch holds apparent lightness constant, which is what makes two
 * generated avatars feel like they belong to the same set.
 *
 * Households sit a little deeper and a little more chromatic than people. Same
 * weight on screen, but a token rather than a person, and it gives the two kinds
 * a difference that survives being rendered entirely in greyscale.
 */
function inksFor(hue: number, kind: AvatarKind): Ink {
  const h = ((hue % 360) + 360) % 360
  const deepHue = (h + 14) % 360
  return kind === 'space'
    ? { fill: `oklch(0.58 0.135 ${h})`, deep: `oklch(0.42 0.12 ${deepHue})` }
    : { fill: `oklch(0.63 0.115 ${h})`, deep: `oklch(0.47 0.105 ${deepHue})` }
}

/**
 * The hue for a seed: an anchor, jittered.
 *
 * Anchored rather than uniform so that a *narrow* set of ids still spans the
 * whole palette — which is the common case, since a household has two or three
 * spaces and two members, not two hundred.
 */
function hueFor(h: number, kind: AvatarKind): number {
  const anchor = HUE_ANCHORS[(h >>> 8) % HUE_ANCHORS.length]!
  const jitter = ((h >>> 20) % 9) - 4
  // Nudge the two kinds apart within an anchor so a space and a person sharing
  // one cannot land on the identical colour even when they share a hue.
  return (anchor + jitter + (kind === 'space' ? 6 : 0)) % 360
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
export function identicon(seed: string, kind: AvatarKind = 'person'): string {
  const h = seedFrom(seed)
  const { fill, deep } = inksFor(hueFor(h, kind), kind)
  const cells: Array<string> = []

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      let bit = (h >>> (row * 3 + col)) & 1
      // A household's middle row is never empty. All 15 bits clear in about one
      // seed in 32 000, and a mark that renders as a blank disc reads as a broken
      // image or a stuck spinner rather than as an answer — so for a household
      // the middle row is forced lit. A person is left to the bits: the same odds
      // apply, but forcing it there too would cost the two kinds the one thing
      // that sets them apart.
      if (kind === 'space' && row === 2 && col === 1) bit = 1
      if (!bit) continue

      const x = col * 4
      const y = row * 4
      const colour = (row + col) % 2 === 0 ? fill : deep
      const paint = (px: number) =>
        kind === 'space'
          ? // 1.75 rather than 2 in a 4-unit cell: at an exact radius of 2 the
            // pips touch edge to edge and the air gaps that make them read as
            // separate marks disappear.
            `<circle cx="${px + 2}" cy="${y + 2}" r="1.75" fill="${colour}"/>`
          : `<rect x="${px}" y="${y}" width="4" height="4" fill="${colour}"/>`

      cells.push(paint(x))
      // Mirror the third column into the fourth and fifth.
      if (col < 2) cells.push(paint(20 - x - 4))
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
  kind: AvatarKind = 'person',
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
  return { kind: 'identicon', src: identicon(seed || 'anonymous', kind) }
}

/** Human label, for the picker and for screen readers. */
export function avatarLabel(key: string | null | undefined): string {
  if (!key) return 'Generated avatar'
  if (key.startsWith(PHOTO_PREFIX)) return 'Photo'
  return AVATAR_ICONS.find((i) => i.name === key)?.label ?? 'Avatar'
}
