#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { rootDir, isDev } = require('./utils');
const { postcssPlugin } = require('./postCss-plugin');
// The runtime's import boundary. Kept in its own module so the vitest guard can load the same
// allow lists this build enforces (see src/renderer/lib/ui-editor/runtime/app/importBoundary.test.ts).
const { runtimeAliasPlugin } = require('./runtime-alias-plugin');

const runtimeSourceDir = path.join(rootDir, 'src', 'runtime');
const runtimeOutDir = path.join(rootDir, 'dist', 'runtime');
const runtimeTsconfig = path.join(runtimeSourceDir, 'tsconfig.json');

function runtimeHtml() {
    // NOTE: the Content-Security-Policy is intentionally NOT baked in here. It is
    // injected into <head> at serve time by the runtime main process
    // (src/runtime/main/networkPolicy.ts), because the policy is gated on the
    // project's per-launch `allowHttp` flag which is only known at runtime.
    // That policy does not permit inline scripts; the same serve-time step stamps its nonce onto
    // every inline <script> here, which is what lets the import map below run at all. An inline
    // script this document grows will be nonced with it - one written with its own `src` will not,
    // and does not need to be.
    // No `lang`: this document is built once and shipped inside every game, so it cannot name a
    // language any of them is in, and `en` was answering for all of them - the attribute picks the
    // Han forms a fallback font draws, so a Japanese title was being set in an English page's face.
    // The renderer writes the real one as soon as the game publishes it (see the runtime's
    // `documentLanguage`); until then the document says nothing, which is what it knows.
    return `<!doctype html>
<html>
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NarraLeaf Game</title>
    <script type="importmap">
    {
        "imports": {
            "narraleaf-studio/runtime": "nlgame://plugin-api/runtime.js",
            "react": "nlgame://plugin-api/react.js",
            "react-dom": "nlgame://plugin-api/react-dom.js",
            "react/jsx-runtime": "nlgame://plugin-api/react-jsx-runtime.js",
            "react/jsx-dev-runtime": "nlgame://plugin-api/react-jsx-dev-runtime.js"
        }
    }
    </script>
    <link rel="stylesheet" href="nlgame://runtime/renderer.css" />
</head>
<body>
    <div id="root"></div>
    <script defer src="nlgame://runtime/renderer.js"></script>
</body>
</html>
`;
}

/**
 * Build the game runtime into `dist/runtime`.
 *
 * Exported rather than only run as a script because `yarn dev` calls it in
 * process. Spawning `node build-runtime.js` for it cost ~2.5s of node + esbuild
 * + tailwind module loading on every startup AND on every runtime source change,
 * and - the larger half - gave the runtime's renderer bundle a cold Tailwind JIT
 * of its own, even though the Studio app bundles being compiled a few
 * milliseconds away in the parent process pull the very same stylesheet through
 * the very same config. In process it shares that warm context (see
 * postCss-plugin.js).
 *
 * @param {{ dev?: boolean }} options `dev` only turns sourcemaps on; see below.
 */
