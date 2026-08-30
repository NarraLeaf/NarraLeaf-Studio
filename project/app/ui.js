#!/usr/bin/env node
/**
 * Interface CLI - query the widget catalogue, read a project's surfaces, write them as text.
 *
 * The commands live in `src/renderer/lib/ui-cli` because that is where the widget module registry,
 * the widget logic table and the value-binding table live, and answering "what props does a button
 * have" from anywhere else would mean keeping a second catalogue in step with the first. This
 * wrapper only bundles that TypeScript for Node and runs it.
 *
 * The bundle is cached under `.dev/cache/ui-cli` and rebuilt whenever anything under `src` is newer
 * than it, so an edit to a widget module is visible to the next command with no build step to
 * remember.
 *
 * Usage: node project/app/ui.js <command> [...]  (see `--help`)
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.resolve(__dirname, '..', '..');
const srcDir = path.join(rootDir, 'src');
const cacheDir = path.join(rootDir, '.dev', 'cache', 'ui-cli');
const bundlePath = path.join(cacheDir, 'cli.cjs');
const stampPath = path.join(cacheDir, 'stamp.json');
const entryPath = path.join(cacheDir, 'entry.ts');

const ENTRY_SOURCE = `import { runCli } from "@/lib/ui-cli/cli";
const code = runCli(process.argv.slice(2), {
    out: text => process.stdout.write(text.endsWith("\\n") ? text : text + "\\n"),
    err: text => process.stderr.write(text.endsWith("\\n") ? text : text + "\\n"),
});
process.exitCode = code;
`;

/** Newest mtime under src, which is what the cached bundle is keyed on. */
function newestSourceMtime() {
    let newest = 0;
    const stack = [srcDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === 'dist' || entry.name === 'node_modules') {
                    continue;
                }
                stack.push(path.join(dir, entry.name));
                continue;
            }
            const stats = fs.statSync(path.join(dir, entry.name));
            if (stats.mtimeMs > newest) {
                newest = stats.mtimeMs;
            }
        }
    }
    return newest;
}

function isFresh(stamp) {
    if (!fs.existsSync(bundlePath) || !fs.existsSync(stampPath)) {
        return false;
    }
    try {
        const previous = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
        return previous.newest === stamp && previous.entry === ENTRY_SOURCE;
    } catch {
        return false;
    }
}

async function build(stamp) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(entryPath, ENTRY_SOURCE, 'utf8');
    await esbuild.build({
        entryPoints: [entryPath],
        outfile: bundlePath,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        logLevel: 'warning',
        alias: {
            '@': path.join(rootDir, 'src', 'renderer'),
            '@shared': path.join(rootDir, 'src', 'shared'),
            '@lib': path.join(rootDir, 'src', 'renderer', 'lib'),
            '@services': path.join(rootDir, 'src', 'renderer', 'lib', 'workspace', 'services'),
        },
        define: { __NLS_STUDIO_DEV__: 'true' },
        loader: {
            '.ts': 'ts',
            '.tsx': 'tsx',
            // The widget modules are React components and pull in Monaco's stylesheets and icon font
            // through the workspace's service layer. None of it runs here; the bundle only needs the
            // imports to resolve so that `createDefaultElement` and the shared tables can be read.
            '.css': 'empty',
            '.ttf': 'empty',
            '.woff': 'empty',
            '.woff2': 'empty',
            '.svg': 'empty',
            '.png': 'empty',
        },
    });
    fs.writeFileSync(stampPath, JSON.stringify({ newest: stamp, entry: ENTRY_SOURCE }), 'utf8');
}

(async () => {
    const stamp = newestSourceMtime();
    if (!isFresh(stamp)) {
        try {
            await build(stamp);
        } catch (error) {
            process.stderr.write(`[ui] Could not build the command bundle.\n${error.message || error}\n`);
            process.exit(2);
        }
    }
    // `usage` reads the shipped skeleton template out of the repository, and the repository is where
    // this file is - not where the caller happened to be standing.
    process.env.NLS_UI_CLI_ROOT = rootDir;
    require(bundlePath);
})();
