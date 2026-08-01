/*
 * Acceptance: a row's words must not move when it opens for editing.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *       node tools/ui-verify/scenarios/story-row-edit-shift.js
 *
 * The defect this measures: clicking a text row swaps `BlockPreview` for `TextEditBox`, and the two
 * did not occupy the same box. The read-only body is `self-stretch` inside the row's single-line box
 * (`--nl-story-row-box`), so its glyphs centre in 28px; the editor was a bare `items-center` flex with
 * no stretch and no min-height, so it collapsed to its content and its glyphs centred in ~20px. Under
 * the row's `items-start` that put the same line several pixels HIGHER the moment the caret arrived,
 * and back down on exit.
 *
 * A screenshot cannot settle this — the whole shift is a few pixels — so the oracle is a `Range` over
 * the row's own first text node, measured relative to the row's top. That is the glyph box itself, not
 * a container that might have moved for some other reason, and the row-relative frame survives the
 * list scrolling under us between samples.
 *
 * Five samples per row, so the two suspects are separated rather than conflated:
 *
 *   a  pointer parked off the row          (cold)
 *   b  pointer hovering the row            (b-a is the hover shift — a fixed defect; guards it)
 *   c  editing, pointer still on the row   (c-b is THE number this card is about)
 *   d  after Escape, still hovering        (d-b: does it come back?)
 *   e  pointer parked off again            (e-a: does the row end where it started?)
 *
 * Non-mutating: entering edit and pressing Escape exits without committing, and every row's text is
 * snapshotted before and after and diffed. A drive that types into someone's prose is worse than no
 * drive at all.
 */

const path = require('path');
const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SCENE = process.env.NLS_VERIFY_SCENE || 'First Day';
/** How far a glyph may move, in CSS px. Sub-pixel differences are line-box rounding, not motion. */
const TOLERANCE = 0.5;
/** Somewhere with no row under it. The title bar: a move there triggers no click and no hover state. */
const PARKED = { x: 6, y: 6 };
/** Viewport width for the wrapped-line phase — narrow enough that the fixture's prose takes two lines. */
const NARROW_WIDTH = 900;

const results = [];
function record(name, ok, detail) {
    results.push({ ok, name });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * One row's geometry, in the ROW's frame.
 *
 * `glyph` comes from a Range over the first non-blank text node under the body host, which is the only
 * thing here that is actually the text: the host box changes shape between the two modes by design
 * (that is what is being fixed), and reading its rect would measure the fix rather than the symptom.
 */
const MEASURE = function (blockId) {
    const row = document.querySelector('[data-story-row-block-id="' + blockId + '"]');
    if (!row) return null;
    const rowRect = row.getBoundingClientRect();
    const editor = row.querySelector('[contenteditable="true"]');
    const host = editor || row.querySelector('[data-story-row-text]');
    if (!host) return { editing: Boolean(editor), row: { height: rowRect.height }, host: null, cell: null, glyph: null };
    const hostRect = host.getBoundingClientRect();
    // The row's body CELL — the flex child that has to occupy the row box — as against `host`, the
    // thing the glyphs live in. In read mode they are the same element; in edit mode the host is the
    // `contentEditable` (~21px, sized by its own line) and the cell is `TextEditBox`'s container. A
    // first version of this scenario compared the contentEditable against the read-only cell and
    // reported a 7px box mismatch that was never a defect: those two are not supposed to match, and
    // the check stayed red through a fix that had already worked.
    const cell = editor ? editor.parentElement : host;
    const cellRect = cell.getBoundingClientRect();

    let glyph = null;
    let sample = '';
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        if (!rects.length) continue;
        glyph = {
            top: rects[0].top - rowRect.top,
            height: rects[0].height,
            left: rects[0].left,
            lines: rects.length,
        };
        sample = node.nodeValue.slice(0, 24);
        break;
    }
    return {
        editing: Boolean(editor),
        row: { height: rowRect.height },
        host: { top: hostRect.top - rowRect.top, height: hostRect.height, width: hostRect.width },
        cell: { top: cellRect.top - rowRect.top, height: cellRect.height, width: cellRect.width },
        glyph,
        sample,
    };
};

/** Every row's text, for the before/after diff that proves the drive changed nothing. */
const SNAPSHOT = function () {
    return Array.from(document.querySelectorAll('[data-story-row-block-id]'))
        .map(row => row.getAttribute('data-story-row-block-id') + '' + (row.innerText || '').replace(/\s+/g, ' ').trim());
};

