import { existsSync } from 'node:fs';

if (!existsSync('/.dockerenv')) {
    throw new Error('tsreport-editor dependencies must be installed inside Docker.');
}
