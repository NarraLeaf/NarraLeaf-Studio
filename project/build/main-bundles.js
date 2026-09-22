const path = require('path');
const { rootDir } = require('./utils');
const { thirdPartyNoticesPlugin } = require('./third-party-notices');

/*
 * The main-process bundles, described once.
 *
 * Two scripts produce them - build-main.js for a build and a pack, dev-electron.js for `yarn dev` -
 * and each used to carry its own copy of every entry and every `external` list. The copies drifted
 * twice in the same way: a package that must not be inlined was named in one list and not in the
 * other. The first time, `yarn dev` could not install a Live2D runtime; the second time, the compile
 * worker inlined esbuild's JavaScript API and every script layer in every build, preview and test
 * run failed to compile, while Dev Mode - which compiles on the main bundle - showed them working.
 * Both scripts now read this list, so there is one list to get right.
 *
 * # What `external` is for here
 *
 * A package stays a real `require` from node_modules when inlining it would break it:
 *
 *  - `electron` is the host, never a module on disk.
 *  - `esbuild` finds its platform binary by a path relative to its own `lib/main.js` and refuses to
 *    run at all once that file has been inlined ("The esbuild JavaScript API cannot be bundled").
 *    It is external in every bundle, not only in the ones that load it today: the cost of naming it
 *    is nothing, and the cost of forgetting it is a feature that works in one process and fails
 *    silently in the next. `inlinedPackageGuard` below turns the forgetting into a failed build.
 *  - `@narraleaf/bindings` and `koffi` load native addons by path.
 *  - `electron-builder` reads template files relative to itself; `7zip-bin` computes the path to its
 *    executable from its own __dirname (corrected in code by src/main/buildWorker/sevenZipBinary.ts,
 *    so the entry is tidiness rather than the fix).
 *  - `electron-updater` resolves `app-update.yml` next to the running app and hands the downloaded
 *    installer to the OS. Bundling it would work until one of those paths did not, and the failure
 *    would only show up on a real update. asarUnpack already puts node_modules on disk.
 */

/** Named in every bundle; see the header. */
const EVERY_BUNDLE_EXTERNAL = ['electron', 'esbuild'];

const MAIN_TSCONFIG = path.join(rootDir, 'src', 'main', 'tsconfig.json');

/**
 * @typedef {object} MainProcessBundle
 * @property {string} entry        Entry file, relative to the repository root.
 * @property {string} outfile      Output file name under dist/main.
 * @property {string[]} external   Packages beyond {@link EVERY_BUNDLE_EXTERNAL} that stay a require.
 * @property {string} tsconfig     The tsconfig whose paths resolve this bundle's aliases.
 * @property {boolean} keepNames   Whether minification keeps function and class names.
 */

/** @type {Record<string, MainProcessBundle>} */
const MAIN_PROCESS_BUNDLES = {
    main: {
        entry: 'src/main/index.ts',
        outfile: 'index.js',
        external: ['@narraleaf/bindings', 'koffi', 'electron-updater'],
        tsconfig: MAIN_TSCONFIG,
        keepNames: true,
    },
    // The game build worker, forked by utilityProcess for every package a build writes.
    buildWorker: {
        entry: 'src/main/buildWorker/buildWorker.ts',
        outfile: 'buildWorker.js',
        external: ['electron-builder', '7zip-bin', '@narraleaf/bindings'],
        tsconfig: MAIN_TSCONFIG,
        keepNames: true,
    },
    // The PSD import worker. ag-psd is pure JS and bundles fine.
    psdWorker: {
        entry: 'src/main/buildWorker/psdWorker.ts',
        outfile: 'psdWorker.js',
        external: [],
        tsconfig: MAIN_TSCONFIG,
        keepNames: true,
    },
    // The weather bake worker. It draws frames in plain JS and pipes them to the bundled ffmpeg.
    weatherWorker: {
        entry: 'src/main/buildWorker/weatherWorker.ts',
        outfile: 'weatherWorker.js',
        external: [],
        tsconfig: MAIN_TSCONFIG,
        keepNames: true,
    },
    // The artifact compile worker: every build, preview and test run assembles its pack here, and
    // that assembly compiles the author's scripts with esbuild.
    compileWorker: {
        entry: 'src/main/buildWorker/compileWorker.ts',
        outfile: 'compileWorker.js',
        external: ['@narraleaf/bindings', 'koffi', '7zip-bin'],
        tsconfig: MAIN_TSCONFIG,
        keepNames: true,
    },
    // The shipped-content audit, which the compile worker loads by path. Bundled against the
    // RENDERER tsconfig because it runs the story compiler, which resolves "@/" the renderer's way -
    // the opposite of what the main tsconfig means by it, so the two cannot share one bundle.
    contentAudit: {
        entry: 'src/renderer/lib/build/contentAuditEntry.ts',
        outfile: 'contentAudit.js',
        external: ['@narraleaf/bindings', 'koffi'],
        tsconfig: path.join(rootDir, 'src', 'renderer', 'tsconfig.json'),
        keepNames: false,
    },
    preload: {
        entry: 'src/main/preload/preload.ts',
        outfile: 'preload.js',
        external: [],
        tsconfig: MAIN_TSCONFIG,
        keepNames: true,
    },
};

