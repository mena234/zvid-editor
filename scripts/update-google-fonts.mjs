import { writeFile } from 'node:fs/promises'

// Bundle names only: opening the picker must not depend on a Google API key,
// a live catalog request, or downloading thousands of font files.
const source = 'https://fonts.google.com/metadata/fonts'
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
if (!response.ok) throw new Error(`Google Fonts catalog returned ${response.status}`)
const metadata = JSON.parse((await response.text()).replace(/^\)\]\}'\s*/, ''))
const entries = metadata.familyMetadataList
if (!Array.isArray(entries) || entries.length < 1000) {
  throw new Error('Google Fonts returned an incomplete catalog; keeping the existing file')
}
const families = entries.map((entry) => entry.family)
if (families.some((name) => typeof name !== 'string' || !name.trim() || name !== name.trim())) {
  throw new Error('Google Fonts returned an invalid family name')
}
const uniqueFamilies = [...new Set(families)].sort((a, b) => a.localeCompare(b, 'en'))
const catalog = {
  source,
  updatedAt: new Date().toISOString().slice(0, 10),
  families: uniqueFamilies,
}
await writeFile(new URL('../data/google-fonts.json', import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`Updated ${uniqueFamilies.length} Google font families`)
