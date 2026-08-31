#!/usr/bin/env node
/**
 * Blueprint CLI - query the node catalogue, write blueprints as text, check them before they reach
 * a project.
 *
 * The commands live in `src/renderer/lib/blueprint-cli` because that is where the node registry and
 * the graph validator live, and answering "does this node have that pin" from anywhere else would
 * mean keeping a second copy of the catalogue in step with the first. This wrapper only bundles
 * that TypeScript for Node and runs it.
 *
 * The bundle is cached under `.dev/cache/blueprint-cli` and rebuilt whenever anything under `src`
 * is newer than it, so an edit to a node definition is visible to the next command with no build
 * step to remember.
 *
 * Usage: node project/app/blueprint.js <command> [...]  (see `--help`)
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.resolve(__dirname, '..', '..');
const srcDir = path.join(rootDir, 'src');
const cacheDir = path.join(rootDir, '.dev', 'cache', 'blueprint-cli');
const bundlePath = path.join(cacheDir, 'cli.cjs');
const stampPath = path.join(cacheDir, 'stamp.json');
const entryPath = path.join(cacheDir, 'entry.ts');

const ENTRY_SOURCE = `import { runCli } from "@/lib/blueprint-cli/cli";
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
            // The command modules pull in the workspace's service layer, which reaches the text
            // editor and from there Monaco's stylesheets and icon font. None of it runs here; the
            // bundle only needs the imports to resolve.
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
    // Where the scratch directory lives. The working directory is not it: these commands are often
    // run from a project directory, and the file they leave behind belongs to the checkout.
    process.env.NLS_BLUEPRINT_REPO_ROOT = rootDir;
    const stamp = newestSourceMtime();
    if (!isFresh(stamp)) {
        try {
            await build(stamp);
        } catch (error) {
            process.stderr.write(`[blueprint] Could not build the command bundle.\n${error.message || error}\n`);
            process.exit(2);
        }
    }
    require(bundlePath);
})();
