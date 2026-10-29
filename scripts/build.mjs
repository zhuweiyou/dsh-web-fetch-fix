// Build `web-fetch-http/src/*.ts` -> `web-fetch-http/lib/index.js` with esbuild.
//
// `web-fetch-http/` is a verbatim copy of the official package source
// (packages/web/web-fetch-http @ dsh-v0.2.1-rc.3) with the public-IP (SSRF)
// gate removed in src/network.ts. DSH loads host plugins as ESM JavaScript, so
// the TypeScript sources are compiled here.
//
// Why esbuild:
//  * bundles the four src modules into a single lib/index.js;
//  * downlevels `using d = deadline(...)` (explicit resource management) to
//    helper functions for older Node targets;
//  * strips `import type` / interfaces / parameter properties.
//
// `packages: 'external'` keeps every bare import (@deepseek-ai/*, ipaddr.js,
// undici, node:*) as an external specifier, so DSH's runtime module resolution
// maps them to the copies that ship with the running installation. Nothing
// from the DSH installation is inlined into this bundle.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

await build({
  entryPoints: [resolve(pkgRoot, 'web-fetch-http/src/index.ts')],
  outfile: resolve(pkgRoot, 'web-fetch-http/lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18', // downlevel `using`; runtime here is Node 24, so helpers run fine
  packages: 'external',
  legalComments: 'none',
  logLevel: 'info',
  // The copied package's tsconfig extends a monorepo root that is not present
  // here; skip it and use esbuild's defaults for .ts (types are stripped anyway).
  tsconfigRaw: { compilerOptions: {} },
})

console.log('build OK -> web-fetch-http/lib/index.js')
