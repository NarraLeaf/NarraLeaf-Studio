/*
 * The drive path every scenario starts from, and the isolated-tree recipe that makes a run mean
 * something.
 *
 * Acceptance is done on a tree produced by `git archive <branch>`, never on the shared checkout:
 * several sessions work in it at once, and a `yarn dev` there renders their uncommitted changes too.
 * That is not hypothetical — a card once shipped code that adapted to a symbol existing only in
 * someone else's uncommitted diff, and lint, tests and screenshots were all green.
 *
 *   1. tools/ui-verify/scenarios/iso-tree.sh <branch> <isoDir>     (prints the junction command)
 *   2. cd <isoDir> && NLS_DEV_RELOAD_PORT=<port> node project/app/dev-electron.js --cdp --cdp-port=<cdp>
 *   3. NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> node tools/ui-verify/scenarios/<name>.js
 *
 * Stop it with the SAME `NLS_DEV_RELOAD_PORT` you started it with, or `stop-dev.js` will target the
 * default port and kill another session's app.
 */

const path = require('path');
const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SCENE = process.env.NLS_VERIFY_SCENE || 'First Day';
const { listTargets } = require(path.join(__dirname, '..', '..', '..', 'project', 'app', 'cdp'));

/** Run `fn` against a window, with the visibility guard already satisfied. */
async function onWindow(target, windowTitle, fn) {
    return withDriver({ target, port: PORT }, async (d) => {
        await A.assertVisible(d, windowTitle, PID);
        return fn(d);
    });
}

async function waitForWindow(match, tries = 120) {
    for (let i = 0; i < tries; i += 1) {
        const targets = await listTargets({ port: PORT });
        const hit = targets.find((t) => new RegExp(match, 'i').test(`${t.title} ${t.url}`));
        if (hit) return hit;
        await A.sleep(1500);
    }
    throw new Error(`window "${match}" never appeared on CDP port ${PORT}`);
}

/**
 * launcher -> project -> Story -> <scene> -> Dev Mode -> New Game -> Story Runtime panel.
 *
 * Idempotent at every step, so a scenario can be re-run against an instance that is already part of
 * the way there — but note that a run which has advanced a story leaves it advanced. Acceptance of
 * record should always start a fresh instance (§6.3): a long-lived one that has been hot-reloaded
 * and clicked through is not the state anyone ships.
 */
