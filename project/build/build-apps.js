const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const esbuild = require('esbuild');
const {
    rootDir,
    appsDir,
    distWindows,
    isDev,
    renderHtml,
    getRendererApps,
} = require('./utils');

/**
 * Build all renderer apps located under "src/renderer/apps/<appName>".
 * Each app must have an "index.tsx" entry file.
 * The build output is written to "dist/windows/<appName>" with:
 *   - index.js  : bundled renderer script
 *   - index.html: generated via project/assets/app-entry-html.ejs
 */

(async () => {
    console.log(`[build-apps] Mode: ${isDev() ? 'development' : 'production'}`);

    // Ensure dist root exists
    fs.mkdirSync(distWindows, { recursive: true });

    const entries = getRendererApps();

    if (entries.length === 0) {
        console.warn('[build-apps] No apps found in src/renderer/apps');
        return;
    }

    console.log(`[build-apps] Found ${entries.length} app(s): ${entries.join(', ')}`);

    // Preload template render function

    await Promise.all(entries.map(async (appName) => {
        const entryFile = path.join(appsDir, appName, 'index.tsx');
        if (!fs.existsSync(entryFile)) {
            console.warn(`[build-apps] Skip ${appName}: missing index.tsx`);
            return;
        }

        const outDir = path.join(distWindows, appName);
        fs.mkdirSync(outDir, { recursive: true });

        const outfile = path.join(outDir, 'index.js');

        console.log(`[build-apps] Bundling ${appName} → ${path.relative(rootDir, outfile)}`);

        await esbuild.build({
            entryPoints: [entryFile],
            outfile,
            bundle: true,
            platform: 'browser',
            format: 'iife',
            sourcemap: isDev(),
            minify: !isDev(),
            jsx: 'automatic',
            target: ['chrome114', 'firefox120', 'safari16'],
            loader: {
                '.ts': 'ts',
                '.tsx': 'tsx',
            },
        });

        // Render html
        const html = await renderHtml(appName);

        await promisify(fs.writeFile)(path.join(outDir, 'index.html'), html, 'utf-8');

        console.log(`[build-apps] Generated HTML for ${appName}`);
    }));

    console.log('[build-apps] All apps built successfully.');
})();
