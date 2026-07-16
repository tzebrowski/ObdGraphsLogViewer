import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        policy: resolve(__dirname, 'policy.html'),
        help_spark: resolve(__dirname, 'help_spark.html'),
      },
    },
  },
  define: {
    'import.meta.env.VITE_GIT_TAG': JSON.stringify(
      execSync('git describe --tags --match "v*" --abbrev=0').toString().trim()
    ),
  },
});
