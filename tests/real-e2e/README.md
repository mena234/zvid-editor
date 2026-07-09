# Real-stack E2E suite (`npm run test:real-e2e`)

Drives Zvid's critical browser-to-backend workflows against the **real local
stack** — no mocks. Complements (does not replace) the fast mocked suite in
`tests/e2e/`. Each run of the core workflow **consumes ~2 real credits** on a
freshly registered synthetic account.

## Stack prerequisites (start these first)

| Service | Start | Listens | Notes |
|---|---|---|---|
| MySQL | (already provisioned) | :3306 | orch migrates its schema at boot; remote DB in dev config |
| Redis | `cd k6-tests && docker compose up -d redis` (or any local redis) | :6379 | BullMQ queue + rate limits |
| orch | `cd orch && SMTP_HOST= MAILGUN_API_KEY= MAILGUN_DOMAIN= node server.js` | :4000 | needs `.env.development` (incl. `PADDLE_*` or it exits); health: `/healthz`, `/readyz`. **Blank the email vars** (as shown) so registration uses the Ethereal fallback — see "Email" below |
| zvid-cell | `cd zvid-cell && yarn start` | (worker, no port) | render worker; needs system ffmpeg on PATH. With B2 creds configured (default) the artifact lands on `cdn.zvid.io`; the suite downloads + ffprobes it either way |
| editor (real config) | `cd editor && npm run dev` | :3000 | the dev **defaults** already point at the real orch (`ORCH_URL=http://localhost:4000`); orch's `CORS_ORIGINS` already allows `:3000` |
| dash | `cd zvid-dash && npm run dev` | :3002 | register/login/jobs/credits/API-keys UI. **Unstable SSR — see "Dash caveats"** |
| landing | `cd zvid-landing && npm run dev` | :3003 | pricing/blog/contact |
| fixture server | any `playwright test` run boots it (`webServer`), or `node tests/e2e/helpers/standalone-servers.mjs` | :4598 | deterministic local media (only used by the mocked suite now; the real render is media-free — see below) |

Anything missing → the affected tests **skip with an explicit reason**
naming the service and its start command.

### Email (registration)

orch sends a verification email during register and **fails the register with
HTTP 400 if the send throws** (its Mailgun creds are invalid/rate-limited in
this environment). It only falls back to the Ethereal test transport when
**both** `SMTP_HOST` and `MAILGUN_API_KEY`/`MAILGUN_DOMAIN` are empty — hence
the blanked env vars in the orch start command above. This build also does
**not** return the verification email HTML in the register response, so the
suite reads the token from the `email_verifications` DB table and calls the
public `/auth/verify-email` endpoint (`helpers/db.ts`, using orch's own
`mysql2` + `.env` creds). If the DB is unreachable, users stay unverified and
the dash-onboarding tests skip.

### Deterministic render (no external media)

orch's plan validation **rejects loopback/local media URLs** (`127.0.0.1`,
`localhost`) for both renders and template saves. So the core-workflow render
project is **text on a solid background — no `src` at all** (`tinyProject` in
`helpers/apps.ts`): fully deterministic, no stock providers, and it passes
plan validation. It still produces a real 2 s H.264 MP4.

### Dash caveats (known defect in this build)

Dash **SSR of any authenticated page OOMs the render worker** (and a hard
`goto` of a protected route with an invalid/absent cookie hangs or 500s). The
suite works around it entirely:
- only the **public** `/login` and `/register` are ever hard-loaded (SSR-safe);
- all authenticated pages are reached by **client-side** navigation from the
  hydrated SPA (`dashClientGoto` / `dashReturn`);
- the core workflow's dash-UI steps (job listed, credit balance, logout) are
  **best-effort with a 60 s cap** and are also asserted via the orch API,
  which is the source of truth;
- `retries: 1` on the project recovers transient dash flakes under load. The
  only credit-consuming test (core workflow) provisions a fresh disposable
  account per attempt, so a retry never touches a real balance.

