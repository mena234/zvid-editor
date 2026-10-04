# Live dashboard and editor E2E tests

These Playwright tests exercise the deployed customer dashboard at <https://app.zvid.io> and visual editor at <https://editor.zvid.io>, backed by the real API at <https://api.zvid.io>. They use customer UI actions, real uploads, saved projects and actual renders. They do not start local services, seed database users, mock application responses or inject editor test hooks.

The suite is implemented coverage, not a claim that the current deployment passes. Authentication, dashboard rendering, persistence, output and cleanup failures fail the run; they are not replaced with best-effort API assertions.

Tests favor customer-visible locators, isolated browser contexts and retrying assertions, following [Playwright's best practices](https://playwright.dev/docs/best-practices). Major phases appear as named steps in the report.

## Setup

Run commands from the `editor/` repository. Install its dependencies and the Chromium browser:

```powershell
npm ci
npx playwright install chromium
```

Have `ffprobe` on `PATH` before running the live suite. It validates the downloaded video. Use a Node.js runtime that supports `process.loadEnvFile` and `import.meta.dirname`.

Use one dedicated, email-verified, fully onboarded **non-admin customer account**. It needs sufficient credits, available project/template/API-key capacity and no unfinished render jobs. Do not use the account concurrently in another run. The suite does not automatically register users, verify email, complete onboarding, buy credits or change subscriptions.

Create the private configuration only if it does not already exist:

```powershell
if (!(Test-Path -LiteralPath .env.live)) {
  Copy-Item -LiteralPath .env.live.example -Destination .env.live
}
```

Set `LIVE_E2E_EMAIL` and `LIVE_E2E_PASSWORD` in `.env.live` locally. The runner automatically loads this dedicated file; it does not read application or orch credential files. `.env.live`, its variants and run artifacts are ignored by Git. Never commit real credentials or paste them into commands, logs or reports. CI can supply the same variables through its secret environment.

| Setting | Default / behavior |
| --- | --- |
| `LIVE_E2E_EMAIL`, `LIVE_E2E_PASSWORD` | Required existing test-account credentials. |
| `LIVE_E2E_CREDIT_LIMIT` | `20`; may be reduced to an integer from 1–20, never increased above 20. |
| `LIVE_E2E_RENDER_TIMEOUT_SECONDS` | `480`; maximum 900 seconds. |
| `LIVE_E2E_DASHBOARD_URL` | `https://app.zvid.io` |
| `LIVE_E2E_EDITOR_URL` | `https://editor.zvid.io` |
| `LIVE_E2E_API_URL` | `https://api.zvid.io`, without `/api`. |
| `LIVE_E2E_TEMPLATE_FILE` | `tests/live-e2e/fixtures/video-template.json`, relative to `editor/`. |
| `LIVE_E2E_ENV_FILE` | `.env.live`; alternate dedicated configuration path, relative to `editor/`. |

Endpoint overrides must be HTTPS origins without paths, query strings or embedded credentials. Keep the dashboard, editor and API on a deployment whose session cookies work across the three hosts.

## Pin the video template

The checked-in `fixtures/video-template.json` is ready to use. Normal runs verify that pin against the live catalogue. Only when the pin is absent, select and record an eligible published example:

```powershell
npm run test:e2e:live:pin
```

This reads the real example catalogue and content without an account or render submission. It deterministically picks the shortest eligible free video, with a slug tie-breaker, up to Full HD and a 19-credit video allowance. The pin records its slug, title, version, content hash, duration and dimensions.

Normal runs require that pin and check it against the current catalogue. Content or metadata changes stop the run instead of silently selecting another example. The pin command refuses to overwrite an existing file: review an upstream change, deliberately remove the old pin, then run the command again. A lower configured credit cap may make the pinned video ineligible at submission time.

## Run and inspect

```powershell
# Local safety checks; no live account or render.
npm run test:e2e:live:safety

# List discovered tests without running them.
node node_modules/@playwright/test/cli.js test --config=playwright.live.config.ts --list

# All live coverage, headless or with a visible browser.
npm run test:e2e:live
npm run test:e2e:live:headed

# Only the golden video render journey.
npm run test:e2e:live:core
node node_modules/@playwright/test/cli.js test --config=playwright.live.config.ts --grep @core --headed
```

`@core` identifies only the golden render journey. Authentication, API-key and editor authoring tests are included in the full suite, not in the core shortcut. Each command that executes tests starts a separate live run and may spend credits; listing and safety checks do not.

Runs use one Chromium project, one worker and zero retries. Sharding, repeated execution and retry overrides are rejected. Do not launch overlapping runs for the same account. The automatically generated run ID must not be reused to rerun tests.

Reports and evidence are written beneath `tests/live-e2e/.runs/<timestamp-and-id>/`:

- `report/`: Playwright HTML report.
- `results/`: test attachments and output evidence.
- `run-state.json`: persisted exact resource IDs, account ownership, cleanup results and credit reservations.

Open a completed report using its actual run-directory name:

```powershell
npx playwright show-report "tests/live-e2e/.runs/<timestamp-and-id>/report"
```

Raw traces, automatic screenshots and recorded browser videos are disabled. Failure screenshots are selectively masked; credential and API-key scenarios suppress them. Diagnostics are sanitized. **Keep every report, attachment and run manifest private.** They can include account-related records, output media and media links even after redaction. An interrupted process can also leave diagnostic files before final redaction runs.

## Coverage and credit limits

| Area | Assertions |
| --- | --- |
| Authentication | Protected deep-link redirect, rejected credentials, valid UI login, refresh persistence, shared editor session and logout protection. |
| Dashboard API keys | UI creation, one-time reveal, masked list after reload, deletion cancellation, revocation, and real read-only API authentication before/after revocation. |
| Project authoring | Text editing, save/update, JSON export/download, reload and dashboard-to-editor reopening. |
| Media and timeline | Real image/video/audio uploads, inspector edits, clip trim, undo/redo, invalid import feedback and JSON import/export round trip. |
| Reusable templates | Save an image template, reopen it from the dashboard and archive it. |
| Golden video journey | Customize the pinned free video example, save and render it, verify completion/output and reconcile visible dashboard credits with the API. |
| Image rendering | Upload a small image, compose a still image, render PNG output and verify the one-credit charge. |

The hard run cap is **20 credits**, with at most **one video submission and one image submission**. The video must leave room for the image's one credit. Estimates and payload proofs are checked before submission, and the reservation is persisted before the UI can enqueue work. Reservations remain counted even after failures or refunds. Unknown submission/charge outcomes stop further rendering instead of retrying or assuming zero cost.

Before requesting a quote, the suite exports the authoring document and verifies its normalized render payload, including fixed duration and supported dimensions. Unsupported dynamic or media-derived timing fails before submission. A passive observer then compares the actual outgoing Socket.IO payload with that approved payload. This comparison happens **after the message is sent**: drift fails the test and stops further submissions, but cannot retract the first message or prevent its service-side charge. The reservation cap therefore depends on the deployed editor sending the verified payload; any mismatch requires inspection of the recorded job and account.

The cap governs submissions made by this suite, not unrelated activity on the account or manual renders. Bulk renders, purchases, real email delivery, admin tools and external automation integrations are outside this suite.

## Cleanup and interrupted runs

Each test attempts cleanup of resources it created. Cleanup verifies the configured account, the exact recorded ID and the exact run-prefixed name before deleting; it does not sweep an account by name prefix. Renamed resources stay tied to their original IDs. Already removed or archived resources are recorded accordingly. Unfinished or uninspectable jobs and cleanup failures require attention and remain documented in the manifest.

If a browser/process interruption leaves resources behind, keep the run directory and use the same account for explicit cleanup:

```powershell
$env:LIVE_E2E_CLEANUP_RUN_DIR = 'tests/live-e2e/.runs/<timestamp-and-id>'
npm run test:e2e:live:cleanup
Remove-Item Env:LIVE_E2E_CLEANUP_RUN_DIR
```

The cleanup path is relative to `editor/` and must identify the original directory under `tests/live-e2e/.runs/`. Cleanup uses its existing `run-state.json`; it does not start another render or reset the old run's credit accounting. Review any unresolved job or ownership mismatch before removing its manifest. A fresh test execution must use a new run ID.

Cleanup also retains terminal jobs while their final charge is unknown. Reconcile the exact job and its transactions before settling that reservation; a lost job acknowledgement requires manual account inspection. Neither case is treated as a zero-cost submission.

## Validation record — 3 October 2026

The 43 local budget, cleanup, payload and report-redaction checks pass. All seven customer journeys have passed individually against the live services. The pinned video produced a decoded H.264 MP4 at 1080×1920, 3.000 seconds; the image journey produced a decoded 640×360 PNG. Their charges were three and one credit, respectively.

**Full acceptance remains incomplete:** a completely successful headed run and a completely successful headless run have not been recorded. Chromium intermittently reports `net::ERR_CONNECTION_TIMED_OUT` when fetching uploaded media or rendered output from `cdn.zvid.io`. These failures remain failures; tests do not retry renders or bypass media delivery. Media downloads/PNG loading have a 45-second network deadline.

Local private evidence:

| Evidence | Result | Report |
| --- | --- | --- |
| Latest full headed run | 5 passed, 2 failed; 3 credits | [HTML report](.runs/2026-10-03T16-46-33-625Z-1dac57d0/report/index.html) |
| Latest full headless run | 4 passed, 3 failed; 3 credits | [HTML report](.runs/2026-10-03T16-51-54-980Z-dc8d2eaf/report/index.html) |
| Successful video journey within a headless run | Video passed, with output and credit evidence; whole run 6/7 | [HTML report](.runs/2026-10-03T16-43-46-179Z-1129238f/report/index.html) |
| Focused headed PNG journey | 1 passed; 1 credit | [HTML report](.runs/2026-10-03T16-50-40-070Z-83dceb7a/report/index.html) |

Development and interrupted-run recovery consumed 17 credits in total; no individual run spent more than four. Every recorded reservation is settled and all recorded jobs, projects, uploads, templates and keys are cleaned. No tests were skipped. Scanning the generated HTML data and text attachments found no configured credentials or revealed API keys.

Targeted strict TypeScript checking reports six existing errors in `shared/schema/normalize.ts` (lines 132–142), with no errors in the added live-suite files. Existing product changes and other test suites were preserved.
