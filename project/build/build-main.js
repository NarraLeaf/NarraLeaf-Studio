const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const { rootDir, isDev } = require('./utils');

(async () => {
    console.log(`[build-main] Mode: ${isDev() ? 'development' : 'production'}`);

    const entry = path.join(rootDir, 'src', 'main', 'index.ts');
    if (!fs.existsSync(entry)) {
        console.error('[build-main] Entry "src/main/index.ts" not found.');
        process.exit(1);
    }

    const outDir = path.join(rootDir, 'dist', 'main');
    fs.mkdirSync(outDir, { recursive: true });

    await esbuild.build({
        entryPoints: [entry],
        outfile: path.join(outDir, 'index.js'),
        platform: 'node', // Electron main runs in Node context
        format: 'cjs',
        bundle: true,
        external: ['electron', 'esbuild'], // keep native modules external
        sourcemap: isDev(),
        minify: !isDev(),
        target: ['node18'],
        tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
    });

    console.log('[build-main] Main process built successfully.');
})();
