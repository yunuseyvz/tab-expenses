import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { usePopoverPlacement } from '#/hooks/usePopoverPlacement'
import { cn } from '#/lib/cn'

/**
 * A listbox that looks like the rest of this app.
 *
 * Why not a native <select> with a styled border: the *popup* is the problem,
 * not the control. Browsers draw that menu themselves — it is not in the
 * document, cannot be styled, ignores your border-radius, font and shadow, and
 * on macOS it ignores your colours too. So however carefully the closed control
 * is styled, the moment it opens the app stops looking like itself.
 *
 * Takes <option> children so call sites read like the native element, and
 * converts them internally.
 *
 * Keyboard is a real listbox, not a div with a click handler:
 *   ↑ ↓ move, Home/End jump, Enter/Space commit, Esc cancels, type-ahead jumps
 *   to an option starting with what you typed. Options carry
 *   aria-selected and the active one is tracked with aria-activedescendant, so a
 *   screen reader follows along without focus leaving the trigger.
 *
 * THE PANEL IS PORTALLED, and that is not a detail. It used to be `absolute`
 * inside this control, which is fine until the control sits in a settings card:
 * those cards carry `overflow-hidden` to clip their hairlines to the rounded
 * corners, so the panel was cut off at the card's edge — the Settlement cycle
 * row showed one and a half of its four options and no indication that three
 * more existed. Worse, nothing in that chain established a stacking context, so
 * the *next* settings group painted straight over the rest of the panel. Both
 * are invisible in isolation and only show up where a dropdown lands inside a
 * card, which is exactly where the settlement cycle lives.
 *
 * Portalling also means the panel is matched to the trigger's measured width
 * rather than stretching between two offsets that a flex row can make enormous,
 * and it can flip above the trigger when there is no room below instead of
 * running off the bottom of a phone.
 */
export interface ListboxOption {
  value: string
  label: string
  disabled?: boolean
  /** Rendered left of the label — an icon, a colour dot. */
  leading?: ReactNode
}

