/*
 * Acceptance: the inline style toolbar is reachable and usable from the keyboard.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *       node tools/ui-verify/scenarios/story-toolbar-keyboard.js
 *
 * What the author asked for, one check per clause:
 *
 *   Tab, strip collapsed  -> the strip opens and the caret STAYS in the line
 *   Tab, strip open       -> focus lands on the first control that is not the collapse chevron (bold)
 *   Tab / Shift+Tab       -> walk the controls, wrapping at both ends
 *   activate              -> the control fires AND focus stays on it, so the next Tab still works
 *   Escape                -> the line takes the caret back, still in edit; a second Escape leaves
 *
 * Every one of these is a FOCUS claim, and focus is the one thing a screenshot cannot show. So the
 * oracle throughout is `document.activeElement` — read as the control's `title` (each button carries
 * one) or as "the contentEditable itself" — plus, for the activation check, the row's own markup.
 *
 * Not merely non-mutating by luck: bold is applied and then applied again to take it back off, and
 * the row's text and markup are compared against the snapshot taken before any of it. A drive that
 * leaves a stray <b> in someone's prose has failed even if every assertion passed.
 */

const path = require('path');
const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SCENE = process.env.NLS_VERIFY_SCENE || 'First Day';

const results = [];
function record(name, ok, detail) {
    results.push({ ok, name });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Where focus is, in the only terms this scenario cares about. */
const FOCUS = function () {
    const el = document.activeElement;
    if (!el) return { where: 'none' };
    const strip = el.closest ? el.closest('[data-rt-toolbar]') : null;
    if (strip) {
        const items = Array.from(strip.querySelectorAll('button'));
        return {
            where: 'toolbar',
            title: el.getAttribute('data-tip') || el.getAttribute('title') || '',
            index: items.indexOf(el),
            count: items.length,
        };
    }
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return { where: 'editor' };
    return { where: 'other', tag: el.tagName, cls: String(el.className || '').slice(0, 60) };
};

/** The strip's state and its controls' titles, whether or not anything in it has focus. */
const STRIP = function () {
    const strip = document.querySelector('[data-rt-toolbar]');
    if (!strip) return { present: false };
    const items = Array.from(strip.querySelectorAll('button'));
    return {
        present: true,
        // The collapsed form IS a single button with no children of its own; the expanded form is a
        // container with a row of them. `role=toolbar` is the honest discriminator.
        expanded: strip.getAttribute('role') === 'toolbar',
        titles: items.map(b => b.getAttribute('data-tip') || b.getAttribute('title') || ''),
        pressed: items.map(b => b.getAttribute('aria-pressed')),
    };
};

/** The row's text and whether any of it is bold — the mutation oracle. */
const ROW_STATE = function (blockId) {
    const row = document.querySelector('[data-story-row-block-id="' + blockId + '"]');
    if (!row) return null;
    const host = row.querySelector('[contenteditable="true"]') || row.querySelector('[data-story-row-text]');
    if (!host) return null;
    const bold = Array.from(host.querySelectorAll('*')).some(el => {
        const weight = getComputedStyle(el).fontWeight;
        return el.tagName === 'B' || el.tagName === 'STRONG' || Number(weight) >= 600 || weight === 'bold';
    });
    return { editing: Boolean(row.querySelector('[contenteditable="true"]')), text: (host.innerText || '').trim(), bold };
};

/**
 * Every row's text AND its indent.
 *
 * The indent is not padding on the check — it is what catches the failure this scenario is most exposed
 * to. `Tab` / `Shift+Tab` are bound globally to indent / outdent the selected rows, on a `window`
 * listener that skips *editable* targets. The moment focus moves to a toolbar BUTTON the row stops
 * looking editable to it, so every Tab pressed inside the strip would also silently re-nest the
 * author's row. A text-only snapshot sees none of that and reports a clean run.
 */
const SNAPSHOT = function () {
    return Array.from(document.querySelectorAll('[data-story-row-block-id]')).map(row => {
        const indented = row.querySelector('[style*="padding-left"]');
        const indent = indented ? getComputedStyle(indented).paddingLeft : '?';
        return row.getAttribute('data-story-row-block-id') + ' @' + indent + ' ' + (row.innerText || '').replace(/\s+/g, ' ').trim();
    });
};

async function openScene(d) {
    if (await A.call(d, function () { return document.querySelectorAll('[data-story-row-block-id]').length > 0; })) return;
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
        await A.sleep(700);
        hit = await A.call(d, function (name) {
            const leaf = [...document.querySelectorAll('span, div')]
                .find(e => e.children.length === 0 && (e.textContent || '').trim() === name);
            if (!leaf) return null;
            const r = leaf.getBoundingClientRect();
            const cx = Math.round(r.x + r.width / 2);
            const cy = Math.round(r.y + r.height / 2);
            const target = document.elementFromPoint(cx, cy);
            return { cx, cy, reachable: Boolean(target && (target === leaf || leaf.contains(target))) };
        }, SCENE);
    }
    if (!hit || !hit.reachable) throw new Error(`SETUP GUARD: scene "${SCENE}" never became clickable`);
    await d.click(hit.cx, hit.cy);
    await A.sleep(2500);
}

