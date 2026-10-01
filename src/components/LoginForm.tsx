/**
 * Two-step passwordless login: email → 6-box code.
 *
 * The code boxes are six real inputs with a shared OTP-complete behaviour, not
 * a fake single field — otherwise paste, backspace, and screen-reader users all
 * break.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/Button'
import { Input, Label } from '#/components/ui/Input'
import { authClient } from '#/lib/auth-client'

const RESEND_COOLDOWN = 30

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState<Array<string>>(Array(6).fill(''))
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (step === 'code') inputs.current[0]?.focus()
  }, [step])

  async function sendCode(target = email) {
    setSending(true)
    setError(null)
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: target,
      type: 'sign-in',
    })
    setSending(false)
    if (err) {
      setError(err.message ?? 'Could not send the code. Try again.')
      return
    }
    setStep('code')
    setCode(Array(6).fill(''))
    setCooldown(RESEND_COOLDOWN)
    toast.success(`Code sent to ${target}`)
  }

  async function verify() {
    const otp = code.join('')
    if (otp.length !== 6) return
    setVerifying(true)
    setError(null)
    const { error: err } = await authClient.signIn.emailOtp({ email, otp })
    setVerifying(false)
    if (err) {
      setError(err.message ?? 'That code did not work. Request a new one.')
      setCode(Array(6).fill(''))
      inputs.current[0]?.focus()
      return
    }
    navigate({ to: redirectTo ?? '/dashboard' })
  }

  /**
   * Accept one digit, or several at once.
   *
   * A paste normally arrives via the onPaste handler below, but mobile OTP
   * autofill, password managers, and hardware scanners often set the whole
   * value through a plain input event instead. Distributing the characters here
   * means those paths work rather than silently filling one box.
   */
  function onDigit(i: number, value: string) {
    const digits = value.replace(/\D/g, '')
    if (digits.length === 0) {
      const cleared = [...code]
      cleared[i] = ''
      setCode(cleared)
      return
    }

    const next = [...code]
    digits
      .slice(0, 6 - i)
      .split('')
      .forEach((d, offset) => {
        next[i + offset] = d
      })
    setCode(next)
    setError(null)

    const focusAt = Math.min(i + digits.length, 5)
    inputs.current[focusAt]?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !code[i] && i > 0) {
      inputs.current[i - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) inputs.current[i + 1]?.focus()
  }

  function onPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    const next = Array(6)
      .fill('')
      .map((_, i) => text[i] ?? '')
    setCode(next)
    inputs.current[Math.min(text.length, 5)]?.focus()
  }

  const complete = code.every((c) => c !== '')

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.16em] text-ink-faint">
          Splitwise
        </p>
        <h1 className="font-serif text-3xl mt-1">
          {step === 'email' ? 'Sign in' : 'Enter your code'}
        </h1>
        <p className="text-sm text-ink-muted mt-1.5">
          {step === 'email'
            ? 'No password. We email you a 6-digit code.'
            : `Sent to ${email}`}
        </p>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {step === 'email' ? (
          <motion.form
            key="email"
            onSubmit={(e) => {
              e.preventDefault()
              void sendCode()
            }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={sending}
            >
              {sending ? 'Sending…' : 'Send code'}
            </Button>
          </motion.form>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div
              className="flex gap-2 mb-4"
              onPaste={onPaste}
              role="group"
              aria-label="6-digit code"
            >
              {code.map((digit, i) => (
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
                  // Deliberately no maxLength: it would clip the value before
                  // onChange sees it, so the multi-character autofill path
                  // could never arrive. One character per box is enforced in
                  // onDigit instead.
                  aria-label={`Digit ${i + 1}`}
                  className="tnum w-full h-14 text-center text-xl font-medium
                    bg-paper-sunk rounded-[3px] shadow-[var(--shadow-deboss)]
                    border-b-2 border-transparent
                    focus:shadow-[var(--shadow-raise)] focus:border-terracotta
                   "
                />
              ))}
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!complete || verifying}
              onClick={() => void verify()}
            >
              {verifying ? 'Checking…' : 'Sign in'}
            </Button>

            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={cooldown > 0 || sending}
              className="mt-4 text-sm text-terracotta-ink underline underline-offset-4
                disabled:text-ink-faint disabled:no-underline w-full text-center"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode(Array(6).fill(''))
                setError(null)
              }}
              className="mt-2 text-sm text-ink-muted w-full text-center"
            >
              Use a different email
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p role="alert" className="mt-4 text-sm text-oxblood-ink">
          {error}
        </p>
      )}
    </div>
  )
}
