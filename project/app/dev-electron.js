const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const esbuild = require('esbuild');
const {
    rootDir,
    distRoot,
    distWindows,
    DEV_RELOAD_PORT,
    getRendererApps,
    renderHtml,
} = require('../build/utils');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');
const { watchBuild } = require('../build/watch');
const { postcssPlugin } = require('../build/postCss-plugin');
const {
    buildBuiltInPlugins,
    copyBuiltInPluginsToDevUserData,
    sourceRoot: builtInPluginsSourceRoot,
} = require('../build/builtin-plugins');

const forwardedElectronArgs = process.argv.slice(2);

const styleIn = path.join(rootDir, 'src', 'renderer', 'styles', 'styles.css');
const styleOut = path.join(distWindows, 'styles.css');
const runtimeSourceRoots = [
    path.join(rootDir, 'src', 'runtime'),
    path.join(rootDir, 'src', 'shared'),
    path.join(rootDir, 'src', 'renderer', 'apps', 'dev-mode', 'nlr'),
    path.join(rootDir, 'src', 'renderer', 'lib', 'ui-editor'),
];

// Bind the reload port BEFORE clearing `dist`. This used to be a `rimraf dist`
// in the npm script, so a second `yarn dev` against a live session wiped the
// running app's bundles and only then died on EADDRINUSE — leaving Electron up
// with nothing behind `app://windows/...`. Binding first makes the port itself
// the interlock: the losing session exits with `dist` untouched.
const wss = new WebSocketServer({ port: DEV_RELOAD_PORT });
const reloadServerReady = new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
});

function broadcastReload(target = 'all') {
    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(JSON.stringify({ type: 'reload', target }));
    });
}

