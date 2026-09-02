#!/usr/bin/env node
/**
 * Story CLI - query the command catalogue, read a project's scenes, write them as text.
 *
 * The commands live in `src/renderer/lib/story-cli` because that is where the command spec registry,
 * the line parser and the resolver live, and answering "what does `/bg` take" from anywhere else
 * would mean keeping a second catalogue in step with the first. This wrapper only bundles that
 * TypeScript for Node and runs it.
 *
 * The bundle is cached under `.dev/cache/story-cli` and rebuilt whenever anything under `src` is
 * newer than it, so an edit to a command spec is visible to the next command with no build step to
 * remember.
 *
 * The `.story` file this tool reads and writes is a tool format, not a product feature: Studio
 * offers authors no text-based way to write a story, and nothing here is reachable from its
 * interface. The author-facing `.txt` script export is a different, narrower thing and this tool
 * does not touch it.
 *
 * Usage: node project/app/story.js <command> [...]  (see `--help`)
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.resolve(__dirname, '..', '..');
const srcDir = path.join(rootDir, 'src');
const cacheDir = path.join(rootDir, '.dev', 'cache', 'story-cli');
const bundlePath = path.join(cacheDir, 'cli.cjs');
const stampPath = path.join(cacheDir, 'stamp.json');
const entryPath = path.join(cacheDir, 'entry.ts');

// Awaited, unlike its two siblings: `check` runs the project linter, whose rules are allowed to be
// async, so the whole command surface is a promise.
const ENTRY_SOURCE = `import { runCli } from "@/lib/story-cli/cli";
runCli(process.argv.slice(2), {
    out: text => process.stdout.write(text.endsWith("\\n") ? text : text + "\\n"),
    err: text => process.stderr.write(text.endsWith("\\n") ? text : text + "\\n"),
}).then(code => {
    process.exitCode = code;
});
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
            // The command specs carry a Lucide icon each and the modules around them reach the
            // workspace's service layer, and from there Monaco's stylesheets and icon font. None of
            // it runs here; the bundle only needs the imports to resolve.
            '.ts': 'ts',
            '.tsx': 'tsx',
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
    // Where the checkout is. A bare filename resolves to the scratch directory inside it, which is
    // not where the caller happened to be standing - these commands are often run from a project
    // directory. The blueprint tool's variable is the one that resolution reads.
    process.env.NLS_BLUEPRINT_REPO_ROOT = rootDir;
    const stamp = newestSourceMtime();
    if (!isFresh(stamp)) {
        try {
            await build(stamp);
        } catch (error) {
            process.stderr.write(`[story] Could not build the command bundle.\n${error.message || error}\n`);
            process.exit(2);
        }
    }
    require(bundlePath);
})();
