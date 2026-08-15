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
        // @narraleaf/encryption is kept external (required from node_modules, not bundled).
        // koffi likewise: it resolves its own .node addon by path at runtime, which
        // bundling breaks. lorelib itself is loaded through a computed require of the
        // @lore-vcs/sdk-<platform> package, which esbuild cannot follow and therefore
        // leaves alone - see vcs/lore/library.ts.
        //   esbuild is external for the same reason as koffi -- it spawns its own
        // platform binary from @esbuild/<platform>, resolved by path -- and it is a
        // *runtime* dependency, not just this script's: the Live2D puppet runtime
        // installer bundles the author's Cubism SDK on their machine, because the
        // Cubism Framework ships as TypeScript and nobody may publish a prebuilt
        // adapter. See managers/puppet/live2dRuntimeBuild.ts.
        //   electron-updater is external because it is the one dependency that reads its own
        // installed layout: it resolves `app-update.yml` next to the running app and hands the
        // downloaded installer to the OS. Bundling it would work until one of those paths did
        // not, and the failure would only show up on a real update - the one code path nobody
        // exercises before shipping. asarUnpack already puts node_modules on disk as real files.
        external: ['electron', 'esbuild', '@narraleaf/encryption', 'koffi', 'electron-updater'],
        sourcemap: isDev(),
        minify: !isDev(),
        keepNames: true,
        target: ['node18'],
        tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
    });

    console.log('[build-main] Bundling game build worker…');
    await esbuild.build({
        entryPoints: [path.join(rootDir, 'src', 'main', 'buildWorker', 'buildWorker.ts')],
        outfile: path.join(outDir, 'buildWorker.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // electron-builder stays a real node_modules require: its module tree
        // reads template/resource files relative to itself at runtime. 7zip-bin
        // (already in electron-builder's closure) resolves its bundled 7za.exe
        // relative to its own __dirname, so it must not be inlined either.
        // @narraleaf/encryption is a native addon: it loads a platform-specific
        // binary by path, so it must resolve from node_modules, not be bundled
        // (same reason the artifact compile worker keeps it external).
        external: ['electron', 'electron-builder', '7zip-bin', '@narraleaf/encryption'],
        sourcemap: isDev(),
        minify: !isDev(),
        keepNames: true,
        target: ['node18'],
        tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
    });

    console.log('[build-main] Bundling PSD import worker…');
    await esbuild.build({
        entryPoints: [path.join(rootDir, 'src', 'main', 'buildWorker', 'psdWorker.ts')],
        outfile: path.join(outDir, 'psdWorker.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // ag-psd is pure JS and bundles fine; electron stays external as everywhere else.
        external: ['electron'],
        sourcemap: isDev(),
        minify: !isDev(),
        keepNames: true,
        target: ['node18'],
        tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
    });

    console.log('[build-main] Bundling artifact compile worker…');
    await esbuild.build({
        entryPoints: [path.join(rootDir, 'src', 'main', 'buildWorker', 'compileWorker.ts')],
        outfile: path.join(outDir, 'compileWorker.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // Same externals as the main bundle: @narraleaf/encryption is a native
        // addon whose computed-require sidecars resolve by path at runtime, and koffi
        // loads its own binary by path — bundling either breaks resolution.
        external: ['electron', '@narraleaf/encryption', 'koffi'],
        sourcemap: isDev(),
        minify: !isDev(),
        keepNames: true,
        target: ['node18'],
        tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
    });

    // The shipped-content audit. Built apart from every other bundle here because it runs the story
    // compiler, which lives in the renderer tree and resolves its own imports through the renderer's
    // "@/" alias -- the opposite of what the main tsconfig means by it. The compile worker loads this
    // by path for that reason; the two alias maps cannot coexist in one bundle.
    console.log('[build-main] Bundling content audit…');
    await esbuild.build({
        entryPoints: [path.join(rootDir, 'src', 'renderer', 'lib', 'build', 'contentAuditEntry.ts')],
        outfile: path.join(outDir, 'contentAudit.js'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        external: ['electron', '@narraleaf/encryption', 'koffi'],
        sourcemap: isDev(),
        minify: !isDev(),
        target: ['node18'],
        tsconfig: path.join(rootDir, 'src', 'renderer', 'tsconfig.json'),
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
            keepNames: true,
            target: ['node18'],
            tsconfig: path.join(rootDir, 'src', 'main', 'tsconfig.json'),
        });
    }

    console.log('[build-main] Main process built successfully.');
})();
