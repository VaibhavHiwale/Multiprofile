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
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['satori', '@cf-wasm/satori', 'qrcode'],
        },
      },
    },
  },
});