(async () => {
    try {
        await reloadServerReady;
    } catch (error) {
        if (error && error.code === 'EADDRINUSE') {
            console.error(`[dev] port ${DEV_RELOAD_PORT} is already in use — another \`yarn dev\` session owns it.`);
            console.error('[dev] dist was left untouched. Stop that session first, or run `yarn build:dev` to rebuild in place.');
        } else {
            console.error('[dev] failed to start the reload server:', error);
        }
        process.exit(1);
    }

    // Only now that this process owns the session is it safe to drop the last
    // run's output.
    wss.on('error', (error) => console.error('[dev] reload server error:', error));
    fs.rmSync(distRoot, { recursive: true, force: true });
    fs.mkdirSync(distWindows, { recursive: true });

    const distDir = distRoot;
    const startedAt = Date.now();

    /** Restart electron process */
    let electronProcess = null;
    let appStarted = false; // whether Electron has been started at least once
    let initialMainBuilt = false;
    let initialStylesBuilt = false;
    let initialRenderersBuilt = false;
    let initialPreloadBuilt = false;
    let initialRuntimeBuilt = false;
    let initialBuiltInPluginsBuilt = false;
    let restartTimer = null; // Timer for debouncing restarts
    let runtimeRebuildTimer = null;
    let runtimeBuildRunning = false;
    let runtimeBuildQueued = false;

    function tryStartElectronOnce() {
        if (
            !appStarted &&
            initialMainBuilt &&
            initialStylesBuilt &&
            initialRenderersBuilt &&
            initialPreloadBuilt &&
            initialRuntimeBuilt &&
            initialBuiltInPluginsBuilt
        ) {
            appStarted = true;
            console.log(`[dev] all initial builds completed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. starting electron...`);
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
        electronProcess = spawn(electronBinary, [mainEntry, '--dev', ...forwardedElectronArgs], {
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

    function runNodeScript(args) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, args, {
                cwd: rootDir,
                stdio: 'inherit',
            });
            child.on('close', code => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`node ${args.join(' ')} exited with code ${code}`));
                }
            });
            child.on('error', reject);
        });
    }

    async function rebuildRuntimeForDev() {
        if (runtimeBuildRunning) {
            runtimeBuildQueued = true;
            return;
        }
        runtimeBuildRunning = true;
        runtimeBuildQueued = false;
        try {
            // The game runtime is ALWAYS a production bundle (NODE_ENV=production,
            // minified) regardless of this flag — build-runtime.js enforces that so
            // packs produced from a dev Studio session never ship dev React.
            // `--dev` here only turns on sourcemaps for readable runtime stacks.
            await runNodeScript(['project/build/build-runtime.js', '--dev']);
            if (!initialRuntimeBuilt) {
                initialRuntimeBuilt = true;
                console.log('[runtime] initial build complete.');
                tryStartElectronOnce();
            } else {
                console.log('[runtime] rebuilt.');
            }
        } catch (error) {
            console.error('[runtime] build failed:', error);
        } finally {
            runtimeBuildRunning = false;
            if (runtimeBuildQueued) {
                void rebuildRuntimeForDev();
            }
        }
    }

    void rebuildRuntimeForDev();

    const runtimeWatcher = chokidar.watch(runtimeSourceRoots, {
        ignored: /(^|[\/\\])\../,
        ignoreInitial: true,
    });

    runtimeWatcher.on('all', () => {
        if (runtimeRebuildTimer) {
            clearTimeout(runtimeRebuildTimer);
        }
        runtimeRebuildTimer = setTimeout(() => {
            void rebuildRuntimeForDev();
        }, 150);
    });

    // Every initial build below is independent: main, the two utility-process
    // workers, preload, the renderer apps and the built-in plugins share no
    // inputs. They used to run as a chain of sequential `await`s, which stranded
    // the small builds (~0.7s of main chain + plugins) on either side of the
    // renderer phase for no reason. Each is now started as a thunk and awaited
    // together at the end; tryStartElectronOnce() already gates Electron on the
    // completion flags, so finishing order does not matter.

    // Build & watch main process
    const mainEntry = path.join(rootDir, 'src', 'main', 'index.ts');
    const buildMainProcess = () => watchBuild({
        entryPoints: [mainEntry],
        outfile: path.join(distDir, 'main', 'index.js'),
        platform: 'node',
        bundle: true,
        format: 'cjs',
        external: ['electron', '@narraleaf/encryption', 'koffi'],
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

    /** Build & watch the game build worker (forked by utilityProcess). */
    const buildGameBuildWorker = () => watchBuild({
        entryPoints: [path.join(rootDir, 'src', 'main', 'buildWorker', 'buildWorker.ts')],
        outfile: path.join(distDir, 'main', 'buildWorker.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // electron-builder reads template files relative to itself at runtime;
        // 7zip-bin resolves its 7za binary relative to its own __dirname;
        // @narraleaf/encryption loads a platform-specific native addon by path.
        // All break if inlined, so keep this list in sync with build-main.js.
        external: ['electron', 'electron-builder', '7zip-bin', '@narraleaf/encryption'],
        sourcemap: true,
        target: ['node18'],
    }, () => {
        // No Electron restart: the worker is spawned fresh per build.
        console.log('[buildWorker] built.');
    });

    /**
     * Build & watch the PSD import worker (forked by utilityProcess by the
     * character editor's import wizard). Without this, `yarn dev` leaves
     * dist/main/psdWorker.js missing and every import fails with
     * "PSD worker exited before answering" — the same shape of hole the
     * compile worker below documents.
     */
    const buildPsdImportWorker = () => watchBuild({
        entryPoints: [path.join(rootDir, 'src', 'main', 'buildWorker', 'psdWorker.ts')],
        outfile: path.join(distDir, 'main', 'psdWorker.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // ag-psd is pure JS and bundles fine; keep this list in sync with build-main.js.
        external: ['electron'],
        sourcemap: true,
        target: ['node18'],
    }, () => {
        // No Electron restart: the worker is spawned fresh per job.
        console.log('[psdWorker] built.');
    });

    /**
     * Build & watch the artifact compile worker (forked by utilityProcess for
     * preview launches and the pre-package compile). Without this, `yarn dev`
     * leaves dist/main/compileWorker.js missing and every preview launch fails
     * with "Artifact compile worker exited unexpectedly (code 1)".
     */
    const buildArtifactCompileWorker = () => watchBuild({
        entryPoints: [path.join(rootDir, 'src', 'main', 'buildWorker', 'compileWorker.ts')],
        outfile: path.join(distDir, 'main', 'compileWorker.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // @narraleaf/encryption and koffi both resolve their own binaries by path
        // at runtime; keep this list in sync with build-main.js.
        external: ['electron', '@narraleaf/encryption', 'koffi'],
        sourcemap: true,
        target: ['node18'],
    }, () => {
        // No Electron restart: the worker is spawned fresh per compile.
        console.log('[compileWorker] built.');
    });

    /** Build & watch preload script */
    const preloadEntry = path.join(rootDir, 'src', 'main', 'preload', 'preload.ts');
    const buildPreloadScript = async () => {
        if (!fs.existsSync(preloadEntry)) {
            console.warn('[preload] Entry "src/main/preload/preload.ts" not found. Skipping preload build.');
            initialPreloadBuilt = true;
            tryStartElectronOnce();
            return;
        }
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
    };

    // Build & watch renderer apps
    const apps = getRendererApps();

    const buildRenderers = () => Promise.all(apps.map(async (appName) => {
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
            // `yarn dev` is always a development build.
            define: { __NLS_STUDIO_DEV__: 'true' },
            // narraleaf-react is linked from a sibling checkout whose own node_modules also
            // contains these packages; pin them to THIS repo's copies so the bundle never
            // carries two React (or motion) instances (see build-apps.js).
            alias: {
                'react': path.join(rootDir, 'node_modules', 'react'),
                'react-dom': path.join(rootDir, 'node_modules', 'react-dom'),
                'motion': path.join(rootDir, 'node_modules', 'motion'),
            },
            loader: {
                '.css': 'css',
                '.ttf': 'file',
                '.woff': 'file',
                '.woff2': 'file',
            },
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
    })).then(() => {
        // Mark all renderers as built after HTML written
        initialRenderersBuilt = true;
        tryStartElectronOnce();
    });

    async function rebuildBuiltInPluginsForDev() {
        const results = await buildBuiltInPlugins({ dev: true });
        await copyBuiltInPluginsToDevUserData();
        return results;
    }

    const buildInitialBuiltInPlugins = async () => {
        const builtInPluginResults = await rebuildBuiltInPluginsForDev();
        initialBuiltInPluginsBuilt = true;
        console.log(`[builtin-plugins] initial build complete (${builtInPluginResults.length}).`);
        tryStartElectronOnce();
    };

    await Promise.all([
        buildMainProcess(),
        buildGameBuildWorker(),
        buildPsdImportWorker(),
        buildArtifactCompileWorker(),
        buildPreloadScript(),
        buildRenderers(),
        buildInitialBuiltInPlugins(),
    ]);

    let builtInPluginRebuildTimer = null;
    const builtInPluginWatcher = chokidar.watch(builtInPluginsSourceRoot, {
        ignored: /(^|[\/\\])\../,
        ignoreInitial: true,
    });

    builtInPluginWatcher.on('all', () => {
        if (builtInPluginRebuildTimer) {
            clearTimeout(builtInPluginRebuildTimer);
        }
        builtInPluginRebuildTimer = setTimeout(async () => {
            try {
                const results = await rebuildBuiltInPluginsForDev();
                console.log(`[builtin-plugins] rebuilt (${results.length}).`);
                if (appStarted) {
                    console.log('[builtin-plugins] broadcasting workspace reload...');
                    broadcastReload('workspace');
                }
            } catch (error) {
                console.error('[builtin-plugins] rebuild failed:', error);
            }
        }, 150);
    });

    if (!initialStylesBuilt) {
        initialStylesBuilt = true;
        console.log('[styles] initial build complete.');
        tryStartElectronOnce();
    } else {
        console.log('[styles] rebuilt. broadcasting reload...');
        if (appStarted) broadcastReload();
    }
})().catch((error) => {
    // An initial build that throws (a renderer syntax error, say) otherwise leaves
    // this process alive holding DEV_RELOAD_PORT with no Electron behind it, and
    // the app's bundle directory empty. Fail loudly and free the port instead.
    console.error('[dev] startup failed:', error);
    process.exit(1);
});
