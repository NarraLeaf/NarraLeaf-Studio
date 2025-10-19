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
const { WebSocketServer } = require('ws');
const { watchBuild } = require('../build/watch');

const styleIn = path.join(rootDir, 'src', 'renderer', 'styles', 'styles.css');
const styleOut = path.join(distWindows, 'styles.css');

// Ensure dist directory exists
fs.mkdirSync(distWindows, { recursive: true });

// Initialize WebSocketServer
const wss = new WebSocketServer({ port: 5588 });
function broadcastReload() {
    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send('reload');
    });
}

(async () => {
    const distDir = distRoot;

    /** Restart electron process */
    let electronProcess = null;
    let appStarted = false; // whether Electron has been started at least once
    let initialMainBuilt = false;
    let initialStylesBuilt = false;
    let initialRenderersBuilt = false;

    function tryStartElectronOnce() {
        if (!appStarted && initialMainBuilt && initialStylesBuilt && initialRenderersBuilt) {
            appStarted = true;
            console.log('[dev] all initial builds completed. starting electron...');
            restartElectron();
        }
    }
    function restartElectron() {
        if (electronProcess) {
            electronProcess.kill('SIGTERM');
        }
        const electronBinary = require('electron');
        const mainEntry = path.join(distDir, 'main', 'index.js');
        electronProcess = spawn(electronBinary, [mainEntry, '--dev'], {
            stdio: 'inherit',
        });
    }

    // Build & watch main process
    const mainEntry = path.join(rootDir, 'src', 'main', 'index.ts');
    const mainCtx = await watchBuild({
        entryPoints: [mainEntry],
        outfile: path.join(distDir, 'main', 'index.js'),
        platform: 'node',
        bundle: true,
        format: 'cjs',
        external: ['electron'],
        sourcemap: true,
        target: ['node18'],
    }, () => {
        // Mark initial main build done; subsequent builds restart Electron
        if (!initialMainBuilt) {
            initialMainBuilt = true;
            console.log('[main] initial build complete.');
            tryStartElectronOnce();
        } else {
            console.log('[main] rebuilt. restarting electron...');
            if (appStarted) restartElectron();
        }
    });

    // Do not start Electron here; we start only after renderer + styles are also ready

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
        const entryFile = path.join(rootDir, 'src', 'renderer', 'apps', appName, 'index.tsx');
        const outDir = path.join(distWindows, appName);
        fs.mkdirSync(outDir, { recursive: true });
        const outfile = path.join(outDir, 'index.js');

        const ctx = await watchBuild({
            entryPoints: [entryFile],
            outfile,
            platform: 'browser',
            bundle: true,
            format: 'iife',
            sourcemap: true,
            jsx: 'automatic',
            target: ['chrome114'],
            loader: { '.css': 'css' },
            plugins: [require('esbuild-postcss')()],
        }, () => {
            // Only broadcast reloads after the app has started
            if (appStarted) {
                console.log(`[renderer:${appName}] rebuilt. broadcasting reload...`);
                broadcastReload();
            }
        });

        console.log(`[renderer:${appName}] initial build complete.`);

        // write html
        const html = await renderHtml(appName);
        fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
    }));

    // Mark all renderers as built after HTML written
    initialRenderersBuilt = true;
    tryStartElectronOnce();

    await watchBuild({
        entryPoints: [styleIn],
        outfile: styleOut,
        bundle: true,
        loader: { '.css': 'css' },
        plugins: [require('esbuild-postcss')({
            plugins: [require('tailwindcss'), require('autoprefixer')],
        })],
    }, () => {
        if (!initialStylesBuilt) {
            initialStylesBuilt = true;
            console.log('[styles] initial build complete.');
            tryStartElectronOnce();
        } else {
            console.log('[styles] rebuilt. broadcasting reload...');
            if (appStarted) broadcastReload();
        }
    });
})();
