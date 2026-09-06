// Load the canonical renderer in its own TypeScript configuration. It must not
// be type-checked with Nuxt's browser compiler options or bundled into the app.
const path = require('node:path')
const { createRequire } = require('node:module')
const fromPackage = createRequire(
  path.resolve(__dirname, '../../../package/package.json')
)
fromPackage('ts-node').register({
  project: path.resolve(__dirname, '../../../package/tsconfig.json'),
  transpileOnly: true,
})
module.exports = {
  getStyleFilters: fromPackage('./src/lib/videos/filters/getStyleFilters').default,
  toGraph: fromPackage('./src/utils/complexFiltersToFiltergraph').default,
}