/** Click into a row's text, which is what opens it for editing (the mouseup gesture carries the caret). */
async function editRow(d, blockId) {
    await A.call(d, function (id) {
        const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
        if (row) row.scrollIntoView({ block: 'center' });
        return Boolean(row);
    }, blockId);
    await A.sleep(500);
    const point = await A.call(d, function (id) {
        const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
        const body = row && row.querySelector('[data-story-row-text]');
        if (!body) return null;
        const r = body.getBoundingClientRect();
        const cx = Math.round(r.left + Math.min(24, r.width / 2));
        const cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return { cx, cy, reachable: Boolean(hit && (hit === body || body.contains(hit))) };
    }, blockId);
    if (!point || !point.reachable) throw new Error(`SETUP GUARD: row ${blockId} body is not reachable`);
    await d.click(point.cx, point.cy);
    await A.sleep(800);
}

/**
 * Leave edit mode however we got here, so each phase starts from the same place.
 *
 * Also the FIRST thing the run does. An aborted earlier run leaves a row open in the editor, and a
 * row in edit has no `[data-story-row-text]` — so the row picker silently skips it and the whole
 * run measures a different row than the one it reports, or finds no strip at all. Ask for a known
 * state rather than assuming one.
 */
async function leaveEdit(d) {
    for (let i = 0; i < 4; i += 1) {
        const editing = await A.call(d, function () {
            return Boolean(document.querySelector('[data-story-row-block-id] [contenteditable="true"]'));
        });
        const focus = await A.call(d, FOCUS);
        if (!editing && focus.where !== 'toolbar' && focus.where !== 'editor') return true;
        await d.keys('Escape');
        await A.sleep(600);
    }
    return false;
}

/** Drive the strip to `want`, using the pointer — the path this scenario is NOT testing. */
async function setStripExpanded(d, want) {
    const strip = await A.call(d, STRIP);
    if (!strip.present || strip.expanded === want) return strip.present;
    const point = await A.call(d, function (expanded) {
        const el = document.querySelector('[data-rt-toolbar]');
        if (!el) return null;
        // Collapsed: the chip itself. Expanded: its first button, the collapse chevron.
        const target = expanded ? el.querySelector('button') : el;
        const r = target.getBoundingClientRect();
        return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
    }, strip.expanded);
    if (!point) return false;
    await d.click(point.cx, point.cy);
    await A.sleep(700);
    return true;
}