/**
 * Packages whose code must never be inlined, by the file an inlined copy would pull in.
 *
 * esbuild's API refuses to run from any file but its own `lib/main.js`, and says so only when it is
 * first called - which for the compile worker was the first script compile of the first build, in
 * a message that went into the build log as an ordinary line. Loading that file into a bundle is
 * therefore always a mistake, and this makes it one at build time.
 */
const NEVER_INLINED = [
    {
        name: 'esbuild',
        filter: /[\\/]node_modules[\\/]esbuild[\\/]lib[\\/]main\.js$/,
    },
];

/**
 * An esbuild plugin that fails the bundle when it would inline a package in {@link NEVER_INLINED}.
 *
 * `onLoad` only runs for a file the bundle is about to include, so an external package never
 * reaches it, and one that does is exactly the defect.
 *
 * @param {string} outfile The bundle being built, for a message that names it.
 */
function inlinedPackageGuard(outfile) {
    return {
        name: 'inlined-package-guard',
        setup(build) {
            for (const { name, filter } of NEVER_INLINED) {
                build.onLoad({ filter }, args => ({
                    errors: [{
                        text: `${path.basename(outfile)} would inline "${name}" (${args.path}). `
                            + `Add "${name}" to this bundle's external list in project/build/main-bundles.js.`,
                    }],
                }));
            }
        },
    };
}

/**
 * The esbuild options for one main-process bundle.
 *
 * @param {keyof typeof MAIN_PROCESS_BUNDLES} name
 * @param {{ dev: boolean, outDir?: string }} options `dev` keeps a readable bundle with sourcemaps.
 * @returns {import('esbuild').BuildOptions}
 */
function mainProcessBundleOptions(name, { dev, outDir = path.join(rootDir, 'dist', 'main') }) {
    const bundle = MAIN_PROCESS_BUNDLES[name];
    if (!bundle) {
        throw new Error(`Unknown main-process bundle "${name}"`);
    }
    const outfile = path.join(outDir, bundle.outfile);
    return {
        entryPoints: [path.join(rootDir, bundle.entry)],
        outfile,
        platform: 'node',
        format: 'cjs',
        bundle: true,
        external: [...EVERY_BUNDLE_EXTERNAL, ...bundle.external],
        sourcemap: dev,
        minify: !dev,
        keepNames: bundle.keepNames,
        target: ['node18'],
        tsconfig: bundle.tsconfig,
        plugins: [inlinedPackageGuard(outfile), thirdPartyNoticesPlugin()],
    };
}

module.exports = {
    EVERY_BUNDLE_EXTERNAL,
    MAIN_PROCESS_BUNDLES,
    NEVER_INLINED,
    inlinedPackageGuard,
    mainProcessBundleOptions,
};
