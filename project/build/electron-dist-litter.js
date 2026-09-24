/**
 * Whether a file or folder found in an Electron distribution is something the machine put there
 * rather than something Electron shipped: Chromium's `debug.log`, a crash dump, a file manager's
 * `.DS_Store` or `Thumbs.db`, an editor's swap file.
 *
 * prepare-preview-runner.js stages Studio's embedded preview runner by copying
 * `node_modules/electron/dist`, and on a machine that has ever run Electron from there that folder
 * holds more than the release did. This is the rule that copy uses to leave the rest behind.
 *
 * It is a second spelling of `isElectronDistLitter` in src/main/buildWorker/electronRuntimeFiles.ts
 * (the game build's rule for the same folder), because these scripts cannot load TypeScript.
 * electronRuntimeFiles.test.ts holds the two together name by name; change both or neither. The
 * reasoning for every entry, and for a denylist rather than a list of what Electron ships, is there
 * and in src/shared/utils/hostLitter.ts.
 */

const FILE_MANAGER_NAMES = new Set([
    '.ds_store',
    '.appledouble',
    '__macosx',
    '.spotlight-v100',
    '.trashes',
    '.fseventsd',
    '.temporaryitems',
    'icon\r',
    'thumbs.db',
    'ehthumbs.db',
    'ehthumbs_vista.db',
    'desktop.ini',
    '.directory',
]);

const VERSION_CONTROL_NAMES = new Set(['.git', '.svn', '.hg']);

/** Studio's atomic writer's scratch suffix (src/shared/utils/atomicWriteTemp.ts). */
const ATOMIC_WRITE_TEMP_SUFFIX = '.nltmp';

function isElectronDistLitter(name) {
    const lower = name.toLowerCase();
    return FILE_MANAGER_NAMES.has(lower)
        || name.startsWith('._')
        || VERSION_CONTROL_NAMES.has(lower)
        || lower.endsWith(ATOMIC_WRITE_TEMP_SUFFIX)
        || name.startsWith('~$')
        || /^\..+\.sw[a-p]$/i.test(name)
        || (name.length > 1 && name.endsWith('~'))
        || name.startsWith('.#')
        || (name.length > 2 && name.startsWith('#') && name.endsWith('#'))
        // Written by the runtime itself: Chromium's log file and minidumps.
        || lower.endsWith('.log')
        || lower.endsWith('.dmp');
}

module.exports = { isElectronDistLitter };
