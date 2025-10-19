const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const ejs = require('ejs');

const rootDir = path.resolve(__dirname, '../..');
const appsDir = path.join(rootDir, 'src', 'renderer', 'apps');
const templatePath = path.join(rootDir, 'project', 'assets', 'app-entry-html.ejs');
const distRoot = path.join(rootDir, 'dist');
const distWindows = path.join(distRoot, 'windows');

function isDev(argv = process.argv) {
    return argv.includes('--dev');
}

function getRendererApps() {
    return fs.readdirSync(appsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
}

async function renderHtml(appName) {
    const template = await promisify(fs.readFile)(templatePath, 'utf-8');
    return ejs.render(template, {
        title: `NarraLeaf - ${appName}`,
        base: `app://public`,
        script: `app://windows/${appName}/index.js`,
        style: `app://windows/${appName}/index.css`,
    });
}

module.exports = {
    rootDir,
    appsDir,
    templatePath,
    distRoot,
    distWindows,
    isDev,
    getRendererApps,
    renderHtml,
};
