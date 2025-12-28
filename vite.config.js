import { defineConfig } from 'vite';
import { execSync } from 'child_process';

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  define: {
    'import.meta.env.VITE_GIT_HASH': JSON.stringify(commitHash)
  }
});