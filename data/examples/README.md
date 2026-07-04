# Example projects (test fixtures)

These JSONs are NOT bundled into the editor at runtime. The Examples modal
loads them from the orch content library (`GET /api/library/examples`, proxied
through `server/api/library/`): metadata lives in MySQL, and the content JSON
is served exclusively from Backblaze B2 through the Cloudflare CDN
(`https://cdn.zvid.io/library/examples/...`) — there are no local copies in
orch.

The files remain here as:

- fixtures for `tests/roundtrip.test.ts`
- the historical source of the published content — to change a published
  example, either POST the new content to orch's `/api/admin/library`, or
  regenerate orch's `data/library` seed files from these and re-run
  `node scripts/publish-library.js`
