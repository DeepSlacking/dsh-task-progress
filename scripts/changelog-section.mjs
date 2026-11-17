import { readFileSync } from 'node:fs'

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version
const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/u)
const start = lines.findIndex(line => line.startsWith(`## [${version}]`))
if (start < 0) {
  process.stderr.write(`CHANGELOG.md has no "## [${version}]" section\n`)
  process.exit(1)
}
let end = start + 1
while (end < lines.length && !lines[end].startsWith('## [')) end += 1
const body = lines.slice(start + 1, end).join('\n').trim()
if (body === '') {
  process.stderr.write(`CHANGELOG section for ${version} is empty\n`)
  process.exit(1)
}
process.stdout.write(`${body}\n`)