async function buildRuntime(options = {}) {
    // The runtime is ALWAYS built as production, even under `--dev` / `yarn dev`.
    // Game packs (preview and shipped builds alike) copy dist/runtime verbatim,
    // so a dev-flavored runtime built during a Studio dev session would leak
    // development React/motion/narraleaf-react into "Production" games and tank
    // their frame rate. `--dev` only keeps sourcemaps on for readable stacks.
    const dev = options.dev ?? isDev();
    console.log(`[build-runtime] Building production runtime${dev ? ' (with sourcemaps)' : ''}...`);

    fs.rmSync(runtimeOutDir, { recursive: true, force: true });
    fs.mkdirSync(runtimeOutDir, { recursive: true });

    // Explicit define is load-bearing: without it, esbuild only injects
    // NODE_ENV=production into browser bundles when `minify` is on, and node
    // bundles defer to whatever env the packaged app happens to launch with.
    const productionDefine = {
        'process.env.NODE_ENV': '"production"',
    };

    const commonNodeOptions = {
        platform: 'node',
        format: 'cjs',
        bundle: true,
        // koffi is external for the reason it is everywhere else in this repo: it resolves its own
        // .node addon by path at run time, and bundling it breaks that resolution. The packaged game
        // gets the package copied beside its main.js (see gameRuntimeArtifactCompiler).
        external: ['electron', 'koffi'],
        sourcemap: dev,
        minify: true,
        define: productionDefine,
        target: ['node18'],
        tsconfig: runtimeTsconfig,
    };

    await esbuild.build({
        ...commonNodeOptions,
        entryPoints: [path.join(runtimeSourceDir, 'main', 'main.ts')],
        outfile: path.join(runtimeOutDir, 'main.js'),
    });

    await esbuild.build({
        ...commonNodeOptions,
        entryPoints: [path.join(runtimeSourceDir, 'preload', 'preload.ts')],
        outfile: path.join(runtimeOutDir, 'preload.js'),
    });

    await esbuild.build({
        entryPoints: [path.join(runtimeSourceDir, 'renderer', 'index.tsx')],
        outfile: path.join(runtimeOutDir, 'renderer.js'),
        platform: 'browser',
        format: 'iife',
        bundle: true,
        sourcemap: dev,
        minify: true,
        define: productionDefine,
        jsx: 'automatic',
        target: ['chrome114'],
        tsconfig: runtimeTsconfig,
        // Keep react/motion resolution pinned to this repo when narraleaf-react is a linked
        // sibling checkout (see build-apps.js).
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
        plugins: [runtimeAliasPlugin(), postcssPlugin()],
    });

    // Web runtime shell: replaces main.js/preload.js when a game is exported as
    // a static site. Loaded by the generated web index.html BEFORE renderer.js,
    // it installs the browser implementation of the runtime bridge; the
    // renderer bundle itself is shared verbatim with the desktop shell.
    await esbuild.build({
        entryPoints: [path.join(runtimeSourceDir, 'web', 'web.ts')],
        outfile: path.join(runtimeOutDir, 'web.js'),
        platform: 'browser',
        format: 'iife',
        bundle: true,
        sourcemap: dev,
        minify: true,
        define: productionDefine,
        target: ['chrome114'],
        tsconfig: runtimeTsconfig,
    });

    fs.writeFileSync(path.join(runtimeOutDir, 'index.html'), runtimeHtml(), 'utf-8');

    copyRuntimeSupportSidecar(runtimeOutDir);

    // Build marker consumed by the game pack compiler (gameRuntimeArtifactCompiler's
    // assertRuntimeDistReady): packs refuse to ship a dist/runtime that was not
    // produced by this script in production mode. Grepping bundles for dev-only
    // strings would be brittle; an explicit marker is authoritative.
    fs.writeFileSync(
        path.join(runtimeOutDir, 'build-manifest.json'),
        JSON.stringify({
            mode: 'production',
            sourcemap: dev,
            builtAt: new Date().toISOString(),
        }, null, 2),
        'utf-8',
    );

    console.log('[build-runtime] Runtime built successfully.');
}

// The bundled runtime main.js reaches for sibling support modules through
// requires the bundler cannot inline (the specifiers are computed, not literals),
// so those modules are neither embedded in main.js nor emitted. They must sit
// next to main.js at runtime; copyRuntimeFiles() then carries them into every
// packed app. Emitted for every pack because the requires run eagerly at
// startup; the modules themselves are inert until the runtime asks them to work.
//
// These are opaque support files of @narraleaf/bindings; treat them as a black
// box and ship them verbatim. The list must track the codec package's
// computed-require sidecars (bindings.js loads the codec addon; vendor.js is the
// codec's key-gating module) — keep it in sync with REQUIRED_RUNTIME_FILES in
// gameRuntimeArtifactCompiler.ts.
const RUNTIME_SUPPORT_SIDECARS = ['bindings.js', 'vendor.js'];

function copyRuntimeSupportSidecar(runtimeOutDir) {
    const packageRuntimeDir = path.dirname(require.resolve('@narraleaf/bindings/read'));
    for (const sidecar of RUNTIME_SUPPORT_SIDECARS) {
        const source = path.join(packageRuntimeDir, sidecar);
        if (!fs.existsSync(source)) {
            throw new Error(
                `[build-runtime] Missing runtime support file "${sidecar}" from @narraleaf/bindings. ` +
                `Reinstall dependencies so the packaged runtime can boot.`,
            );
        }
        fs.copyFileSync(source, path.join(runtimeOutDir, sidecar));
    }
}

module.exports = { buildRuntime };

if (require.main === module) {
    buildRuntime().catch(error => {
        console.error('[build-runtime] build failed:', error);
        process.exitCode = 1;
    });
}