async function main() {
    if (!process.env.NLS_VERIFY_PROJECT) throw new Error('set NLS_VERIFY_PROJECT to the project COPY this run may open');

    await withDriver({ target: 'workspace', port: PORT }, async (d) => {
        await A.assertVisible(d, A.WINDOWS.workspace, PID);
        await openScene(d);
        record('the scene starts with no row open for editing', await leaveEdit(d), 'a previous run may have left one open');

        const before = await A.call(d, SNAPSHOT);
        const rows = await A.call(d, function () {
            return Array.from(document.querySelectorAll('[data-story-row-block-id]'))
                .map(row => {
                    const body = row.querySelector('[data-story-row-text]');
                    return { id: row.getAttribute('data-story-row-block-id'), text: body ? (body.innerText || '').trim() : '' };
                })
                .filter(row => row.text.length > 3);
        });
        if (rows.length === 0) throw new Error(`SETUP GUARD: scene "${SCENE}" has no text rows`);
        const row = rows[0];
        console.log(`driving row ${row.id.slice(0, 8)} ${JSON.stringify(row.text.slice(0, 40))}\n`);

        // --- Tab with the strip collapsed -------------------------------------------------------
        // Order matters and cost a run: the strip only exists while a row is being edited, so it
        // cannot be pre-set from outside. Open the row FIRST, then collapse the strip in place — and
        // do not "re-enter" the row afterwards, because a row already in edit has no
        // `[data-story-row-text]` to click (that is the read-only body, which the editor replaced).
        await editRow(d, row.id);
        await setStripExpanded(d, false);
        await A.sleep(400);
        const collapsedBefore = await A.call(d, STRIP);
        const caretBefore = await A.call(d, FOCUS);
        record('the strip starts collapsed for this phase', collapsedBefore.present && !collapsedBefore.expanded,
            JSON.stringify(collapsedBefore));
        record('the caret is in the line before the first Tab', caretBefore.where === 'editor', JSON.stringify(caretBefore));

        await d.keys('Tab');
        await A.sleep(600);
        const afterFirstTab = await A.call(d, STRIP);
        const focusAfterFirstTab = await A.call(d, FOCUS);
        record('Tab opens the collapsed strip', Boolean(afterFirstTab.present && afterFirstTab.expanded),
            JSON.stringify({ expanded: afterFirstTab.expanded, controls: (afterFirstTab.titles || []).length }));
        // The clause that is easy to get wrong: opening the tools must not also take the author out
        // of the sentence they were writing. One keystroke, one effect.
        record('opening the strip leaves the caret in the line', focusAfterFirstTab.where === 'editor',
            JSON.stringify(focusAfterFirstTab));

        // --- Tab with the strip open ------------------------------------------------------------
        await d.keys('Tab');
        await A.sleep(500);
        const entered = await A.call(d, FOCUS);
        record('Tab again enters the strip', entered.where === 'toolbar', JSON.stringify(entered));
        record('it lands on the first control that is not collapse', entered.index === 1,
            `index=${entered.index} title=${JSON.stringify(entered.title)} of ${entered.count}`);
        const titles = afterFirstTab.titles || [];
        record('that control is bold', /bold|粗体/i.test(entered.title || ''),
            `titles=${JSON.stringify(titles)}`);

        // --- walking the strip ------------------------------------------------------------------
        await d.keys('Tab');
        await A.sleep(300);
        const forward = await A.call(d, FOCUS);
        record('Tab moves to the next control', forward.where === 'toolbar' && forward.index === 2,
            JSON.stringify(forward));

        await d.keys('Shift+Tab');
        await A.sleep(300);
        const back = await A.call(d, FOCUS);
        record('Shift+Tab moves back', back.where === 'toolbar' && back.index === 1, JSON.stringify(back));

        await d.keys('Shift+Tab');
        await A.sleep(300);
        const wrappedToCollapse = await A.call(d, FOCUS);
        record('Shift+Tab off the first control reaches collapse', wrappedToCollapse.index === 0,
            JSON.stringify(wrappedToCollapse));

        await d.keys('Shift+Tab');
        await A.sleep(300);
        const wrappedToEnd = await A.call(d, FOCUS);
        record('and wraps round to the last control', wrappedToEnd.index === wrappedToEnd.count - 1,
            JSON.stringify(wrappedToEnd));

        await d.keys('Tab');
        await A.sleep(300);
        const wrappedToStart = await A.call(d, FOCUS);
        record('Tab off the last control wraps to the first', wrappedToStart.index === 0,
            JSON.stringify(wrappedToStart));

        // --- activating a control ---------------------------------------------------------------
        // Bold needs something to apply to. Select the line from the keyboard, then walk back in.
        await d.keys('Tab');
        await A.sleep(300);
        const onBold = await A.call(d, FOCUS);
        record('back on bold before activating', onBold.index === 1, JSON.stringify(onBold));

        const beforeBold = await A.call(d, ROW_STATE, row.id);
        await d.keys('Escape');
        await A.sleep(500);
        await d.keys('Home', 'Shift+End');
        await A.sleep(400);
        await d.keys('Tab');
        await A.sleep(500);
        const onBoldAgain = await A.call(d, FOCUS);
        record('Tab returns to bold with a selection held', onBoldAgain.where === 'toolbar' && onBoldAgain.index === 1,
            JSON.stringify(onBoldAgain));

        await d.keys('Enter');
        await A.sleep(700);
        const boldOn = await A.call(d, ROW_STATE, row.id);
        const focusAfterActivate = await A.call(d, FOCUS);
        record('activating bold marks the text', Boolean(boldOn && boldOn.bold && !(beforeBold && beforeBold.bold)),
            `before=${beforeBold && beforeBold.bold} after=${boldOn && boldOn.bold}`);
        // The clause that makes the strip usable rather than a one-shot: every command re-focuses the
        // field internally (a mark needs a live selection), so without a deliberate hand-back the
        // author would be ejected after a single press.
        record('focus stays on the control after activating', focusAfterActivate.where === 'toolbar' && focusAfterActivate.index === 1,
            JSON.stringify(focusAfterActivate));
        const pressed = await A.call(d, STRIP);
        record('the control reports itself pressed', pressed.pressed[1] === 'true', `aria-pressed=${JSON.stringify(pressed.pressed.slice(0, 3))}`);

        await d.keys('Enter');
        await A.sleep(700);
        const boldOff = await A.call(d, ROW_STATE, row.id);
        record('activating again takes the mark back off', Boolean(boldOff && !boldOff.bold),
            `bold=${boldOff && boldOff.bold}`);

        // --- a second command family, activated with Space ---------------------------------------
        // Bold is a *mark*: it re-renders the runs in place. "Insert pause" is an *insertion*: it
        // splices a chip at the caret. They take different paths through the field, and the one that
        // hands focus back is shared, so proving one proves nothing about the other. Space rather
        // than Enter for the same reason — they are two different browser activation routes, and it
        // was Enter alone that the global binding was eating.
        const pauseIndex = titles.findIndex(title => /pause|暂停/i.test(title));
        record('the strip offers an insert-pause control', pauseIndex > 0, `index=${pauseIndex}`);
        if (pauseIndex > 0) {
            const from = await A.call(d, FOCUS);
            for (let i = from.index; i !== pauseIndex; i = (i + 1) % from.count) {
                await d.keys('Tab');
                await A.sleep(200);
            }
            const onPause = await A.call(d, FOCUS);
            record('Tab walks to the insert-pause control', onPause.index === pauseIndex, JSON.stringify(onPause));

            const beforePause = await A.call(d, function (id) {
                const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
                return row ? row.querySelectorAll('[data-pause]').length : -1;
            }, row.id);
            await d.keys('Space');
            await A.sleep(800);
            const afterPause = await A.call(d, function (id) {
                const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
                return row ? row.querySelectorAll('[data-pause]').length : -1;
            }, row.id);
            const focusAfterPause = await A.call(d, FOCUS);
            record('Space activates the control too', afterPause === beforePause + 1,
                `pauses ${beforePause} -> ${afterPause}`);
            record('focus stays on it after an insertion', focusAfterPause.index === pauseIndex,
                JSON.stringify(focusAfterPause));

            // Put it back: Escape to the line, then the field's own undo (which is why Mod+Z is not
            // in STRIP_KEYS — it still belongs to whoever has focus).
            await d.keys('Escape');
            await A.sleep(500);
            await d.keys('Control+z');
            await A.sleep(700);
            const undone = await A.call(d, function (id) {
                const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
                return row ? row.querySelectorAll('[data-pause]').length : -1;
            }, row.id);
            record('undo removes the inserted chip again', undone === beforePause, `pauses=${undone}`);
            await d.keys('Tab');
            await A.sleep(500);
        }

        // --- the palette is its own rung of the Escape ladder ------------------------------------
        const paletteIndex = titles.findIndex(title => /more colors|调色板|更多颜色/i.test(title));
        if (paletteIndex > 0) {
            const from = await A.call(d, FOCUS);
            if (from.where === 'toolbar') {
                for (let i = from.index; i !== paletteIndex; i = (i + 1) % from.count) {
                    await d.keys('Tab');
                    await A.sleep(200);
                }
                await d.keys('Enter');
                await A.sleep(700);
                const opened = await A.call(d, function () {
                    return Boolean(document.querySelector('[data-rt-toolbar] [aria-expanded="true"]'));
                });
                record('Enter opens the colour palette', opened, `aria-expanded=${opened}`);

                await d.keys('Escape');
                await A.sleep(600);
                const afterFirst = await A.call(d, function () {
                    return Boolean(document.querySelector('[data-rt-toolbar] [aria-expanded="true"]'));
                });
                const whereAfterFirst = await A.call(d, FOCUS);
                // Rule 1 of the interaction model: one rung per press. The palette closes and the
                // author is still standing in the strip — the line does not get the caret back yet.
                record('Escape closes the palette and stays in the strip',
                    !afterFirst && whereAfterFirst.where === 'toolbar' && whereAfterFirst.index === paletteIndex,
                    JSON.stringify({ open: afterFirst, focus: whereAfterFirst }));
            }
        }

        // --- Escape -----------------------------------------------------------------------------
        await d.keys('Escape');
        await A.sleep(600);
        const backInLine = await A.call(d, FOCUS);
        const stillEditing = await A.call(d, ROW_STATE, row.id);
        record('Escape hands the caret back to the line', backInLine.where === 'editor', JSON.stringify(backInLine));
        record('and the row is still open for editing', Boolean(stillEditing && stillEditing.editing),
            JSON.stringify(stillEditing && { editing: stillEditing.editing }));

        await d.keys('Escape');
        await A.sleep(700);
        const afterSecondEscape = await A.call(d, ROW_STATE, row.id);
        record('a second Escape leaves edit mode, as it always did',
            Boolean(afterSecondEscape && !afterSecondEscape.editing),
            JSON.stringify(afterSecondEscape && { editing: afterSecondEscape.editing }));

        await leaveEdit(d);
        const after = await A.call(d, SNAPSHOT);
        const changed = after.filter((line, i) => before[i] !== line);
        record('the drive left every row exactly as it found it',
            before.length === after.length && changed.length === 0,
            `rows ${before.length}->${after.length}, changed=${changed.length}${changed.length ? ` ${JSON.stringify(changed.slice(0, 2))}` : ''}`);
    });

    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(`SCENARIO ERROR: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
});
