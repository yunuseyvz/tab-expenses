/**
 * The 6-box code entry, shared by sign-in and registration.
 *
 * Six real inputs with a shared complete-code behaviour, not a fake single
 * field — otherwise paste, backspace and screen-reader users all break. It is
 * extracted rather than duplicated because registration needs the same boxes and
 * two copies of this logic would drift.
 */
import { useEffect, useRef } from 'react'

import { cn } from '#/lib/cn'

export function OtpCode({
  value,
  onChange,
  invalid,
}: {
  value: Array<string>
  /** Called with a fresh 6-slot array, already normalised. */
  onChange: (next: Array<string>) => void
  invalid?: boolean
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  // Always start at the first box when the code is cleared, which is what
  // happens on a wrong guess or when the user asks for a new code.
  useEffect(() => {
    if (value.every((c) => c === '')) inputs.current[0]?.focus()
  }, [value])

  /**
   * Accept one digit, or several at once.
   *
   * A paste normally arrives via onPaste below, but mobile OTP autofill,
   * password managers and hardware scanners often set the whole value through a
   * plain input event instead. Distributing the characters here means those
   * paths work rather than silently filling one box.
   */
  function onDigit(i: number, raw: string) {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 0) {
      const cleared = [...value]
      cleared[i] = ''
      onChange(cleared)
      return
    }

    const next = [...value]
    digits
      .slice(0, 6 - i)
      .split('')
      .forEach((d, offset) => {
        next[i + offset] = d
      })
    onChange(next)

    inputs.current[Math.min(i + digits.length, 5)]?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !value[i] && i > 0)
      inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) inputs.current[i + 1]?.focus()
  }

  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    onChange(Array.from({ length: 6 }, (_, i) => text[i] ?? ''))
    inputs.current[Math.min(text.length, 5)]?.focus()
  }

  return (
    <div
      className="flex gap-2 mb-4"
      onPaste={onPaste}
      role="group"
      aria-label="6-digit code"
    >
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputs.current[i] = el
          }}
          value={digit}
          onChange={(e) => onDigit(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          // Deliberately no maxLength: it would clip the value before onChange
          // sees it, so the multi-character autofill path could never arrive.
          // One character per box is enforced in onDigit instead.
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          className={cn(
            'tnum w-full h-14 text-center text-xl font-medium',
            'bg-paper-sunk rounded-[var(--radius-sm)] shadow-[var(--shadow-deboss)]',
            'border-b-2 transition-colors duration-150',
            invalid
              ? 'border-oxblood'
              : 'border-transparent focus:border-terracotta',
          )}
        />
      ))}
    </div>
  )
}

/** An empty 6-slot code, for resetting state. */
export const emptyCode = () => Array<string>(6).fill('')

/** True once every box has a digit. */
export const codeIsComplete = (code: Array<string>) =>
  code.every((c) => c !== '')
