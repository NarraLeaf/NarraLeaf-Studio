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

    const preloadEntry = path.join(rootDir, 'src', 'main', 'preload', 'preload.ts');
    if (!fs.existsSync(preloadEntry)) {
        console.warn('[build-main] Preload entry "src/main/preload/preload.ts" not found. Skipping preload build.');
    } else {
        console.log('[build-main] Bundling preload script…');
        await esbuild.build({
            entryPoints: [preloadEntry],
            outfile: path.join(outDir, 'preload.js'),
            platform: 'node',
            format: 'cjs',
            bundle: true,
            external: ['electron', 'esbuild'],
            sourcemap: isDev(),
            minify: !isDev(),
            target: ['node18'],
            tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
        });
    }

    console.log('[build-main] Main process built successfully.');
})();
