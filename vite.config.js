import { defineConfig } from 'vite';
import { execSync } from 'child_process';



export default defineConfig({
    define: {
        'import.meta.env.VITE_GIT_TAG': JSON.stringify(execSync('git describe --tags --match "v*" --abbrev=0')
            .toString()
            .trim())
    }
});