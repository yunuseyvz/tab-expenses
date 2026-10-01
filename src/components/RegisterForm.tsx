/**
 * Registration: name + email → 6-box code.
 *
 * The account is created server-side before the code is sent (see
 * startRegistration), so a user who abandons this midway leaves behind an
 * unverified row that cannot sign in anywhere.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'

import { OtpCode, codeIsComplete, emptyCode } from '#/components/OtpCode'
import { Button } from '#/components/ui/Button'
import { Input, Label } from '#/components/ui/Input'
import { authClient } from '#/lib/auth-client'
import { startRegistration } from '#/lib/auth.functions'

const RESEND_COOLDOWN = 30

export function RegisterForm({ initialEmail }: { initialEmail?: string }) {
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [step, setStep] = useState<'details' | 'code'>('details')
  const [code, setCode] = useState<Array<string>>(emptyCode)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  function sendCode() {
    start.mutate({ name, email })
  }

  const start = useMutation({
    mutationFn: (input: { name: string; email: string }) =>
      startRegistration({ data: input }),
    onSuccess: (result) => {
      if (result.status === 'exists') {
        // Not a failure — just the wrong form. Say where to go instead.
        setError('That email already has an account. Sign in instead.')
        return
      }
      setStep('code')
      setCode(emptyCode())
      setCooldown(RESEND_COOLDOWN)
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not start registration. Try again.',
      )
    },
  })

  const verify = useMutation({
    mutationFn: (otp: string) =>
      authClient.signIn.emailOtp({ email, otp }).then((r) => r.error),
    onSuccess: (err) => {
      if (!err) {
        navigate({ to: '/setup' })
        return
      }
      setError('That code did not work. Request a new one.')
      setCode(emptyCode())
    },
    onError: () => {
      setError('Could not reach the server. Check your connection.')
      setCode(emptyCode())
    },
  })

  function submitCode() {
    if (!codeIsComplete(code)) return
    setError(null)
    verify.mutate(code.join(''))
  }

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.16em] text-ink-faint">
          Splitwise
        </p>
        <h1 className="font-serif text-3xl mt-1">
          {step === 'details' ? 'Create your account' : 'Enter your code'}
        </h1>
        <p className="text-sm text-ink-muted mt-1.5">
          {step === 'details'
            ? 'No password. Your name, your email, one code.'
            : `Sent to ${email}`}
        </p>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        {step === 'details' ? (
          <motion.form
            key="details"
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
              <Label htmlFor="reg-name">Your name</Label>
              <Input
                id="reg-name"
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Max"
              />
            </div>
            <div>
              <Label htmlFor="reg-email">Email</Label>
              <Input
                id="reg-email"
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
              disabled={start.isPending || !name.trim() || !email}
            >
              {start.isPending ? 'Sending…' : 'Send code'}
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
              disabled={!codeIsComplete(code) || verify.isPending}
              onClick={submitCode}
            >
              {verify.isPending ? 'Checking…' : 'Create account'}
            </Button>

            <button
              type="button"
              onClick={() => {
                setCode(emptyCode())
                sendCode()
              }}
              disabled={cooldown > 0 || start.isPending}
              className="mt-4 text-sm text-terracotta-ink underline underline-offset-4
                disabled:text-ink-faint disabled:no-underline w-full text-center"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('details')
                setCode(emptyCode())
                setError(null)
              }}
              className="mt-2 text-sm text-ink-muted w-full text-center"
            >
              Change name or email
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p role="alert" className="mt-4 text-sm text-oxblood-ink">
          {error}{' '}
          {error.includes('already has an account') && (
            <Link
              to="/login"
              search={{ redirect: undefined }}
              className="underline underline-offset-4"
            >
              Sign in
            </Link>
          )}
        </p>
      )}

      {step === 'details' && (
        <p className="mt-6 text-sm text-ink-muted text-center">
          Already registered?{' '}
          <Link
            to="/login"
            search={{ redirect: undefined }}
            className="text-terracotta-ink underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      )}
    </div>
  )
}
