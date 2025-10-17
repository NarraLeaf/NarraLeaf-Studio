const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const esbuild = require('esbuild');
const ejs = require('ejs');

/**
 * Build all renderer apps located under "src/apps/<appName>".
 * Each app must have an "index.tsx" entry file.
 * The build output is written to "dist/windows/<appName>" with:
 *   - index.js  : bundled renderer script
 *   - index.html: generated via project/assets/app-entry-html.ejs
 */

(async () => {
    const isDev = process.argv.includes('--dev');
    console.log(`[build-apps] Mode: ${isDev ? 'development' : 'production'}`);
    const rootDir = path.resolve(__dirname, '../..');
    const appsDir = path.join(rootDir, 'src', 'apps');
    const templatePath = path.join(rootDir, 'project', 'assets', 'app-entry-html.ejs');
    const distRoot = path.join(rootDir, 'dist', 'windows');

    // Ensure dist root exists
    fs.mkdirSync(distRoot, { recursive: true });

    const entries = fs.readdirSync(appsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

    if (entries.length === 0) {
        console.warn('[build-apps] No apps found in src/apps');
        return;
    }

    console.log(`[build-apps] Found ${entries.length} app(s): ${entries.join(', ')}`);

    // Read html template once
    const template = await promisify(fs.readFile)(templatePath, 'utf-8');

    await Promise.all(entries.map(async (appName) => {
        const entryFile = path.join(appsDir, appName, 'index.tsx');
        if (!fs.existsSync(entryFile)) {
            console.warn(`[build-apps] Skip ${appName}: missing index.tsx`);
            return;
        }

        const outDir = path.join(distRoot, appName);
        fs.mkdirSync(outDir, { recursive: true });

        const outfile = path.join(outDir, 'index.js');

        console.log(`[build-apps] Bundling ${appName} → ${path.relative(rootDir, outfile)}`);

        await esbuild.build({
            entryPoints: [entryFile],
            outfile,
            bundle: true,
            platform: 'browser',
            format: 'iife',
            sourcemap: isDev,
            minify: !isDev,
            jsx: 'automatic',
            target: ['chrome114', 'firefox120', 'safari16'],
            loader: {
                '.ts': 'ts',
                '.tsx': 'tsx',
            },
        });

        // Render html
        const html = ejs.render(template, {
            title: `NarraLeaf - ${appName}`,
            base: `app://public/${appName}`,
            script: 'index.js',
        });

        await promisify(fs.writeFile)(path.join(outDir, 'index.html'), html, 'utf-8');

        console.log(`[build-apps] Generated HTML for ${appName}`);
    }));

    console.log('[build-apps] All apps built successfully.');
})();
