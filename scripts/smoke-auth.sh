#!/bin/sh
# End-to-end auth smoke test against a running server.
#
# Exercises the real Better Auth endpoints over HTTP: request an OTP, read the
# code out of Mailpit, sign in, and confirm the session cookie actually
# authenticates. This is the flow the plan calls the single most common
# TanStack Start auth bug, so it is worth testing for real rather than mocking.
set -e

BASE=${BASE:-http://127.0.0.1:$(cat /tmp/opencode/swl/port)}
MAILPIT=${MAILPIT:-http://127.0.0.1:8025}
EMAIL=${EMAIL:-demo@tab.local}
JAR=$(mktemp)
OUT=$(mktemp -d)

pass() { echo "  PASS  $1"; }
fail() {
  echo "  FAIL  $1"
  [ -n "$2" ] && echo "        $2"
  FAILED=1
}
FAILED=0

echo "base=$BASE email=$EMAIL"

# ── 1. the server is up ─────────────────────────────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/ping")
[ "$code" = "200" ] && pass "GET /ping → 200" || fail "GET /ping → $code"

# ── 2. an unauthenticated request to a protected screen lands on login ───
# Note: the first hop normalises the route's validated search params, so this
# follows redirects and asserts on where it ENDS UP, not on the 307 itself.
final=$(curl -s -L -o "$OUT/unauth.html" -w '%{url_effective}' "$BASE/dashboard")
if echo "$final" | grep -q '/login'; then
  pass "unauthenticated /dashboard lands on $final"
else
  fail "unauthenticated /dashboard landed on $final (expected /login)"
fi

if grep -q 'Enter your code\|No password' "$OUT/unauth.html"; then
  pass "login form rendered server-side"
else
  fail "login form not found in the unauthenticated response"
fi

# ── 3. request an OTP ───────────────────────────────────────────────────
curl -s -X POST "$BASE/api/auth/email-otp/send-verification-otp" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"type\":\"sign-in\"}" > "$OUT/otp.json"

if grep -q '"success":true' "$OUT/otp.json"; then
  pass "send-verification-otp accepted"
else
  fail "send-verification-otp" "$(cat "$OUT/otp.json")"
fi

# ── 4. read the code from Mailpit ───────────────────────────────────────
# Poll: delivery is deliberately not awaited by the auth hook.
i=0
CODE=""
while [ $i -lt 20 ]; do
  CODE=$(curl -s "$MAILPIT/api/v1/messages?limit=10" \
    | tr -d '\n' \
    | grep -oE '[0-9]{6}' \
    | head -1)
  [ -n "$CODE" ] && break
  i=$((i + 1))
  sleep 0.5
done

if [ -n "$CODE" ]; then
  pass "OTP delivered via Mailpit: $CODE"
else
  fail "no OTP arrived in Mailpit within 10s"
  echo "cannot continue without a code"
  exit 1
fi

# ── 5. a wrong code must be rejected ────────────────────────────────────
status=$(curl -s -o "$OUT/wrong.json" -w '%{http_code}' \
  -X POST "$BASE/api/auth/sign-in/email-otp" \
  -H 'Content-Type: application/json' \
  -c "$JAR" \
  -d "{\"email\":\"$EMAIL\",\"otp\":\"000000\"}")

if [ "$status" = "401" ] || [ "$status" = "400" ] || [ "$status" = "403" ]; then
  pass "wrong OTP rejected ($status)"
else
  fail "wrong OTP returned $status" "$(cat "$OUT/wrong.json")"
fi

# ── 6. the real code signs in and sets a session cookie ─────────────────
status=$(curl -s -o "$OUT/ok.json" -w '%{http_code}' \
  -X POST "$BASE/api/auth/sign-in/email-otp" \
  -H 'Content-Type: application/json' \
  -c "$JAR" \
  -d "{\"email\":\"$EMAIL\",\"otp\":\"$CODE\"}")

if [ "$status" = "200" ]; then
  pass "correct OTP accepted (200)"
else
  fail "correct OTP returned $status" "$(cat "$OUT/ok.json")"
fi

# The critical assertion: tanstackStartCookies() must have persisted the
# session. A successful sign-in with no cookie is the exact silent failure the
# plan warns about.
if grep -qE 'better-auth|better_auth' "$JAR"; then
  pass "session cookie set"
else
  fail "no session cookie in jar" "$(cat "$JAR")"
fi

# ── 7. the session resolves ─────────────────────────────────────────────
body=$(curl -s -b "$JAR" "$BASE/api/auth/get-session")
if echo "$body" | grep -q '"user"'; then
  pass "get-session returns the user"
  echo "$body" | head -c 200
  echo
else
  fail "get-session did not return a user" "$body"
fi

# ── 8. the session survives a fresh request and the page SSRs fully ─────
# This is the assertion that catches the blank-first-paint failure: the route
# loader must warm the query cache so the server response contains the real
# dashboard markup, not an empty shell waiting for hydration.
final=$(curl -s -L -b "$JAR" -o "$OUT/dash.html" -w '%{url_effective}' "$BASE/dashboard")
if echo "$final" | grep -q '/login'; then
  fail "authenticated /dashboard bounced to login: $final"
else
  pass "authenticated /dashboard stays on $final"
fi

for needle in 'Total spend' 'Your share' 'Recent entries' 'By category'; do
  if grep -q "$needle" "$OUT/dash.html"; then
    pass "dashboard SSRs '$needle'"
  else
    fail "dashboard HTML is missing '$needle' (blank first paint?)"
  fi
done

# The seeded space name proves the data came from Postgres, not from a fixture.
if grep -q 'Hauptstraße' "$OUT/dash.html"; then
  pass "dashboard shows the seeded space from the database"
else
  fail "seeded space name not found in the SSR output"
fi

# ── 9. the OTP is not stored in plaintext ───────────────────────────────
# storeOTP: 'hashed' means a DB dump must not contain the live code.
CODE_ESCAPED=$(printf '%s' "$CODE" | sed 's/./\\&/g')
psql_out=$(docker exec swl-db psql -U app -d app -tAc \
  "select count(*) from verification where value like '%${CODE}%'" 2>/dev/null || echo "skip")
if [ "$psql_out" = "skip" ] || [ -z "$psql_out" ]; then
  echo "  SKIP  plaintext OTP check (no database access from here)"
elif [ "$psql_out" = "0" ]; then
  pass "live OTP not present in the verification table (hashed)"
else
  fail "live OTP found in the verification table"
fi

rm -rf "$JAR" "$OUT"
echo
[ "$FAILED" = "0" ] && echo "ALL AUTH SMOKE TESTS PASSED" || echo "SOME AUTH TESTS FAILED"
exit "$FAILED"
