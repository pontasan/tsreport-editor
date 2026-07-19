import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Configuration for `npm run test:live`: runs ONLY the live regression suite
// (tests/live/) against the RUNNING tsreport-editor server (Docker dev
// environment with its seeded initial data). The normal `npm test` run uses
// vitest.config.ts, which excludes tests/live/.
export default defineConfig({
    test: {
        environment: 'node',
        maxWorkers: 4,
        fileParallelism: false,
        globals: true,
        include: ['../tests/live/**/*.test.ts'],
        testTimeout: 60000,
        hookTimeout: 30000,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname),
        },
    },
})
