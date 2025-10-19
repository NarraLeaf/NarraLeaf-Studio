const fs = require('fs')
const postcss = require('postcss')
const tailwindcss = require('tailwindcss')
const autoprefixer = require('autoprefixer')
const postcssImport = require('postcss-import')

function postcssPlugin() {
    return {
        name: 'postcss-tailwind',
        setup(build) {
            build.onLoad({ filter: /\.css$/ }, async (args) => {
                const source = await fs.promises.readFile(args.path, 'utf8')
                const result = await postcss([
                    postcssImport,
                    tailwindcss,
                    autoprefixer,
                ]).process(source, { from: args.path })
                return {
                    contents: result.css,
                    loader: 'css',
                }
            })
        },
    }
}

module.exports = { postcssPlugin }