/** Text rows worth measuring: they have a read-only body and something in it. */
const TEXT_ROWS = function () {
    return Array.from(document.querySelectorAll('[data-story-row-block-id]'))
        .map(row => {
            const body = row.querySelector('[data-story-row-text]');
            const text = body ? (body.innerText || '').trim() : '';
            return { id: row.getAttribute('data-story-row-block-id'), text };
        })
        .filter(row => row.text.length > 0);
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

/** Centre of the row's read-only body, having first scrolled the row into view. */
async function bodyPoint(d, blockId) {
    await A.call(d, function (id) {
        const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
        if (row) row.scrollIntoView({ block: 'center' });
        return Boolean(row);
    }, blockId);
    await A.sleep(500);
    return A.call(d, function (id) {
        const row = document.querySelector('[data-story-row-block-id="' + id + '"]');
        if (!row) return null;
        const body = row.querySelector('[data-story-row-text]');
        if (!body) return null;
        const r = body.getBoundingClientRect();
        // Left-of-centre: the trailing half of a short line is empty box, and the hover cluster sits at
        // the row's right edge. 24px in is on the glyphs of every row long enough to be worth measuring.
        const cx = Math.round(r.left + Math.min(24, r.width / 2));
        const cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return { cx, cy, reachable: Boolean(hit && (hit === body || body.contains(hit))) };
    }, blockId);
}

const round = value => (typeof value === 'number' ? Math.round(value * 100) / 100 : value);

/** The five-sample sequence for one row. See the header for what each letter is for. */
async function sampleRow(d, row) {
    const point = await bodyPoint(d, row.id);
    if (!point || !point.reachable) return null;

    await d.hover(PARKED.x, PARKED.y);
    const a = await A.call(d, MEASURE, row.id);

    await d.hover(point.cx, point.cy);
    await A.sleep(350);
    const b = await A.call(d, MEASURE, row.id);

    await d.click(point.cx, point.cy);
    await A.sleep(700);
    const c = await A.call(d, MEASURE, row.id);

    await d.keys('Escape');
    await A.sleep(600);
    const dd = await A.call(d, MEASURE, row.id);

    await d.hover(PARKED.x, PARKED.y);
    await A.sleep(350);
    const e = await A.call(d, MEASURE, row.id);

    return { row, a, b, c, d: dd, e };
}

function print(report) {
    console.log('');
    for (const entry of report) {
        const { row, a, b, c, d: dd, e } = entry;
        const glyph = m => (m && m.glyph ? m.glyph.top : null);
        const lines = m => (m && m.glyph ? m.glyph.lines : null);
        console.log(`row ${row.id.slice(0, 8)} ${JSON.stringify(row.text.slice(0, 28))}`);
        console.log(`   glyph top (row-relative)  cold=${round(glyph(a))}  hover=${round(glyph(b))}  editing=${round(glyph(c))}  escaped=${round(glyph(dd))}  cold2=${round(glyph(e))}`);
        console.log(`   body cell height          read=${round(b && b.cell && b.cell.height)}  editing=${round(c && c.cell && c.cell.height)}`);
        console.log(`   body cell width           read=${round(b && b.cell && b.cell.width)}  editing=${round(c && c.cell && c.cell.width)}`);
        console.log(`   rendered lines            read=${lines(b)}  editing=${lines(c)}`);
        console.log(`   row height                read=${round(b && b.row.height)}  editing=${round(c && c.row.height)}`);
    }
    console.log('');
}

/** Every assertion this card makes, over one phase's samples. */
function checkPhase(phase, report) {
    const measured = report.filter(entry => entry.a && entry.a.glyph && entry.c && entry.c.glyph);
    const worst = pick => round(Math.max(0, ...measured.map(entry => Math.abs(pick(entry)))));
    const offenders = (pick) => measured
        .map(entry => ({ id: entry.row.id, delta: pick(entry) }))
        .filter(entry => Math.abs(entry.delta) > TOLERANCE);
    const check = (name, pick, unit) => {
        const bad = offenders(pick);
        // Zero rows is a FAILURE, not a clean sweep. The first version reported "worst=0px" for every
        // check after a hot reload emptied the list mid-run — six greens over nothing measured, which is
        // exactly the shape of an acceptance that proves the opposite of what it claims.
        record(`[${phase}] ${name}`, measured.length > 0 && bad.length === 0,
            measured.length === 0
                ? 'NOTHING MEASURED'
                : bad.length === 0
                    ? `worst=${worst(pick)}${unit} over ${measured.length} rows`
                    : JSON.stringify(bad.map(entry => ({ id: entry.id.slice(0, 8), px: round(entry.delta) }))));
    };

    record(`[${phase}] every sampled row measured in both modes`,
        measured.length === report.length && report.length > 0, `measured=${measured.length}/${report.length}`);
    record(`[${phase}] clicking the body opened the row for editing`,
        report.length > 0 && report.every(entry => entry.c && entry.c.editing),
        `opened=${report.filter(entry => entry.c && entry.c.editing).length}/${report.length}`);
    record(`[${phase}] Escape closed the editor again`,
        report.length > 0 && report.every(entry => entry.d && !entry.d.editing),
        `closed=${report.filter(entry => entry.d && !entry.d.editing).length}/${report.length}`);

    // Split three ways on purpose. Hover and edit were two separate regressions with one symptom, and
    // a single "did the text move" number cannot say which one came back.
    check('hovering a row does not move its words', entry => entry.b.glyph.top - entry.a.glyph.top, 'px');
    check('opening a row for editing does not move its words', entry => entry.c.glyph.top - entry.b.glyph.top, 'px');
    check('opening a row for editing does not re-wrap its words', entry => entry.c.cell.width - entry.b.cell.width, 'px');
    check('the words are back where they started after Escape', entry => entry.e.glyph.top - entry.a.glyph.top, 'px');
    // The mechanism behind all of the above: read-only body and editor occupy the same cell. Asserted
    // separately so a future change that re-breaks the box is caught at its cause, not at its symptom.
    check('the editor cell is the same box as the read-only cell', entry => entry.c.cell.height - entry.b.cell.height, 'px');
    check('the row does not change height', entry => entry.c.row.height - entry.b.row.height, 'px');
}

async function main() {
    if (!process.env.NLS_VERIFY_PROJECT) throw new Error('set NLS_VERIFY_PROJECT to the project COPY this run may open');

    await withDriver({ target: 'workspace', port: PORT }, async (d) => {
        await A.assertVisible(d, A.WINDOWS.workspace, PID);
        await openScene(d);

        const before = await A.call(d, SNAPSHOT);
        const rows = await A.call(d, TEXT_ROWS);
        record('the scene rendered text rows to measure', rows.length >= 3, `textRows=${rows.length}`);
        if (rows.length === 0) throw new Error(`SETUP GUARD: scene "${SCENE}" has no text rows`);

        const report = [];
        for (const row of rows.slice(0, 6)) {
            const entry = await sampleRow(d, row);
            if (!entry) {
                // Almost always a hot reload that emptied the list under us, not a product defect —
                // say so, because "unreachable row" reads like one. Wait for the watcher to go quiet
                // (see dev-electron's log) before believing a run that reports this.
                record(`row ${row.id.slice(0, 6)} body is reachable`, false,
                    'covered, scrolled out of the virtualised list, or the window reloaded mid-run');
                continue;
            }
            report.push(entry);
        }
        print(report);

        checkPhase('single-line', report);

        // Phase 2: the same rows with the words wrapped.
        //
        // Measured against the unfixed build, this phase is GREEN — and that is the point of keeping it.
        // The defect only bites lines SHORTER than the row box: at three lines the editor's own content
        // (42px) already exceeds the box (28px), so collapsing to content and stretching to the box give
        // the same answer. So this is not a second instance of the bug, it is the guard that the fix does
        // not introduce one — `self-stretch` on a cell that is now the tallest thing in the row is
        // exactly where a careless box fix would start pushing wrapped text around.
        //
        // The viewport override is real layout (Chromium re-lays-out at the smaller width), not a style
        // hack, and it is cleared again below.
        await d.client.send('Emulation.setDeviceMetricsOverride', {
            width: NARROW_WIDTH, height: 900, deviceScaleFactor: 0, mobile: false,
        });
        await A.sleep(1500);
        const wrapped = await A.call(d, function () {
            return Array.from(document.querySelectorAll('[data-story-row-block-id]'))
                .map(row => {
                    const body = row.querySelector('[data-story-row-text]');
                    if (!body) return null;
                    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
                    let lines = 0;
                    while (walker.nextNode()) {
                        const node = walker.currentNode;
                        if (!node.nodeValue || !node.nodeValue.trim()) continue;
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        lines = range.getClientRects().length;
                        break;
                    }
                    return { id: row.getAttribute('data-story-row-block-id'), text: (body.innerText || '').trim(), lines };
                })
                .filter(row => row && row.lines >= 2);
        });
        record('narrowing the window wrapped some rows', wrapped.length > 0, `wrappedRows=${wrapped.length} at ${NARROW_WIDTH}px`);

        const wrapReport = [];
        for (const row of wrapped.slice(0, 3)) {
            const entry = await sampleRow(d, row);
            if (entry) wrapReport.push(entry);
        }
        print(wrapReport);
        checkPhase('wrapped', wrapReport);

        await d.client.send('Emulation.clearDeviceMetricsOverride');
        await A.sleep(1200);

        const after = await A.call(d, SNAPSHOT);
        const changed = after.filter((line, i) => before[i] !== line);
        record('the drive changed no row text', before.length === after.length && changed.length === 0,
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
