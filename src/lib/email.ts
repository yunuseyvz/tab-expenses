/**
 * OTP delivery.
 *
 * Two transports behind one function, selected by whether RESEND_API_KEY is
 * set: Resend over HTTPS in prod, Mailpit over SMTP in dev. One env var flips
 * between them.
 *
 * Plain text on purpose — the code has to be readable in any mail client, and
 * an HTML template is not worth the dependency surface for a 6-digit code.
 */
import 'server-only'

import { Resend } from 'resend'
import { env, usesMailpit } from './db/env'

export type OtpType =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'change-email'

export interface SendOtpArgs {
  to: string
  otp: string
  type: OtpType
}

function subjectFor(type: OtpType): string {
  switch (type) {
    case 'sign-in':
      return 'Your Splitwise sign-in code'
    case 'email-verification':
      return 'Verify your Splitwise email'
    case 'forget-password':
      return 'Your Splitwise password reset code'
    case 'change-email':
      return 'Confirm your new Splitwise email'
  }
}

function bodyFor(type: OtpType, otp: string): string {
  const intro =
    type === 'sign-in'
      ? 'Use this code to sign in to Splitwise:'
      : type === 'email-verification'
        ? 'Use this code to verify your email address:'
        : type === 'forget-password'
          ? 'Use this code to reset your Splitwise password:'
          : 'Use this code to confirm your new email address:'

  return [
    intro,
    '',
    `    ${otp}`,
    '',
    'The code is valid for 10 minutes. If you did not request it, you can',
    'safely ignore this message.',
    '',
    '— Splitwise',
  ].join('\n')
}

export async function sendOtpEmail({ to, otp, type }: SendOtpArgs) {
  const e = env()
  const subject = subjectFor(type)
  const text = bodyFor(type, otp)

  if (usesMailpit(e)) {
    // Dev: hand the message to Mailpit so it shows up at http://localhost:8025
    const res = await fetch(`http://${e.SMTP_HOST}:${e.SMTP_PORT}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: e.EMAIL_FROM,
        To: [to],
        Subject: subject,
        Text: text,
      }),
    })
    if (!res.ok) {
      throw new Error(
        `Mailpit send failed (${res.status}): ${await res.text()}`,
      )
    }
    return
  }

  const resend = new Resend(e.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: e.EMAIL_FROM,
    to,
    subject,
    text,
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}
