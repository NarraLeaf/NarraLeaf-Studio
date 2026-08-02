const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { rootDir, distRoot, isDev } = require('./utils');

const sourceRoot = path.join(rootDir, 'src', 'builtin-plugins');
const distRootDir = path.join(distRoot, 'builtin-plugins');

const pluginExternals = [
    'narraleaf-studio/plugin',
    'narraleaf-studio/runtime',
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
];

function getBuiltInPluginDirs() {
    if (!fs.existsSync(sourceRoot)) {
        return [];
    }
    return fs.readdirSync(sourceRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(sourceRoot, entry.name));
}

function readManifest(pluginDir) {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Built-in plugin is missing manifest.json: ${path.relative(rootDir, pluginDir)}`);
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function resolveManifestEntries(pluginDir, manifest) {
    const entries = manifest.entries;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        throw new Error(`Built-in plugin manifest must declare "entries" (manifestVersion 2): ${path.relative(rootDir, pluginDir)}`);
    }
    const declared = ['studio', 'runtime']
        .map(target => ({ target, entry: typeof entries[target] === 'string' ? entries[target].trim() : '' }))
        .filter(item => item.entry);
    if (declared.length === 0) {
        throw new Error(`Built-in plugin manifest declares no entries: ${path.relative(rootDir, pluginDir)}`);
    }
    return declared;
}

function resolveSourceEntry(pluginDir, manifest, entry) {
    const parsed = path.parse(entry);
    const candidates = [
        path.join(pluginDir, `${parsed.name}.tsx`),
        path.join(pluginDir, `${parsed.name}.ts`),
        path.join(pluginDir, `${parsed.name}.jsx`),
        path.join(pluginDir, `${parsed.name}.js`),
        path.join(pluginDir, 'src', `${parsed.name}.tsx`),
        path.join(pluginDir, 'src', `${parsed.name}.ts`),
        path.join(pluginDir, 'src', `${parsed.name}.jsx`),
        path.join(pluginDir, 'src', `${parsed.name}.js`),
    ];
    const sourceEntry = candidates.find(candidate => fs.existsSync(candidate));
    if (!sourceEntry) {
        throw new Error(`Built-in plugin source entry not found for ${manifest.id || pluginDir}: ${entry}`);
    }
    return sourceEntry;
}

async function buildBuiltInPlugin(pluginDir, options = {}) {
    const dev = options.dev ?? isDev();
    const manifest = readManifest(pluginDir);
    const declaredEntries = resolveManifestEntries(pluginDir, manifest);
    const pluginName = path.basename(pluginDir);
    const outDir = path.join(distRootDir, pluginName);

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const outfiles = [];
    for (const { entry } of declaredEntries) {
        const sourceEntry = resolveSourceEntry(pluginDir, manifest, entry);
        const outfile = path.join(outDir, entry);
        fs.mkdirSync(path.dirname(outfile), { recursive: true });

        await esbuild.build({
            entryPoints: [sourceEntry],
            outfile,
            bundle: true,
            platform: 'browser',
            format: 'esm',
            sourcemap: dev,
            minify: !dev,
            jsx: 'automatic',
            target: ['chrome114'],
            external: pluginExternals,
            loader: {
                '.ts': 'ts',
                '.tsx': 'tsx',
                '.jsx': 'jsx',
                '.js': 'js',
                '.css': 'css',
            },
        });
        outfiles.push(outfile);
    }

    fs.copyFileSync(path.join(pluginDir, 'manifest.json'), path.join(outDir, 'manifest.json'));
    // A declared icon is part of the package: PluginManager refuses a manifest
    // whose icon file is missing, so leaving it behind here would break the
    // built-in at install time rather than at build time.
    if (typeof manifest.icon === 'string' && manifest.icon.trim()) {
        const relative = manifest.icon.trim().split(/[\\/]+/);
        const source = path.join(pluginDir, ...relative);
        if (!fs.existsSync(source)) {
            throw new Error(`Built-in plugin ${manifest.id || pluginName} declares a missing icon: ${manifest.icon}`);
        }
        const target = path.join(outDir, ...relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
    }
    return {
        id: manifest.id || pluginName,
        sourceDir: pluginDir,
        outDir,
        outfile: outfiles[0],
        outfiles,
    };
}

async function buildBuiltInPlugins(options = {}) {
    const pluginDirs = getBuiltInPluginDirs();
    fs.mkdirSync(distRootDir, { recursive: true });
    if (pluginDirs.length === 0) {
        return [];
    }
    const results = [];
    for (const pluginDir of pluginDirs) {
        results.push(await buildBuiltInPlugin(pluginDir, options));
    }
    return results;
}

// Nothing here installs into the dev userData directory any more: the main
// process is the single writer of `userData/plugins`, in development exactly as
// in a packaged build. See PluginManager.refreshBuiltInPlugins.
module.exports = {
    sourceRoot,
    distRootDir,
    buildBuiltInPlugin,
    buildBuiltInPlugins,
    getBuiltInPluginDirs,
};
