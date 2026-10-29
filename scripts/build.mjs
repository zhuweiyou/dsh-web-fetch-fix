// Build every patched web package under this repo.
//
// Layout: this repository is ONE DSH bundle (see package.json dsh.bundle + the
// dependency/contract fields). Each patched official package is its own
// `web-*` sub-directory copied verbatim from
// https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web
// with only the intended edit(s) applied:
//
//     web-fetch-http/   (official packages/web/web-fetch-http @ dsh-v0.2.1-rc.3)
//     web-<other>/      (future additions, same pattern)
//
// This script discovers every `web-*/src/index.ts`, bundles it with esbuild to
// `web-*/lib/index.js`, and is wired as the `prepack` hook so `npm pack` /
// `npm publish` always ship fresh builds.
//
// Why esbuild: bundles each package's modules into one ESM file, downlevels
// `using d = deadline(...)`, and strips types. `packages: 'external'` keeps all
// bare imports (@deepseek-ai/*, ipaddr.js, undici, node:*) external so DSH's
// runtime module resolution supplies the copies shipped with the installation;
// nothing from the DSH installation is inlined.
import { build } from 'esbuild'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

async function isFile(p) {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

const dirs = (await readdir(pkgRoot, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && /^web-/.test(d.name))
  .map((d) => d.name)
  .sort()

const built = []
for (const name of dirs) {
  const entry = join(pkgRoot, name, 'src', 'index.ts')
  if (!(await isFile(entry))) continue // a web-* dir without a buildable entry
  const outfile = join(pkgRoot, name, 'lib', 'index.js')
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18', // downlevel `using`; runtime here is Node 24, so helpers run fine
    packages: 'external',
    legalComments: 'none',
    logLevel: 'warning',
    // The copied package's tsconfig extends a monorepo root not present here;
    // use esbuild defaults for .ts (types are stripped anyway).
    tsconfigRaw: { compilerOptions: {} },
  })
  built.push(`${name}/lib/index.js`)
}

if (built.length === 0) {
  console.error('build: no web-*/src/index.ts found under', pkgRoot)
  process.exit(1)
}
console.log(`build OK (${built.length}):\n  ` + built.join('\n  '))
