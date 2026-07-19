import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        environment: 'node',
        maxWorkers: 4,
        testTimeout: 30_000,
        globals: true,
        include: ['../tests/**/*.test.ts'],
        // The live regression suite needs a running server; it has its own
        // config (vitest.live.config.ts) and is excluded from `npm test`.
        exclude: ['../tests/live/**'],
        server: {
            deps: {
                // react/react-dom are CJS with an exports map; keep them external
                // so their internal relative requires resolve inside the package.
                external: [/\breact\b/, /react-dom/],
            },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname),
        },
    },
})
