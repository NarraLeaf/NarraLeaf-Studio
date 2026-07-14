#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { rootDir, isDev } = require('./utils');
const { postcssPlugin } = require('./postCss-plugin');

const runtimeSourceDir = path.join(rootDir, 'src', 'runtime');
const runtimeOutDir = path.join(rootDir, 'dist', 'runtime');
const runtimeTsconfig = path.join(runtimeSourceDir, 'tsconfig.json');

function runtimeHtml() {
    // NOTE: the Content-Security-Policy is intentionally NOT baked in here. It is
    // injected into <head> at serve time by the runtime main process
    // (src/runtime/main/networkPolicy.ts), because the policy is gated on the
    // project's per-launch `allowHttp` flag which is only known at runtime.
    return `<!doctype html>
<html lang="en">
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

function runtimeAliasPlugin() {
    const shim = name => path.join(runtimeSourceDir, 'renderer', 'shims', name);
    const exactAliases = new Map([
        [
            '@/lib/i18n',
            shim('i18n.ts'),
        ],
        [
            '@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant',
            shim('useEditorAppearanceInspectorVariant.ts'),
        ],
        [
            '@/lib/workspace/hooks/useAssetObjectUrl',
            shim('useAssetObjectUrl.ts'),
        ],
        [
            '@/lib/workspace/hooks/useEditorFontFamily',
            shim('useEditorFontFamily.ts'),
        ],
        [
            '@/apps/workspace/modules/properties/framework/utils/colorUtils',
            shim('colorUtils.ts'),
        ],
        [
            '@/lib/workspace/services/ui-editor/UIEditorStateService',
            shim('UIEditorStateService.ts'),
        ],
        [
            '@/lib/workspace/services/ui-editor/UIDocumentService',
            shim('UIDocumentService.ts'),
        ],
        [
            '@/lib/workspace/services/ui/UIStore',
            shim('UIStore.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/inlineTextEdit',
            shim('inlineTextEdit.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/containerDrillSelection',
            shim('containerDrillSelection.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/surfaceInlineTextEditActivation',
            shim('surfaceInlineTextEditActivation.ts'),
        ],
        [
            '@/lib/ui-editor/interaction/doubleClickDebug',
            shim('doubleClickDebug.ts'),
        ],
    ]);
    // The game runtime bundle may only reach Studio renderer code through:
    //   1. an explicit shim alias above,
    //   2. the shared ui-editor tree, or
    //   3. a triaged pure module (functions/constants over @shared types only).
    // Everything else is a Studio module and must fail the build instead of
    // silently falling through to the tsconfig "@/*" path mapping.
    const allowedPrefixes = ['@/lib/ui-editor/'];
    const allowedExact = new Set([
        // Pure blueprint helpers (no services, no state); candidates to move
        // under @/lib/ui-editor or @shared eventually.
        '@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs',
        '@/lib/workspace/services/ui-editor/blueprint/fieldEvaluation',
        '@/lib/workspace/services/ui-editor/blueprint/fnCatalog',
        '@/lib/workspace/services/ui-editor/blueprint/ownerKeys',
    ]);
    return {
        name: 'runtime-alias',
        setup(build) {
            build.onResolve({ filter: /^@\/(?:apps|lib)\/.*$/ }, args => {
                const target = exactAliases.get(args.path);
                if (target) {
                    return { path: target };
                }
                if (allowedPrefixes.some(prefix => args.path.startsWith(prefix)) || allowedExact.has(args.path)) {
                    return undefined; // fall through to tsconfig paths
                }
                return {
                    errors: [{
                        text: `Runtime bundle must not import "${args.path}" (imported by ${args.importer}). ` +
                            `Add a shim under src/runtime/renderer/shims + an alias in build-runtime.js, ` +
                            `or move the code into a shared module under @/lib/ui-editor.`,
                    }],
                };
            });
        },
    };
}

(async () => {
    const dev = isDev();
    console.log(`[build-runtime] Mode: ${dev ? 'development' : 'production'}`);

    fs.rmSync(runtimeOutDir, { recursive: true, force: true });
    fs.mkdirSync(runtimeOutDir, { recursive: true });

    const commonNodeOptions = {
        platform: 'node',
        format: 'cjs',
        bundle: true,
        external: ['electron'],
        sourcemap: dev,
        minify: !dev,
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
        minify: !dev,
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

    fs.writeFileSync(path.join(runtimeOutDir, 'index.html'), runtimeHtml(), 'utf-8');

    console.log('[build-runtime] Runtime built successfully.');
})();
