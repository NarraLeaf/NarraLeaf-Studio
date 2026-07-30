/*
 * Acceptance for the story row buttons' accessible names.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *       node tools/ui-verify/scenarios/story-row-button-names.js
 *
 * Nothing about this change is visible — the tooltips are unchanged and the icons are unchanged — so a
 * screenshot proves nothing and the thing to read is the accessibility tree. What must hold for every
 * control in the per-row cluster:
 *
 *   1. it HAS an accessible name (an icon button with none is a "button" and nothing else);
 *   2. the name is not a bare verb — it says what the control acts on;
 *   3. the name is not *less* informative than the tooltip the same control shows on hover, which is
 *      the specific regression: aria-label "Insert" against title "Insert a blank row after this
 *      one (Shift+Enter)".
 *
 * Read straight off the DOM rather than through `assert.js`'s PROBE, because PROBE's name derivation
 * (aria-label, else title, else text) is the very thing under test here.
 */

const path = require('path');
const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SCENE = process.env.NLS_VERIFY_SCENE || 'First Day';

const results = [];
function record(name, ok, detail) {
    results.push({ ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Every named control inside the active row, with each source of its name reported separately —
 * which is what makes an "informative tooltip, useless name" mismatch visible at all.
 *
 * `announced` follows the accname precedence: aria-label, then the element's own text content, and
 * only then `title`. Getting that order wrong matters: a first version of this probe read
 * `aria || title` and reported a quick-param chip as announcing the single letter "d", when its text
 * content ("d 5s") is what an AT actually reads and `title` never gets consulted.
 */
const ROW_CONTROLS = function () {
    const rows = [...document.querySelectorAll('[data-story-row-block-id]')];
    return rows.flatMap(row => [...row.querySelectorAll('button, [role="button"]')]
        .map(el => {
            const aria = el.getAttribute('aria-label');
            const title = el.getAttribute('title');
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return { aria, title, text, announced: aria || text || title || '' };
        })
        .filter(control => control.aria || control.title || control.text));
};

async function main() {
    if (!process.env.NLS_VERIFY_PROJECT) throw new Error('set NLS_VERIFY_PROJECT to the project COPY this run may open');

    await withDriver({ target: 'workspace', port: PORT }, async (d) => {
        await A.assertVisible(d, A.WINDOWS.workspace, PID);

        // The rail button toggles the Story panel, so drive it to the state we want rather than
        // clicking blind (a closed panel leaves the outline's nodes in the DOM at 0x0).
        if (await A.call(d, function () { return document.querySelectorAll('[data-story-row-block-id]').length === 0; })) {
            for (let attempt = 0; attempt < 6; attempt += 1) {
                const visible = await A.call(d, function (name) {
                    return [...document.querySelectorAll('span, div')].some(e => e.children.length === 0
                        && (e.textContent || '').trim() === name && e.getBoundingClientRect().width > 0);
                }, SCENE);
                if (visible) break;
                await A.clickNamed(d, '[aria-label]', '^Story$');
                await A.sleep(1600);
            }
            let hit = null;
            for (let attempt = 0; attempt < 12 && !(hit && hit.reachable); attempt += 1) {
                await A.call(d, function (name) {
                    const leaf = [...document.querySelectorAll('span, div')]
                        .find(e => e.children.length === 0 && (e.textContent || '').trim() === name);
                    if (leaf) leaf.scrollIntoView({ block: 'center' });
                    return Boolean(leaf);
                }, SCENE);
                // Measured on the NEXT round-trip: the scroll is not laid out when the call returns.
                await A.sleep(700);
                hit = await A.call(d, function (name) {
                    const leaf = [...document.querySelectorAll('span, div')]
                        .find(e => e.children.length === 0 && (e.textContent || '').trim() === name);
                    if (!leaf) return null;
                    const r = leaf.getBoundingClientRect();
                    const cx = Math.round(r.x + r.width / 2);
                    const cy = Math.round(r.y + r.height / 2);
                    const target = document.elementFromPoint(cx, cy);
                    return { cx, cy, reachable: Boolean(target && (target === leaf || leaf.contains(target) || target.contains(leaf))) };
                }, SCENE);
            }
            if (!hit || !hit.reachable) throw new Error(`SETUP GUARD: scene "${SCENE}" never became clickable`);
            await d.click(hit.cx, hit.cy);
            await A.sleep(2500);
        }

        // Activate a row: the cluster is hover-reveal AND only mounted for the active row.
        const rowHit = await A.call(d, function () {
            const rows = [...document.querySelectorAll('[data-story-row-block-id]')];
            if (rows.length === 0) return null;
            const row = rows[Math.min(2, rows.length - 1)];
            row.scrollIntoView({ block: 'center' });
            const r = row.getBoundingClientRect();
            return { cx: Math.round(r.x + 40), cy: Math.round(r.y + r.height / 2) };
        });
        if (!rowHit) throw new Error(`SETUP GUARD: scene "${SCENE}" rendered no rows`);
        await d.click(rowHit.cx, rowHit.cy);
        await A.sleep(1400);

        const controls = await A.call(d, ROW_CONTROLS);
        record('the active row exposes its button cluster', controls.length >= 3, `controls=${controls.length}`);

        const nameless = controls.filter(control => !control.announced || !control.announced.trim());
        record('every row control has an accessible name', nameless.length === 0, `nameless=${nameless.length}`);

        // The regression, stated exactly: what an AT announces must not be shorter than what the eye
        // gets on hover. A tooltip may ADD the keybinding; it may not be the only place the object is
        // named. Compared against `announced` rather than `aria`, so a control that names itself
        // through its text content counts as named.
        const weaker = controls.filter(control => {
            if (!control.title) return false;
            const titleWithoutKeys = control.title.replace(/[\s([（【][^)\]）】]*[)\]）】]\s*$/u, '').trim();
            return titleWithoutKeys.length > control.announced.trim().length;
        });
        record('no control announces less than its tooltip shows',
            weaker.length === 0,
            weaker.length === 0
                ? `checked ${controls.length}`
                : JSON.stringify(weaker.map(c => ({ aria: c.aria, title: c.title }))));

        const insert = controls.find(control => /insert|插入/i.test(control.title || ''));
        record('the insert button names what it inserts',
            Boolean(insert) && /blank row|空行/i.test(insert.announced),
            insert ? `announced=${JSON.stringify(insert.announced)}` : 'no insert button found');

        const remove = controls.find(control => /^Delete this row|删除此行/i.test(control.title || ''));
        record('the delete button names what it deletes',
            Boolean(remove) && /this row|此行/i.test(remove.announced),
            remove ? `announced=${JSON.stringify(remove.announced)}` : 'no delete button found');

        // Printed, not just asserted: the dump is how the quick-param chip's bare "d 5s" name turned
        // up at all, which none of the assertions above was looking for.
        const distinct = new Map();
        for (const control of controls) {
            distinct.set(`${control.aria}|${control.text}|${control.title}`, control);
        }
        console.log(`\ndistinct named controls on the active row:\n${[...distinct.values()]
            .map(c => `  announced=${JSON.stringify(c.announced)}  aria=${JSON.stringify(c.aria)}  title=${JSON.stringify(c.title)}`)
            .join('\n')}`);
    });

    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(`SCENARIO ERROR: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
});