export function Listbox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  id,
  label,
  className,
  disabled,
  invalid,
}: {
  value: string
  onChange: (next: string) => void
  options: Array<ListboxOption>
  placeholder?: string
  id?: string
  /** Accessible name when there is no visible <Label htmlFor>. */
  label?: string
  className?: string
  disabled?: boolean
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [typed, setTyped] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const listId = useId()

  // The panel matches the trigger's width, which has to be measured rather than
  // guessed: the trigger is a `flex` child whose width comes from whatever
  // `className` the call site passed (`w-48` on the member filter, `w-36` on the
  // settings row). Reading it back on open is cheaper than making every call site
  // state its width twice, and it cannot drift from the control it belongs to.
  const [triggerWidth, setTriggerWidth] = useState(0)
  const { anchor, panel, panelEl, floating } =
    usePopoverPlacement<HTMLButtonElement>({
      // Placement waits for the measurement. The panel is rendered only once
      // `floating` exists, so holding the hook closed until then is what stops a
      // one-frame panel at width zero appearing at the wrong place.
      open: open && triggerWidth > 0,
      width: triggerWidth,
    })

  useLayoutEffect(() => {
    if (!open) {
      setTriggerWidth(0)
      return
    }
    setTriggerWidth(
      Math.round(trigger.current?.getBoundingClientRect().width ?? 0),
    )
  }, [open])

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  )
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  // Open with the current value active, so Enter re-commits rather than jumping
  // to the first option.
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0)
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      // Both halves. The panel is portalled, so it is not inside `root`, and a
      // check that only knew about the trigger closed the panel the moment you
      // pressed any of the options it exists to offer.
      if (!root.current?.contains(target) && !panelEl?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, panelEl])

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return
    panelEl
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, active, panelEl])

  const step = useCallback(
    (delta: number) => {
      setTyped('')
      setActive((a) => {
        // Skip disabled options: arrowing onto one and having nothing happen is
        // the most common way a hand-rolled listbox feels broken. Bounded by the
        // option count so an all-disabled list cannot spin.
        let next = a
        let hops = options.length
        while (hops-- > 0) {
          next = (next + delta + options.length) % options.length
          if (!options[next]?.disabled) return next
        }
        return a
      })
    },
    [options],
  )

  const commit = useCallback(
    (i: number) => {
      const option = options[i]
      if (!option || option.disabled) return
      onChange(option.value)
      setOpen(false)
    },
    [options, onChange],
  )

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        step(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        step(-1)
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(active)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        // Type-ahead: jump to the first option starting with this character.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
          const hit = options.findIndex(
            (o) =>
              !o.disabled &&
              o.label.toLowerCase().startsWith((typed + e.key).toLowerCase()),
          )
          if (hit >= 0) {
            setTyped(typed + e.key)
            setActive(hit)
          }
        }
    }
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={(el) => {
          ;(anchor as { current: HTMLButtonElement | null }).current = el
          trigger.current = el
        }}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listId}-opt-${active}` : undefined}
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full flex items-center gap-2 text-left',
          'bg-paper-sunk text-ink rounded-[var(--radius-control)]',
          'px-3.5 py-2.5 border border-[color:var(--rule-field)] cursor-pointer',
          'shadow-[var(--shadow-deboss)]',
          'transition-[background-color,border-color,box-shadow] duration-150',
          'ease-[var(--ease-out-soft)]',
          'focus:outline-none focus:border-terracotta',
          'focus:bg-[var(--color-paper-raised)]',
          'focus:shadow-[var(--shadow-deboss),0_0_0_3px_color-mix(in_oklab,var(--color-terracotta)_28%,transparent)]',
          'aria-invalid:border-oxblood',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        {selected?.leading}
        <span className={cn('flex-1 truncate', !selected && 'text-ink-faint')}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn(
            'shrink-0 text-ink-muted transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        floating &&
        createPortal(
          <div
            ref={panel}
            id={listId}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            style={{
              left: floating.left,
              top: floating.top,
              width: floating.width,
              // The hook flips the panel above the trigger when there is no room
              // below, so it can open *upwards* from the top edge. Origin has to
              // follow, or the panel grows away from the trigger it belongs to.
              transformOrigin: floating.side === 'above' ? 'bottom' : 'top',
            }}
            className="fixed z-[60]
              max-h-64 overflow-y-auto overscroll-contain
              rounded-[var(--radius-md)] border border-rule
              bg-[var(--color-paper-raised)]
              p-1
              shadow-[var(--shadow-float)]"
            onKeyDown={onKeyDown}
          >
            {options.map((option, i) => {
              const isSelected = option.value === value
              const isActive = i === active
              return (
                <div
                  key={option.value}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  data-index={i}
                  // onMouseDown, not onClick: the blur that follows a click would
                  // tear the panel down before the click landed.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(i)
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2',
                    'text-sm cursor-pointer transition-colors duration-100',
                    isActive
                      ? 'bg-[var(--color-paper-sunk)] text-ink'
                      : 'text-ink-muted',
                    option.disabled && 'opacity-40 cursor-not-allowed',
                    isSelected && 'font-medium',
                  )}
                >
                  {/* The tick is reserved width whether or not it is shown, so the
                    labels stay aligned down the list. */}
                  <Check
                    size={14}
                    aria-hidden
                    className={cn(
                      'shrink-0',
                      isSelected
                        ? 'text-[var(--color-terracotta)]'
                        : 'opacity-0',
                    )}
                  />
                  {option.leading}
                  <span className="truncate">{option.label}</span>
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Adapter so existing call sites keep reading like a native <select>:
 *
 *   <Select value={v} onChange={setV}>
 *     <option value="">Uncategorised</option>
 *   </Select>
 *
 * Children are read once and converted, so the API stays familiar while the
 * rendered control is entirely ours.
 */
export function Select({
  children,
  ...props
}: {
  children?: ReactNode
  value: string
  onChange: (e: { target: { value: string } }) => void
  id?: string
  'aria-label'?: string
  className?: string
  disabled?: boolean
}) {
  const options = useMemo<Array<ListboxOption>>(() => {
    const out: Array<ListboxOption> = []
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return
      const el = child as ReactElement<{
        value?: string
        disabled?: boolean
        children?: ReactNode
      }>
      const value = el.props.value ?? ''
      const label =
        typeof el.props.children === 'string'
          ? el.props.children
          : String(el.props.children ?? value)
      out.push({ value, label, disabled: el.props.disabled })
    })
    return out
  }, [children])

  return (
    <Listbox
      id={props.id}
      label={props['aria-label']}
      value={props.value}
      options={options}
      disabled={props.disabled}
      className={props.className}
      onChange={(next) => props.onChange({ target: { value: next } })}
    />
  )
}

/** Convenience for the common "map a list into a Select" case. */
export function optionsFrom<T extends { id: string }>(
  items: Array<T>,
  label: (item: T) => string,
  leading?: (item: T) => ReactNode,
): Array<ListboxOption> {
  return items.map((item) => ({
    value: item.id,
    label: label(item),
    leading: leading?.(item),
  }))
}
