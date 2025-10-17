const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const esbuild = require('esbuild');
const {
    rootDir,
    distRoot,
    distWindows,
    getRendererApps,
    renderHtml,
} = require('../build/utils');
const chokidar = require('chokidar');

(async () => {
    const distDir = distRoot;

    /** Restart electron process */
    let electronProcess = null;
    function restartElectron() {
        if (electronProcess) {
            electronProcess.kill('SIGTERM');
        }
        const electronBinary = require('electron');
        const mainEntry = path.join(distDir, 'main', 'index.js');
        electronProcess = spawn(electronBinary, [mainEntry], {
            stdio: 'inherit',
        });
    }

    // Build & watch main process
    const mainEntry = path.join(rootDir, 'src', 'main', 'index.ts');
    const mainCtx = await esbuild.context({
        entryPoints: [mainEntry],
        outfile: path.join(distDir, 'main', 'index.js'),
        platform: 'node',
        bundle: true,
        format: 'cjs',
        external: ['electron'],
        sourcemap: true,
        target: ['node18'],
    });

    await mainCtx.watch((error) => {
        if (error) console.error('[main] rebuild failed:', error);
        else {
            console.log('[main] rebuilt. restarting electron...');
            restartElectron();
        }
    });

    console.log('[main] initial build complete.');
    restartElectron();

    // Fallback watcher: ensure rebuild when any file in src/main changes
    const mainWatcher = chokidar.watch(path.join(rootDir, 'src', 'main'), {
        ignored: /(^|[\/\\])\../,
        ignoreInitial: true,
    });

    mainWatcher.on('all', async () => {
        await mainCtx.rebuild();
        console.log('[main] chokidar rebuild. restarting electron...');
        restartElectron();
    });

    // Build & watch renderer apps
    const apps = getRendererApps();

    await Promise.all(apps.map(async (appName) => {
        const entryFile = path.join(rootDir, 'src', 'apps', appName, 'index.tsx');
        const outDir = path.join(distWindows, appName);
        fs.mkdirSync(outDir, { recursive: true });
        const outfile = path.join(outDir, 'index.js');

        const ctx = await esbuild.context({
            entryPoints: [entryFile],
            outfile,
            platform: 'browser',
            bundle: true,
            format: 'iife',
            sourcemap: true,
            jsx: 'automatic',
            target: ['chrome114'],
        });

        ctx.watch((error) => {
            if (error) console.error(`[renderer:${appName}] rebuild failed`, error);
            else {
                console.log(`[renderer:${appName}] rebuilt. restarting electron...`);
                restartElectron();
            }
        });

        console.log(`[renderer:${appName}] initial build complete.`);

        // write html
        const html = await renderHtml(appName);
        fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
    }));
})();
