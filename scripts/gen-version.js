import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Stamps one build id into two generated (gitignored) files so a running
 * tab can tell whether the server has redeployed since it loaded — see
 * VersionCheckService. Mirrors tuning-tools/webapp/scripts/gen-version.js
 * (the hextune app) so both apps in the product line detect updates the
 * same way; kept in sync deliberately, not just by convention.
 */
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const buildId = new Date().toISOString();

writeFileSync(
  join(rootDir, 'src/app/core/version.generated.ts'),
  `export const BUILD_ID = ${JSON.stringify(buildId)};\n`
);
writeFileSync(
  join(rootDir, 'public/version.json'),
  JSON.stringify({ buildId }) + '\n'
);
