const path = require('path');

/**
 * Renderer windows that only ever speak their interface language, and so are built without the
 * other UI catalogs. Each loads the language it is shown in on start-up (and another on a language
 * switch) instead of carrying all three: about 2.6 MB of script, most of a dialog's bundle.
 *
 * A window belongs here only if nothing in it translates into a language other than the interface
 * language. The workspace (a widget's default words are written in the game's language), Dev Mode
 * (the player's language) and the project wizard (a new project's track names, in the project's
 * language) do, and stay on the full set. In a lean window such a lookup would quietly come back in
 * English, so a window that starts doing that has to leave this list.
 */
const LEAN_LOCALE_APPS = new Set([
    'launcher',
    'settings',
    'project-trust',
    'plugin-permission',
    'server-trust',
    'server-session',
    'agent-access',
]);

/** Swaps `src/shared/i18n/catalog/builtinCatalogs.ts` for its lean twin in the listed windows. */
function leanLocalePlugin(appName) {
    return {
        name: 'renderer-lean-locales',
        setup(build) {
            if (!LEAN_LOCALE_APPS.has(appName)) {
                return;
            }
            build.onResolve({ filter: /^\.\/builtinCatalogs$/ }, (args) => {
                if (!args.importer.endsWith(path.join('i18n', 'catalog', 'index.ts'))) {
                    return undefined;
                }
                return { path: path.join(path.dirname(args.importer), 'builtinCatalogs.lean.ts') };
            });
        },
    };
}

module.exports = { LEAN_LOCALE_APPS, leanLocalePlugin };
