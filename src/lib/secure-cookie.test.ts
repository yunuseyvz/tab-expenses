/**
 * The `Secure` decision, on its own.
 *
 * This one function is the difference between "switching household sticks" and
 * "switching household silently reverts the next time you change section", and
 * the failure is invisible in a way that is worth being blunt about: the server
 * sends a correct `Set-Cookie`, the response looks right, nothing throws, and
 * the browser simply refuses to keep the cookie. A production build served over
 * plain HTTP — a LAN address, a Tailscale name, anything that is not localhost
 * — hit exactly that, while localhost worked fine, because Chromium treats
 * `http://localhost` as a secure context and so accepts a `Secure` cookie there.
 *
 * The end-to-end version of this is in `e2e/spaces.spec.ts`, asserting the real
 * header on both branches. This is the cheap one.
 */
import { describe, expect, it } from 'vitest'

import { secureSpaceCookie } from './auth.functions'

describe('secureSpaceCookie', () => {
  it('marks the cookie Secure when the request arrived over HTTPS', () => {
    expect(secureSpaceCookie('https')).toBe(true)
  })

  it('does not mark it Secure over plain HTTP', () => {
    // The bug in one line: a browser refuses to *store* a Secure cookie that
    // arrives over plain HTTP on a non-secure origin, so this branch decides
    // whether the household preference exists at all.
    expect(secureSpaceCookie('http')).toBe(false)
  })

  it('treats anything it does not recognise as plain HTTP', () => {
    // Fail towards the cookie being stored. The cost of guessing wrong here is
    // asymmetric: marking a cookie Secure that should not be loses the
    // preference silently, while omitting it on a real HTTPS origin only means
    // the cookie could in principle travel in the clear on a connection that is
    // already encrypted.
    expect(secureSpaceCookie('')).toBe(false)
    expect(secureSpaceCookie('HTTPS')).toBe(false)
    expect(secureSpaceCookie('ws')).toBe(false)
  })
})
