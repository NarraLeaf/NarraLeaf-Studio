const fs = require('fs')
const postcss = require('postcss')
const tailwindcss = require('tailwindcss')
const autoprefixer = require('autoprefixer')
const postcssImport = require('postcss-import')

/**
 * Tailwind's JIT keeps its per-stylesheet context in module state and re-uses it
 * across runs in the same process: the second run of a stylesheet only re-stats
 * the `content` globs and re-parses the files that actually changed (~0.3s here
 * against ~4s cold). That reuse only happens between runs that do NOT overlap,
 * because the context is only registered once a run finishes - N concurrent runs
 * all start cold and each pays the full scan of ~2k files / 21 MB.
 *
 * `yarn dev` bundles seven renderer apps with Promise.all and every one of them
 * pulls the same `styles.css` through here (renderApp.tsx imports it), so that
 * was seven cold scans: 3.7s of actual bundling stretched into 23s of wall
 * clock, and the whole session waited on it before Electron could start.
 *
 * Funnelling every postcss run through one queue turns six of those seven into
 * cache hits. It costs nothing when only one stylesheet is in flight (the
 * production `yarn build` path builds the apps one at a time anyway), and it
 * changes no output: tailwind still re-stats its content files on every run, so
 * a class added between two runs still lands in the second one.
 */
let postcssQueue = Promise.resolve()

function enqueue(task) {
    const result = postcssQueue.then(task, task)
    // Keep the chain alive past a failed run, so one broken stylesheet does not
    // wedge every build behind it.
    postcssQueue = result.then(() => {}, () => {})
    return result
}

function postcssPlugin() {
    return {
        name: 'postcss-tailwind',
        setup(build) {
            build.onLoad({ filter: /\.css$/ }, async (args) => {
                const source = await fs.promises.readFile(args.path, 'utf8')
                const result = await enqueue(() => postcss([
                    postcssImport,
                    tailwindcss,
                    autoprefixer,
                ]).process(source, { from: args.path }))
                return {
                    contents: result.css,
                    loader: 'css',
                }
            })
        },
    }
}

module.exports = { postcssPlugin }