async function driveToDevMode() {
    await waitForWindow('launcher|workspace');
    const targets = await listTargets({ port: PORT });
    if (!targets.find((t) => /workspace/i.test(`${t.title}${t.url}`))) {
        await onWindow('launcher', A.WINDOWS.launcher, async (d) => {
            // The project card carries `title="Open <project name>"` and no aria-label, so the
            // lookup has to accept `title` too. It must also be ANCHORED on the name: `^Open `
            // alone matches the toolbar's "Open Folder" button, which comes first in the DOM and
            // opens a native dialog that nothing here can dismiss — the run then just hangs waiting
            // for a workspace window that is never coming.
            const project = process.env.NLS_VERIFY_PROJECT;
            if (!project) throw new Error('set NLS_VERIFY_PROJECT to the project copy this run may open');
            const name = path.basename(project.replace(/[\/]+$/, ''));
            await A.clickNamed(d, 'button, [role="button"]', `^Open ${name}$`);
        });
        await waitForWindow('workspace');
        await A.sleep(4000);
    }

    await onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const inStory = await A.call(d, function (name) {
            return Boolean(Array.from(document.querySelectorAll('span'))
                .find((e) => (e.textContent || '').trim() === name));
        }, SCENE);
        if (!inStory) {
            await A.clickNamed(d, '[aria-label]', '^Story$');
            await A.sleep(1400);
        }
        await A.clickNamed(d, 'span, div', `^${SCENE}$`);
        await A.sleep(2500);
        const rows = await A.call(d, function () {
            return document.querySelectorAll('[data-story-row-block-id]').length;
        });
        if (rows === 0) throw new Error(`SETUP GUARD: scene "${SCENE}" opened but rendered no rows`);
    });

    if (!(await listTargets({ port: PORT })).find((t) => /dev-mode/i.test(`${t.title}${t.url}`))) {
        await onWindow('workspace', A.WINDOWS.workspace, (d) => A.clickNamed(d, '[aria-label]', '^Run Dev Mode$'));
        await waitForWindow('dev-mode');
        await A.sleep(6000);
    }

    await onWindow('dev-mode', A.WINDOWS.devmode, async (d) => {
        const stage = () => A.call(d, function () {
            const tabs = document.querySelector('[role="tablist"]');
            const panelText = tabs ? (tabs.parentElement.innerText || '') : '';
            return (document.body.innerText || '').replace(panelText, '').replace(/\s+/g, ' ').trim();
        });
        const findMenu = () => A.call(d, function () {
            const el = Array.from(document.querySelectorAll('*'))
                .find((e) => (e.textContent || '').trim() === 'New Game' && e.children.length === 0);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cx = Math.round(r.x + r.width / 2);
            const cy = Math.round(r.y + r.height / 2);
            const hit = document.elementFromPoint(cx, cy);
            return { cx, cy, reachable: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
        });

        // Poll for EITHER outcome instead of sampling once. This used to be a single look followed by
        // `if (!menu) return`, which reads "no menu, so we are already past it" — but on a cold tree
        // it far more often means the menu has not rendered yet. The run then continued with the boot
        // menu on stage and measured the whole card against it: every number plausible, nothing about
        // a running scene. Silence is the problem; this either starts the story or says why it could
        // not. A `story` launch entry boots straight past the menu, so "no menu, story on stage" stays
        // a legitimate way to finish.
        let clicks = 0;
        let last = '';
        for (let i = 0; i < 44; i += 1) {
            last = await stage();
            if (last && !/New Game/.test(last)) return;
            const menu = await findMenu();
            if (menu && menu.reachable && clicks < 3) {
                clicks += 1;
                await d.click(menu.cx, menu.cy);
                await A.sleep(2500);
                continue;
            }
            await A.sleep(750);
        }
        throw new Error(`SETUP GUARD: the story never reached the stage (clicked "New Game" ${clicks}x); stage="${last.slice(0, 160)}"`);
    });
}

/** Open the Story Runtime panel in Dev Mode, if it is not already open. */
async function openRuntimePanel(d) {
    if (await A.call(d, function () { return Boolean(document.querySelector('[role="tablist"]')); })) return;
    const menuOpen = await A.call(d, function () {
        return Boolean(Array.from(document.querySelectorAll('[aria-label]'))
            .find((e) => e.getAttribute('aria-label') === 'Close preview debug tools menu'));
    });
    if (!menuOpen) {
        await A.clickNamed(d, '[aria-label]', '^Open preview debug tools menu$');
        await A.sleep(700);
    }
    await A.clickNamed(d, 'button,[role="menuitem"],[aria-label]', '^Story Runtime$');
    await A.sleep(1200);
    if (!(await A.call(d, function () { return Boolean(document.querySelector('[role="tablist"]')); }))) {
        throw new Error('SETUP GUARD: could not open the Story Runtime panel');
    }
}

/** Select a panel tab by its visible label. */
async function selectTab(d, nameRe) {
    await A.clickNamed(d, '[role="tab"]', nameRe, { flags: 'i' });
    await A.sleep(800);
}

/** The panel's current text, whitespace-collapsed. */
function panelText(d) {
    return A.call(d, function () {
        const tabs = document.querySelector('[role="tablist"]');
        return tabs ? (tabs.parentElement.innerText || '').replace(/\s+/g, ' ').trim() : '';
    });
}

module.exports = { PORT, PID, SCENE, onWindow, waitForWindow, driveToDevMode, openRuntimePanel, selectTab, panelText };
