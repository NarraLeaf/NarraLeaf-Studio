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
const { postcssPlugin } = require('../build/postCss-plugin');

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
    let initialPreloadBuilt = false;
    let restartTimer = null; // Timer for debouncing restarts

    function tryStartElectronOnce() {
        if (!appStarted && initialMainBuilt && initialStylesBuilt && initialRenderersBuilt && initialPreloadBuilt) {
            appStarted = true;
            console.log('[dev] all initial builds completed. starting electron...');
            restartElectron();
        }
    }

    function restartElectron() {
        // Clear any existing restart timer
        if (restartTimer) {
            clearTimeout(restartTimer);
        }

        // Debounce restarts by 300ms to avoid rapid successive restarts
        restartTimer = setTimeout(() => {
            if (electronProcess) {
                console.log('[dev] killing existing electron process...');
                electronProcess.kill('SIGTERM');
                // Give it a moment to fully shut down
                setTimeout(() => {
                    startElectron();
                }, 100);
            } else {
                startElectron();
            }
        }, 300);
    }

    function startElectron() {
        const electronBinary = require('electron');
        const mainEntry = path.join(distDir, 'main', 'index.js');
        console.log('[dev] starting electron process...');
        electronProcess = spawn(electronBinary, [mainEntry, '--dev'], {
            stdio: 'inherit',
        });

        // Handle process events
        electronProcess.on('error', (err) => {
            console.error('[dev] electron process error:', err);
        });

        electronProcess.on('exit', (code, signal) => {
            if (signal === 'SIGTERM') {
                console.log('[dev] electron process terminated by dev server');
            } else {
                console.log(`[dev] electron process exited with code ${code}`);
            }
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

    // Fallback watcher: ensure rebuild when any file in src/main changes
    // Note: The esbuild watcher should handle most changes, this is just a fallback
    const mainWatcher = chokidar.watch(path.join(rootDir, 'src', 'main'), {
        ignored: /(^|[\/\\])\../,
        ignoreInitial: true,
    });

    mainWatcher.on('all', async () => {
        console.log('[main] chokidar detected changes, rebuilding...');
        // Don't restart electron here, let the esbuild watcher handle it
        // to avoid duplicate restarts
    });

    /** Build & watch preload script */
    const preloadEntry = path.join(rootDir, 'src', 'main', 'preload', 'preload.ts');
    if (fs.existsSync(preloadEntry)) {
        await watchBuild({
            entryPoints: [preloadEntry],
            outfile: path.join(distDir, 'main', 'preload.js'),
            platform: 'node',
            format: 'cjs',
            bundle: true,
            external: ['electron'],
            sourcemap: true,
            target: ['node18'],
        }, () => {
            if (!initialPreloadBuilt) {
                initialPreloadBuilt = true;
                console.log('[preload] initial build complete.');
                tryStartElectronOnce();
            } else {
                console.log('[preload] rebuilt. restarting electron...');
                if (appStarted) restartElectron();
            }
        });
    } else {
        console.warn('[preload] Entry "src/main/preload/preload.ts" not found. Skipping preload build.');
        initialPreloadBuilt = true;
        tryStartElectronOnce();
    }

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
            plugins: [postcssPlugin()],
        }, () => {
            // Only broadcast reloads after the app has started
            console.log(`[renderer:${appName}] rebuilt.`);
            if (appStarted) {
                console.log(`[renderer:${appName}] broadcasting reload...`);
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

    if (!initialStylesBuilt) {
        initialStylesBuilt = true;
        console.log('[styles] initial build complete.');
        tryStartElectronOnce();
    } else {
        console.log('[styles] rebuilt. broadcasting reload...');
        if (appStarted) broadcastReload();
    }
})();
