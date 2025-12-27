import { defineConfig } from 'vite';

export default defineConfig({
  // Set base to './' so assets use relative paths
  base: './', 
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});