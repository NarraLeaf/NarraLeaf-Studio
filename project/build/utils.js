const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const ejs = require('ejs');

const rootDir = path.resolve(__dirname, '../..');
const appsDir = path.join(rootDir, 'src', 'renderer', 'apps');
const templatePath = path.join(rootDir, 'project', 'assets', 'app-entry-html.ejs');
const distRoot = path.join(rootDir, 'dist');
const distWindows = path.join(distRoot, 'windows');

/**
 * Port the dev server listens on for renderer reload sockets. Owning it is what
 * marks a live `yarn dev` session, so `yarn stop` looks here too — keep the two
 * in sync via this constant rather than re-typing the number.
 * The renderer side connects in src/main/app/application/baseApp.ts.
 *
 * Overridable via NLS_DEV_RELOAD_PORT so a second checkout (a git worktree on a
 * branch, say) can run its own dev session without killing the first: the port is
 * the session lock, so two trees sharing 5588 means whichever starts second exits
 * with "port already in use". Unset, the default keeps `yarn dev`/`yarn stop`
 * pairing up exactly as before.
 */
const DEV_RELOAD_PORT = Number(process.env.NLS_DEV_RELOAD_PORT) || 5588;

function isDev(argv = process.argv) {
    return argv.includes('--dev');
}

function getRendererApps() {
    return fs.readdirSync(appsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
}

/**
 * Apps that host the game rather than Studio chrome, and so must not carry the
 * `nl-studio` class: it opts a document into the light theme, and the game has
 * to render exactly as it ships no matter which theme the author picked. Dev
 * Mode renders GameApp in-document (not in a webview), so the class would reach
 * the game through the shared widget renderers.
 *
 * Values are app directory names, which are also the WindowAppType values in
 * src/shared/types/window.ts — BaseApp.getAppEntry resolves one from the other.
 */
const GAME_HOSTING_APPS = new Set(['dev-mode']);

async function renderHtml(appName) {
    const template = await promisify(fs.readFile)(templatePath, 'utf-8');
    return ejs.render(template, {
        title: `NarraLeaf - ${appName}`,
        base: `app://public`,
        script: `app://windows/${appName}/index.js`,
        style: `app://windows/${appName}/index.css`,
        htmlClass: GAME_HOSTING_APPS.has(appName) ? '' : 'nl-studio',
    });
}

module.exports = {
    rootDir,
    appsDir,
    templatePath,
    distRoot,
    distWindows,
    DEV_RELOAD_PORT,
    isDev,
    getRendererApps,
    renderHtml,
};
