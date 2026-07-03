/** Automation handoff snippets generated from the current project (M11). */

export function nodeSnippet(projectJson: string, name: string): string {
  return `import zvid from 'zvid'

const project = ${indent(projectJson, 0)}

const result = await zvid(project, './output', (progress) => {
  console.log(\`Rendering: \${progress}%\`)
})

console.log('Video created:', result.localPath)
`
}

export function cliSnippet(name: string): string {
  return `# 1. Save the exported JSON next to your terminal session
#    (e.g. ${name}.json)

# 2. Render it — output lands in ./dist
npx zvid render ${name}.json --out ./dist
`
}

export function fetchSnippet(projectJson: string): string {
  return `// POST the project JSON to your render service
const res = await fetch('https://YOUR-RENDER-API/render', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${indent(projectJson, 2).trimStart()}),
})

const { videoUrl } = await res.json()
console.log('Rendered video:', videoUrl)
`
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((l, i) => (i === 0 ? l : pad + l))
    .join('\n')
}
