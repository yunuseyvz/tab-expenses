/**
 * Outbound mail.
 *
 * Two transports behind one function, selected by whether RESEND_API_KEY is
 * set: Resend over HTTPS in prod, Mailpit over SMTP in dev. One env var flips
 * between them.
 *
 * Plain text on purpose — both the OTP and the invitation have to be readable
 * in any mail client, and an HTML template is not worth the dependency surface
 * for a 6-digit code and a link.
 */
import { createServerOnlyFn } from '@tanstack/react-start'
import { Resend } from 'resend'
import { env, usesMailpit } from './db/env'
import type { ServerEnv } from './db/env'

/**
 * Split an RFC 5322 address ("Name <email@example.com>") into Mailpit's
 * {Name, Email} shape. A bare address becomes a name-less entry rather than
 * being dropped.
 */
export function addressFrom(value: string): { Name: string; Email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value)
  if (match) return { Name: match[1] ?? '', Email: match[2] ?? value }
  return { Name: '', Email: value.trim() }
}

export type OtpType =
  'sign-in' | 'email-verification' | 'forget-password' | 'change-email'

export interface SendOtpArgs {
  to: string
  otp: string
  type: OtpType
}

function subjectFor(type: OtpType): string {
  switch (type) {
    case 'sign-in':
      return 'Your Tab sign-in code'
    case 'email-verification':
      return 'Verify your Tab email'
    case 'forget-password':
      return 'Your Tab password reset code'
    case 'change-email':
      return 'Confirm your new Tab email'
  }
}

function bodyFor(type: OtpType, otp: string): string {
  const intro =
    type === 'sign-in'
      ? 'Use this code to sign in to Tab:'
      : type === 'email-verification'
        ? 'Use this code to verify your email address:'
        : type === 'forget-password'
          ? 'Use this code to reset your Tab password:'
          : 'Use this code to confirm your new email address:'

  return [
    intro,
    '',
    `    ${otp}`,
    '',
    'The code is valid for 10 minutes. If you did not request it, you can',
    'safely ignore this message.',
    '',
    '— Tab',
  ].join('\n')
}

/**
 * Send one plain-text message through whichever transport is configured.
 *
 * Shared by the OTP and invite mail so there is exactly one place that knows
 * about Mailpit's REST quirks, and one place that can fail loudly.
 */
async function deliver(
  e: ServerEnv,
  to: string,
  subject: string,
  text: string,
) {
  if (usesMailpit(e)) {
    // Dev: hand the message to Mailpit's HTTP API so it shows up in the
    // Mailpit UI. Note this is the REST port (8025), not the SMTP one, and
    // it wants From/To as {Name, Email} objects rather than RFC 5322
    // strings.
    const res = await fetch(
      `${e.MAILPIT_API_URL.replace(/\/$/, '')}/api/v1/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: addressFrom(e.EMAIL_FROM),
          To: [addressFrom(to)],
          Subject: subject,
          Text: text,
        }),
      },
    )
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

export const sendOtpEmail = createServerOnlyFn(async function ({
  to,
  otp,
  type,
}: SendOtpArgs) {
  const e = env()
  await deliver(e, to, subjectFor(type), bodyFor(type, otp))
})

export interface SendInviteArgs {
  to: string
  /** The household being joined. */
  spaceName: string
  /** Who sent the invite, for the recipient to recognise. */
  inviterName: string
  /** Absolute link to the accept page, token included. */
  acceptUrl: string
  expiresAt: Date
}

/**
 * The invitation mail.
 *
 * Plain text, like the OTP mail. This app has no HTML mail anywhere, and a
 * household ledger does not justify the extra path — plus a text body is the one
 * that cannot be mangled by a mail client.
 */
export const sendInviteEmail = createServerOnlyFn(async function ({
  to,
  spaceName,
  inviterName,
  acceptUrl,
  expiresAt,
}: SendInviteArgs) {
  const e = env()
  const days = Math.max(
    1,
    Math.round((expiresAt.getTime() - Date.now()) / 86_400_000),
  )

  const text = [
    `${inviterName} invited you to join "${spaceName}" on Tab.`,
    '',
    'Accept the invitation:',
    '',
    `    ${acceptUrl}`,
    '',
    `The link works for anyone signed in as ${to}, and expires in ${days} day${days === 1 ? '' : 's'}.`,
    'If you were not expecting this, ignore this message. Nothing has changed.',
    '',
    '— Tab',
  ].join('\n')

  await deliver(e, to, `${inviterName} invited you to ${spaceName}`, text)
})
