/**
 * Icons for expense categories.
 *
 * A curated set rather than all ~1,500 lucide icons. Two reasons:
 *
 *   • a category is something a household recognises at a glance, and a picker
 *     offering `Anemometer` next to `Groceries` is not a picker, it is a
 *     dumping ground. Around forty covers rent, food, transport, utilities,
 *     health, kids, pets, savings and the rest of real life.
 *   • the name is stored in the database and validated server-side, so the set
 *     has to be a closed list anyway. Making it closed *by design* rather than
 *     by accident is the point.
 *
 * Changing this list is a schema-visible change: existing rows keep whatever
 * name they had, and `iconFor` falls back rather than rendering a gap.
 */
import {
  Baby,
  Banknote,
  Bike,
  BookOpen,
  Bus,
  Car,
  Clapperboard,
  CreditCard,
  Dumbbell,
  Flame,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  KeyRound,
  Landmark,
  Laptop,
  Lightbulb,
  Music,
  Package,
  PawPrint,
  PencilRuler,
  PiggyBank,
  Plane,
  Receipt,
  Scissors,
  Shield,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Sparkles,
  Sprout,
  Stethoscope,
  Ticket,
  Train,
  Trash2,
  Trophy,
  Umbrella,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The picker, in the order it is shown. Grouped loosely so a household can find
 * the right one without reading all forty.
 */
export const CATEGORY_ICONS = [
  { name: 'home', label: 'Home', icon: Home },
  { name: 'building', label: 'Building', icon: Landmark },
  { name: 'key', label: 'Rent or mortgage', icon: KeyRound },
  { name: 'wrench', label: 'Repairs', icon: Wrench },
  { name: 'shield', label: 'Insurance', icon: Shield },

  { name: 'utensils', label: 'Eating out', icon: Utensils },
  { name: 'shopping-cart', label: 'Shopping', icon: ShoppingCart },
  { name: 'shopping-basket', label: 'Groceries', icon: ShoppingBasket },
  { name: 'flame', label: 'Gas and heating', icon: Flame },
  { name: 'zap', label: 'Electricity', icon: Zap },
  { name: 'wifi', label: 'Internet', icon: Wifi },
  { name: 'lightbulb', label: 'Utilities', icon: Lightbulb },
  { name: 'trash-2', label: 'Waste', icon: Trash2 },

  { name: 'car', label: 'Car', icon: Car },
  { name: 'bus', label: 'Public transport', icon: Bus },
  { name: 'train', label: 'Rail', icon: Train },
  { name: 'plane', label: 'Flights', icon: Plane },
  { name: 'bike', label: 'Cycling', icon: Bike },

  { name: 'heart-pulse', label: 'Health', icon: HeartPulse },
  { name: 'stethoscope', label: 'Doctor', icon: Stethoscope },
  { name: 'pill', label: 'Pharmacy', icon: Package },
  { name: 'dumbbell', label: 'Sport', icon: Dumbbell },

  { name: 'baby', label: 'Children', icon: Baby },
  { name: 'graduation-cap', label: 'School', icon: GraduationCap },
  { name: 'shirt', label: 'Clothing', icon: Shirt },
  { name: 'scissors', label: 'Haircut', icon: Scissors },
  { name: 'gift', label: 'Gifts', icon: Gift },

  { name: 'paw-print', label: 'Pets', icon: PawPrint },
  { name: 'music', label: 'Music', icon: Music },
  { name: 'clapperboard', label: 'Going out', icon: Clapperboard },
  { name: 'ticket', label: 'Events', icon: Ticket },
  { name: 'book-open', label: 'Books', icon: BookOpen },
  { name: 'laptop', label: 'Equipment', icon: Laptop },
  { name: 'pencil-ruler', label: 'School or office', icon: PencilRuler },

  { name: 'receipt', label: 'Receipts', icon: Receipt },
  { name: 'piggy-bank', label: 'Savings', icon: PiggyBank },
  { name: 'banknote', label: 'Cash', icon: Banknote },
  { name: 'wallet', label: 'Wallet', icon: Wallet },
  { name: 'credit-card', label: 'Card', icon: CreditCard },
  { name: 'umbrella', label: 'Emergency', icon: Umbrella },
  { name: 'sprout', label: 'Garden', icon: Sprout },
  { name: 'sparkles', label: 'Treats', icon: Sparkles },
  { name: 'trophy', label: 'Celebrations', icon: Trophy },
] as const satisfies ReadonlyArray<{
  name: string
  label: string
  icon: LucideIcon
}>

export type CategoryIconName = (typeof CATEGORY_ICONS)[number]['name']

/** The names, for the server-side validator. Order is irrelevant there. */
export const CATEGORY_ICON_NAMES = CATEGORY_ICONS.map((i) => i.name) as [
  CategoryIconName,
  ...Array<CategoryIconName>,
]

const BY_NAME = new Map<string, LucideIcon>(
  CATEGORY_ICONS.map((i) => [i.name, i.icon]),
)

/** What to show when a stored name is not in the set (e.g. after a rename). */
export const FALLBACK_ICON: LucideIcon = Receipt

/**
 * Resolve a stored name to an icon component. Never returns undefined: a
 * missing icon must degrade to a neutral glyph, not an invisible hole in a
 * category list.
 */
export function iconFor(name: string | null | undefined): LucideIcon {
  if (!name) return FALLBACK_ICON
  return BY_NAME.get(name) ?? FALLBACK_ICON
}

/** Human label for the picker and for screen readers. */
export function iconLabel(name: string | null | undefined): string {
  if (!name) return 'No icon'
  return CATEGORY_ICONS.find((i) => i.name === name)?.label ?? 'Icon'
}
