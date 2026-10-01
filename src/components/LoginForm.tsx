/**
 * Sign-in: email → 6-box code.
 *
 * Registration lives at /register. This form deliberately does not ask for a
 * name: an account is only ever created by registering, so a login attempt for
 * an address with no account cannot conjure one.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'

import { OtpCode, codeIsComplete, emptyCode } from '#/components/OtpCode'
import { TabLogo } from '#/components/TabLogo'
import { APP_NAME } from '#/lib/app-meta'
import { Button } from '#/components/ui/Button'
import { Input, Label } from '#/components/ui/Input'
import { authClient } from '#/lib/auth-client'

const RESEND_COOLDOWN = 30

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState<Array<string>>(emptyCode)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

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
    setCode(emptyCode())
    setCooldown(RESEND_COOLDOWN)
    // No "code sent" confirmation here. Better Auth deliberately sends nothing
    // for an address with no account, and saying so would turn the login form
    // into an account-existence oracle.
  }

  async function verify() {
    const otp = code.join('')
    if (!codeIsComplete(code)) return
    setVerifying(true)
    setError(null)
    const { error: err } = await authClient.signIn.emailOtp({ email, otp })
    setVerifying(false)
    if (err) {
      setError(
        'That code did not work, or there is no account for this email yet.',
      )
      setCode(emptyCode())
      return
    }
    navigate({ to: redirectTo ?? '/dashboard' })
  }

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <TabLogo wordmark={APP_NAME} markSize={24} className="mb-4" />
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
            <OtpCode value={code} onChange={setCode} invalid={!!error} />

            <Button
              size="lg"
              className="w-full"
              disabled={!codeIsComplete(code) || verifying}
              onClick={() => void verify()}
            >
              {verifying ? 'Checking…' : 'Sign in'}
            </Button>

            <button
              type="button"
              onClick={() => {
                // Re-sending rotates the code, so anything already typed is
                // guaranteed wrong. Clearing it beats leaving a stale value.
                setCode(emptyCode())
                void sendCode()
              }}
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
                setCode(emptyCode())
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
          {error}{' '}
          <Link
            to="/register"
            search={{ email }}
            className="underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      )}

      {step === 'email' && (
        <p className="mt-6 text-sm text-ink-muted text-center">
          No account yet?{' '}
          <Link
            to="/register"
            search={{ email }}
            className="text-terracotta-ink underline underline-offset-4"
          >
            Create one
          </Link>
        </p>
      )}
    </div>
  )
}
