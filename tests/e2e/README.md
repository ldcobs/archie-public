# Archie — Playwright acceptance tests (TEST_SPEC §1, §2, §4)

Drives the real dashboard UI in a browser. **Isolated from the dashboard source**
— this folder only consumes the running app over HTTP, never edits it.

## When to run these

Run after the **user-management + xray-restart fix lands**. The §2.5/§2.6 tests
are the regression guard: they assert a single disable/enable fires **exactly
one** API call (not a restart loop). They go red→green as the fix lands and
stay green thereafter.

## Prerequisites

1. A running dashboard dev server (don't start it while someone is editing):
   ```bash
   cd dashboard && npm run dev    # serves on :4321
   ```
2. The dashboard must be past first-run setup (an owner account exists).
3. Seed at least one active key so the §2 tests have something to click.

## Install (one-time, isolated under e2e/node_modules)

```bash
cd tests/e2e
npm install
npx playwright install chromium    # downloads the browser
```

## Run

```bash
# All tests
npm test

# Headed (watch the browser)
npm run test:headed

# Just the access-keys suite
npm test -- 02-access-keys

# Override credentials / URL via env
AUTH_USERNAME=owner AUTH_PASSWORD=secret \
PLAYWRIGHT_BASE_URL=http://localhost:4321/v3 \
npm test
```

## Report

```bash
npm run report    # opens tests/e2e/playwright-report/index.html
```

On failure you get: screenshot, video, and a full trace (DOM snapshot per step)
viewable in the HTML report — no log-reading required.

## What's tested

| Spec | TEST_SPEC § | What it proves |
|------|-------------|----------------|
| `01-auth` | §1.1–1.4 | Redirect-to-login, wrong-password rejection, login success, logout clears session |
| `02-access-keys` | §2.1–2.8 | List renders, add/copy/delete, **disable=1 call, enable=1 call** |
| `04-traffic` | §4.1–4.2 | Traffic tab renders totals, period filter fires a fetch |

The **bold** assertions in 02 are the restart-loop regression guard — the
whole reason this suite exists.

## Not yet implemented (waiting on prerequisites)

- **§2.5/§2.6 xray-restart count**: the dashboard calls `POST /vpn-api/xray/user/disable`
  which **does not exist yet** in the Python API. When you add that route,
  these tests automatically exercise it. Until then they assert the dashboard's
  own `/api/users/{email}/disable` call count (one per action).
- **§10 theme**: written after the in-flight theme work settles.
