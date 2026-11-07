// Use the renderer's real capture HTML as the independent layout reference.
const path = require('node:path')
const { createRequire } = require('node:module')
const fromPackage = createRequire(path.resolve(__dirname, '../../../package/package.json'))
fromPackage('ts-node').register({
  project: path.resolve(__dirname, '../../../package/tsconfig.json'),
  transpileOnly: true,
})
module.exports = {
  buildHtmlContent: fromPackage('./src/lib/texts/buildHtmlContent').default,
  fitTextToBox: fromPackage('./src/lib/texts/fitTextToBox').default,
  buildSvgHtmlContent: fromPackage('./src/lib/svgs/buildHtmlContent').default,
}
