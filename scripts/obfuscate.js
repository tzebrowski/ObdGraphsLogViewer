import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { LICENSE_BANNER, OBFUSCATOR_OPTIONS } from './obfuscator-config.js';

/**
 * Runs automatically after `npm run build` (npm's postbuild convention) --
 * obfuscates the production JS bundle so a downloaded copy is harder to read
 * than plain esbuild minification alone, while re-attaching the license
 * banner esbuild would otherwise strip. Skips itself on a development build
 * (identified by the presence of .map files) since obfuscating unminified
 * dev output would be slow and pointless, and would leave the emitted
 * sourcemaps pointing at the wrong code. Mirrors
 * tuning-tools/webapp/scripts/obfuscate.js (the hextune app); this app has
 * no gated/paywalled chunks, so there's no gate-chunks.js counterpart.
 */
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, 'dist');

function main() {
  if (!existsSync(distDir)) {
    console.log(`[obfuscate] no build output at ${distDir}, skipping`);
    return;
  }

  const files = readdirSync(distDir);
  if (files.some((f) => f.endsWith('.map'))) {
    console.log('[obfuscate] sourcemaps present (development build), skipping');
    return;
  }

  const jsFiles = files.filter((f) => f.endsWith('.js'));
  if (!jsFiles.length) {
    console.log(`[obfuscate] no .js files found in ${distDir}, skipping`);
    return;
  }

  for (const file of jsFiles) {
    const filePath = join(distDir, file);
    const code = readFileSync(filePath, 'utf8');
    const obfuscated = JavaScriptObfuscator.obfuscate(
      code,
      OBFUSCATOR_OPTIONS
    ).getObfuscatedCode();
    writeFileSync(filePath, LICENSE_BANNER + obfuscated, 'utf8');
    console.log(`[obfuscate] ${file}`);
  }
  console.log(`[obfuscate] done: ${jsFiles.length} file(s)`);
}

main();
