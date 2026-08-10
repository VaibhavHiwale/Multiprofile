import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const here = path.dirname(fileURLToPath(import.meta.url));

// Migrations are read on the Node side (tests run inside workerd, which has no
// filesystem) and handed to the test worker as a binding. test/setup.js then
// applies them to the per-test isolated D1 database via applyD1Migrations.
const migrations = await readD1Migrations(path.join(here, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.js'],
    // Cinemeta is stubbed per-test with vi.stubGlobal('fetch', ...); restore
    // the real global automatically so stubs can't leak between tests.
    unstubGlobals: true,
    // satori and qrcode are CJS with deep relative requires that workerd's
    // module resolver can't follow. Cloudflare's documented fix is to let Vite
    // pre-bundle them into ESM first:
    // https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
    //
    // Listing `satori` alone isn't enough: Vite's SSR optimizer doesn't
    // recursively pre-bundle every transitive CJS dependency into the same
    // chunk — satori's line-breaking dependency (`linebreak`) and *its*
    // dependency (`unicode-trie`, which does `require('./swap')` with no
    // extension) both need to be listed explicitly, or workerd's loader hits
    // them unbundled and fails with "No such module ... unicode-trie/swap".
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          // satori's own dependency tree (see `npm ls satori --all` / its
          // package.json `dependencies`) is CJS packages several layers deep;
          // each one that does an extension-less relative `require()` needs to
          // be listed here individually, or workerd's loader fails on it the
          // moment test execution reaches that code path.
          include: [
            'satori',
            '@cf-wasm/satori',
            'linebreak',
            'unicode-trie',
            'postcss-value-parser',
            'css-to-react-native',
            'css-background-parser',
            'css-box-shadow',
            'css-gradient-parser',
            'parse-css-color',
            'escape-html',
            'emoji-regex-xs',
            '@shuding/opentype.js',
            'yoga-layout',
            // src/lib/qrcode.js imports this exact deep subpath (bypassing
            // qrcode's top-level entry, which pulls in node:fs/node:stream and
            // a canvas renderer) — Vite's optimizer needs the specifier that's
            // actually imported, not just the bare package name, to know to
            // pre-bundle it.
            'qrcode/lib/core/qrcode.js',
          ],
        },
      },
    },
  },
});
