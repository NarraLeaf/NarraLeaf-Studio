const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const { rootDir, isDev } = require('./utils');
const { MAIN_PROCESS_BUNDLES, mainProcessBundleOptions } = require('./main-bundles');

/*
 * The main process and the workers it forks. What each bundle is - its entry, and which packages
 * stay a real require - lives in main-bundles.js, which `yarn dev` reads as well; see the header
 * there for why that list must not be written out twice.
 */

/** What each bundle is called in this script's log. */
const LOG_LABELS = {
    main: 'main process',
    buildWorker: 'game build worker',
    psdWorker: 'PSD import worker',
    weatherWorker: 'weather bake worker',
    compileWorker: 'artifact compile worker',
    contentAudit: 'content audit',
    preload: 'preload script',
};

(async () => {
    console.log(`[build-main] Mode: ${isDev() ? 'development' : 'production'}`);

    for (const name of Object.keys(MAIN_PROCESS_BUNDLES)) {
        const entry = path.join(rootDir, MAIN_PROCESS_BUNDLES[name].entry);
        if (!fs.existsSync(entry)) {
            console.error(`[build-main] Entry "${MAIN_PROCESS_BUNDLES[name].entry}" not found.`);
            process.exit(1);
        }
    }
    fs.mkdirSync(path.join(rootDir, 'dist', 'main'), { recursive: true });

    for (const name of Object.keys(MAIN_PROCESS_BUNDLES)) {
        console.log(`[build-main] Bundling ${LOG_LABELS[name] ?? name}…`);
        await esbuild.build(mainProcessBundleOptions(name, { dev: isDev() }));
    }

    console.log('[build-main] Main process built successfully.');
})().catch(error => {
    // esbuild has already printed each error with its location; this only makes the exit loud.
    console.error(`[build-main] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
