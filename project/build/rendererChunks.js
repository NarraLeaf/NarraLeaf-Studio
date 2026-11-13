const fs = require('fs');
const path = require('path');

/**
 * The esbuild options that let a renderer window load code on demand, shared by the production
 * build (build-apps.js) and the dev watcher (dev-electron.js) so the two cannot drift apart.
 *
 * Every window used to be one IIFE file. An `import()` in the source changed nothing under that
 * format - esbuild has nowhere to put the imported module but the same file - so the code editor,
 * the blueprint canvas and all three UI languages were parsed by every window on every open, the
 * Dev Mode window included. ESM with splitting gives each `import()` a file of its own.
 *
 * Chunks sit beside `index.js`, not in a subdirectory: a chunk's stylesheet is folded into
 * `index.css` (see {@link chunkStylesheetPlugin}), and the `url()`s esbuild wrote into it are
 * relative to where the chunk stylesheet was going to live.
 */
function rendererChunkOptions(outDir) {
    return {
        outdir: outDir,
        entryNames: 'index',
        chunkNames: 'chunk-[name]-[hash]',
        format: 'esm',
        splitting: true,
        metafile: true,
    };
}

/**
 * Give the window one `index.css` holding every stylesheet its code can reach, as before splitting,
 * and remove the chunk files a previous build left behind.
 *
 * With splitting esbuild writes a stylesheet beside each chunk that pulls CSS in, and each of those
 * carries *all* the CSS reachable from that chunk - the shared Tailwind sheet over and over - while
 * nothing links any of them: a chunk's JavaScript does not load CSS. So the chunk stylesheets are
 * read only for their list of source files. Every source file goes, once, into one CSS build of its
 * own, in the order the largest chunk stylesheet (the window's whole static closure) has them, with
 * the files only lazy code reaches (Monaco's) after it. That is the order a single bundle had them
 * in, less the lazy sheets moving to the end, and those are scoped to their own widgets.
 *
 * Old chunks have hashed names that the next build does not overwrite, and anything left in
 * `dist/windows` is packaged, so each build deletes the chunks it did not write.
 *
 * @param {string} outDir
 * @param {{ cssPlugins?: import('esbuild').Plugin[], minify?: boolean }} [options]
 */
function chunkStylesheetPlugin(outDir, { cssPlugins = [], minify = false } = {}) {
    return {
        name: 'renderer-chunk-stylesheets',
        setup(build) {
            const esbuild = build.esbuild;
            build.onEnd(async (result) => {
                if (!result.metafile || result.errors.length > 0) {
                    return;
                }
                const cwd = build.initialOptions.absWorkingDir || process.cwd();
                const outputs = Object.entries(result.metafile.outputs)
                    .map(([file, info]) => ({ file: path.resolve(cwd, file), info }));
                const sheets = outputs
                    .filter(output => output.file.endsWith('.css'))
                    .sort((a, b) => b.info.bytes - a.info.bytes);
                const sources = [];
                const seen = new Set();
                for (const sheet of sheets) {
                    for (const input of Object.keys(sheet.info.inputs)) {
                        const file = path.resolve(cwd, input);
                        if (!seen.has(file) && input.endsWith('.css') && fs.existsSync(file)) {
                            seen.add(file);
                            sources.push(file);
                        }
                    }
                }
                for (const sheet of sheets) {
                    fs.rmSync(sheet.file, { force: true });
                }
                const entryCss = path.join(outDir, 'index.css');
                if (sources.length > 0) {
                    await esbuild.build({
                        stdin: {
                            contents: sources.map(file => `@import ${JSON.stringify(file)};`).join('\n'),
                            loader: 'css',
                            resolveDir: cwd,
                            sourcefile: 'index.css',
                        },
                        bundle: true,
                        outfile: entryCss,
                        minify,
                        loader: build.initialOptions.loader,
                        assetNames: build.initialOptions.assetNames,
                        target: build.initialOptions.target,
                        absWorkingDir: cwd,
                        plugins: cssPlugins,
                        logLevel: 'error',
                    });
                } else {
                    fs.writeFileSync(entryCss, '', 'utf8');
                }
                const kept = new Set(outputs.filter(output => !output.file.endsWith('.css')).map(output => output.file));
                for (const name of fs.readdirSync(outDir)) {
                    const file = path.join(outDir, name);
                    if (name.startsWith('chunk-') && !kept.has(file)) {
                        fs.rmSync(file, { force: true });
                    }
                }
            });
        },
    };
}

module.exports = { rendererChunkOptions, chunkStylesheetPlugin };
