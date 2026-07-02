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
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'self' nlgame: data: blob:; script-src 'self' nlgame:; style-src 'self' nlgame: 'unsafe-inline'; img-src 'self' nlgame: data: blob:; media-src 'self' nlgame: data: blob:; font-src 'self' nlgame: data: blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NarraLeaf Game</title>
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
    return {
        name: 'runtime-alias',
        setup(build) {
            build.onResolve({ filter: /^@\/(?:apps|lib)\/.*$/ }, args => {
                const target = exactAliases.get(args.path);
                return target ? { path: target } : undefined;
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