⚠️ The long-lived mocked-editor instance (`:4597`, `ORCH_URL`→mock) is a
different process from the real-config editor on `:3000`. Both can run at
once. The suite verifies the `:3000` instance really proxies the real orch
(a provisioned canary account must authenticate through it) before running.

⚠️ orch's `CORS_ORIGINS` must include the editor origin (`http://localhost:3000`
is in the dev default; `:4597` is not — that's fine, the mocked editor never
talks to the real orch).

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `REAL_ORCH_URL` | `http://localhost:4000` | orch origin |
| `REAL_EDITOR_URL` | `http://localhost:3000` | real-config editor |
| `REAL_DASH_URL` | `http://localhost:3002` | dashboard |
| `REAL_LANDING_URL` | `http://localhost:3003` | landing |
| `REAL_FIXTURE_URL` | `http://127.0.0.1:4598` | fixture media server |
| `REAL_E2E_PASSWORD` | `Str0ng!Pass9` | meets orch's password policy |
| `REAL_RENDER_TIMEOUT` | `480` (s) | job wait ceiling |
| `REAL_POLL_INTERVAL` | `3` (s) | job polling cadence |
| `REAL_SKIP_RENDER` | unset | `1` skips the render-dependent core test |
| `REAL_CLEANUP` | on | `0` keeps created resources for inspection |
| `REAL_ORCH_DIR` | `../orch` | orch dir the DB helper reads `.env.development` + `mysql2` from |
| `REAL_DB_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` | from orch `.env` | override the DB used for email-verification token lookup |

Use `localhost` (not `127.0.0.1`) URLs for orch/editor/dash — the httpOnly
`auth_token` cookie is host-scoped and shared across ports, and the render
socket authenticates via that cookie.

## Accounts & cleanup

- Synthetic users: `pw+<unique>@zvid-test.io` (same convention as `k6-tests`;
  never deleted — uniqueness is the account-cleanup strategy; orch has no
  user-delete API).
- Every other created resource (`pw-e2e-*` projects, templates, uploads,
  API keys, jobs) is deleted at the end of its test (`REAL_CLEANUP=0` to keep).
- Verified accounts are provisioned via orch REST using the dev-only
  verification token embedded in the register response (k6 technique) —
  dash gates unverified accounts behind its verify-email onboarding screen.
- Dev auth rate limit (30/min) is keyed by the `X-Test-User` header in dev;
  the REST helper sends a unique value per call.

## What the suite covers

- `core-workflow.spec.ts` — one self-contained test with reported steps:
  UI registration → dash login → editor with real session → deterministic
  import → fixture upload (auto-annotates if B2 storage is unavailable) →
  cloud save + update → save-as-template → real render over the render
  socket → job lifecycle observation (`waiting → active → completed`) →
  artifact download + ffprobe validation (mp4, 640×360, ~2 s, non-zero) →
  dash renders page → exact 2-credit deduction → logout + expired session.
  Plus separate invalid-session and wrong-password tests.
- `dash.spec.ts` — API key create/reveal/verify/revoke (key genuinely
  authenticates against orch), project/job navigation + editor deep links,
  free-plan subscription states + credit-pack widgets, credits page.
- `landing.spec.ts` — nav login/register handoff, pricing email-gate →
  registration handoff (real precheckout), blog routes, partner contact
  form → real orch `/contact`, legal routes.

## Failure diagnostics

Traces + screenshots are retained on failure (`tests/e2e/.results/`), and
every failed test attaches collected **console errors** and **failed/5xx
network requests**. The rendered artifact is attached to the report on the
core test (pass or fail once downloaded).

Known dev-config quirk (surfaced by this suite's recon): the landing app's
dash links point at `localhost:3001` while dash actually serves on `:3002` —
the handoff tests assert the `/register`/`/login` path rather than the host.
