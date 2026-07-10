# Example projects

The example-project library is **CDN-canonical** — the project JSON for every
example lives only in Backblaze B2 and is served through the Cloudflare CDN
(`https://cdn.zvid.io/library/examples/...`). Metadata (title, description,
`sortOrder`, `meta`) lives in the `library_items` table in MySQL, whose
`storage_key` points at the B2 object. **There are no example JSON files in
this repo.**

## Working with examples

- **Load them at runtime:** the editor's Examples modal reads
  `GET /api/library/examples` (proxied through `server/api/library/`); metadata
  comes from MySQL and content from the CDN.
- **Add or edit an example's content:** publish it through the editor's admin
  flow / `POST /api/admin/library` (which uploads the project JSON to B2 and
  upserts the row). Do not re-introduce local JSON fixtures.
- **Refresh preview media** (e.g. after an animation/transition/zoom change):
  `node scripts/publish-examples.js` in `orch/` — it loads every published
  example from the DB, fetches its JSON from the CDN, re-renders the 540p
  preview + thumbnail, uploads them to B2, and re-publishes the row.

## Tests

`editor/tests/roundtrip.test.ts` exercises the import/export round-trip over a
small set of **inline** representative fixtures (multi-scene video, iterate /
condition / variables, and a still image). The full library is validated at
publish time, not from repo fixtures.
