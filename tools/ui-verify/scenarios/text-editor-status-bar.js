/*
 * Acceptance — text editor status-bar migration, EOL switching, encoding persistence, surface match.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *     node tools/ui-verify/scenarios/text-editor-status-bar.js \
 *       [--phase strip|placement|split|menu|selection|eol|persist|surface|padding|regress|all]
 *
 * Written before the implementation, same as the previous round. Criteria (the positions, the
 * bytes, the alpha) are frozen here; selectors may be adapted to the real DOM afterwards, and every
 * phase keeps a SETUP GUARD so a panel that never opened cannot print green.
 */

const fs = require('fs');
const path = require('path');
const A = require('../assert');
const D = require('./_drive');

const run = A.createRun();
const PROJECT = process.env.NLS_VERIFY_PROJECT;
const phase = (() => {
    const i = process.argv.indexOf('--phase');
    return i === -1 ? 'all' : process.argv[i + 1];
})();

const ASSET_NAME = 'status-bar-plan.md';

// --- page-side helpers -------------------------------------------------------------------------

const INSTALL_SERVICES = function () {
    if (window.__nlsSvc) return true;
    const root = document.getElementById('root');
    if (!root) return false;
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return false;
    const seen = new Set();
    const queue = [root[key]];
    while (queue.length) {
        const node = queue.shift();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const services = node.memoizedProps && node.memoizedProps.value
            && node.memoizedProps.value.context && node.memoizedProps.value.context.services;
        if (services && typeof services.get === 'function') { window.__nlsSvc = services; return true; }
        if (node.child) queue.push(node.child);
        if (node.sibling) queue.push(node.sibling);
        if (node.return && !seen.has(node.return)) queue.push(node.return);
    }
    return false;
};

/**
 * Every status-bar cell with its cluster and x position.
 *
 * Cluster membership is read geometrically rather than from the DOM tree, because the two clusters
 * are plain sibling divs with no identifying attribute: an entry belongs to whichever cluster
 * element contains it. Position within a cluster is what actually matters, so the raw
 * x ordering is what gets asserted — not the array order in the source, which is reversed on the
 * right and would let a wrong implementation pass by matching the code instead of the screen.
 */
const READ_STATUS_BAR = function () {
    const bar = document.querySelector('[data-status-bar]')
        || (document.querySelector('[data-status-bar-entry-id]') || {}).closest
            ? document.querySelector('[data-status-bar-entry-id]').closest('div.flex.items-stretch, div')
            : null;
    const cells = Array.from(document.querySelectorAll('[data-status-bar-entry-id]'));
    if (!cells.length) return { cells: [], barFound: Boolean(bar) };
    const mid = window.innerWidth / 2;
    return {
        barFound: true,
        cells: cells.map((el) => {
            const r = el.getBoundingClientRect();
            return {
                id: el.getAttribute('data-status-bar-entry-id'),
                text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
                x: Math.round(r.x),
                right: Math.round(r.x + r.width),
                cy: Math.round(r.y + r.height / 2),
                cx: Math.round(r.x + r.width / 2),
                side: r.x + r.width / 2 < mid ? 'left' : 'right',
            };
        }).sort((a, b) => a.x - b.x),
    };
};

async function openAssetsPanel(d) {
    const rendered = () => A.call(d, function () { return document.querySelectorAll('[data-asset-category]').length; });
    if (!(await rendered())) { await A.clickNamed(d, '[aria-label]', '^Assets$'); await A.sleep(1500); }
    if (!(await rendered())) throw new Error('SETUP GUARD: the Assets panel rendered no category sections');
}

/** Create the acceptance file through the service and open its tab, so every phase has a subject. */
async function ensureTextTab(d) {
    await A.call(d, INSTALL_SERVICES);
    const state = await A.call(d, async function (name) {
        const svc = window.__nlsSvc.get('assets');
        let asset = Object.values(svc.getAssets().other || {}).find((a) => a.name === name);
        if (!asset) {
            const r = await svc.createLocalAssetFromBytes('other', name, new Uint8Array(0));
            if (!r || !r.success) return { guard: JSON.stringify(r).slice(0, 200) };
            asset = r.data;
        }
        return { id: asset.id };
    }, ASSET_NAME);
    if (state.guard) throw new Error(`SETUP GUARD: could not create ${ASSET_NAME}: ${state.guard}`);

    const open = await A.call(d, function () {
        return document.querySelectorAll('.monaco-editor').length;
    });
    if (!open) {
        await openAssetsPanel(d);

        // Expand Other first. A collapsed section keeps its children in a `height:0;
        // overflow:hidden` box, and they go on returning perfectly ordinary rects from inside it -
        // one of these rows measured *above* its own header. Clicking those coordinates hits
        // whatever is really painted there, the click does nothing, and it reads exactly like
        // "clicking a text asset no longer opens it". That cost a wrong regression call.
        await A.call(d, function () {
            const header = document.querySelector('[data-asset-category="other"]');
            if (!header) return false;
            const body = header.parentElement && header.parentElement.children[1];
            if (body && body.getBoundingClientRect().height === 0) {
                const toggle = header.querySelector('button');
                if (toggle) toggle.click();
            }
            return true;
        });
        await A.sleep(700);

        const findRow = (name) => A.call(d, function (n) {
            const el = Array.from(document.querySelectorAll('*'))
                .find((e) => e.children.length === 0 && (e.textContent || '').trim() === n);
            if (!el) return { found: false };
            el.scrollIntoView({ block: 'center' });
            return { found: true };
        }, name);
        const measureRow = (name) => A.call(d, function (n) {
            const el = Array.from(document.querySelectorAll('*'))
                .find((e) => e.children.length === 0 && (e.textContent || '').trim() === n);
            if (!el) return { found: false };
            const r = el.getBoundingClientRect();
            const cx = Math.round(r.x + r.width / 2);
            const cy = Math.round(r.y + r.height / 2);
            const hit = document.elementFromPoint(cx, cy);
            // Strict on purpose: `hit.contains(el)` - the check the shared probe also accepts -
            // is true for any ancestor, so a clipped row inside a collapsed section passes it
            // while being invisible. Only the element itself or something inside it counts.
            return { found: true, cx, cy, reachable: Boolean(hit && (hit === el || el.contains(hit))) };
        }, name);

        if (!(await findRow(ASSET_NAME)).found) throw new Error(`SETUP GUARD: ${ASSET_NAME} is not in the sidebar`);
        await A.sleep(500);
        const row = await measureRow(ASSET_NAME);
        if (!row.reachable) throw new Error(`SETUP GUARD: ${ASSET_NAME} has a rect but nothing paints there — ${JSON.stringify(row)}`);
        await d.click(row.cx, row.cy);
        await A.sleep(2500);
    }
    if (!(await A.call(d, function () { return document.querySelectorAll('.monaco-editor').length; }))) {
        throw new Error('SETUP GUARD: no Monaco editor on screen');
    }
    return state.id;
}

function assetBytes(id) {
    const rootDir = path.join(PROJECT, 'assets', 'content');
    const bare = id.replace(/-/g, '');
    const stack = [rootDir];
    while (stack.length) {
        const dir = stack.pop();
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { stack.push(full); continue; }
            if (path.relative(rootDir, full).replace(/[\\/]/g, '') === bare) return fs.readFileSync(full);
        }
    }
    return null;
}

function metadataRecord(id) {
    const file = path.join(PROJECT, 'assets', 'assets.metadata.other.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'))[id] || null;
}

// --- phases -----------------------------------------------------------------------------------

/** §6.1 — the tab itself carries no bottom strip when no plugin contributes one. */
async function phaseStrip() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await ensureTextTab(d);
        const shape = await A.call(d, function () {
            const root = document.querySelector('[data-text-editor-tab-id]');
            if (!root) return null;
            const editor = root.querySelector('.monaco-editor');
            const rootR = root.getBoundingClientRect();
            const edR = editor.getBoundingClientRect();
            // The strip is not unconditionally gone: it comes back for a plugin contribution and for
            // a read/write error, which is where the error text now lives. Report which, so a red
            // here says whether the layout regressed or the file simply failed to load.
            const stripText = (root.innerText || '').replace((editor.innerText || ''), '').replace(/\s+/g, ' ').trim();
            return {
                gapBelowEditor: Math.round((rootR.y + rootR.height) - (edR.y + edR.height)),
                hasEncodingToken: Boolean(root.querySelector('[data-text-editor-encoding]')),
                pluginControls: root.querySelectorAll('[data-text-editor-preview-id], [data-text-editor-action-id]').length,
                residualText: stripText.slice(0, 80),
            };
        });
        if (!shape) throw new Error('SETUP GUARD: no text editor tab root on screen');
        run.check('S-1', 'the tab has no bottom strip of its own (editor reaches the bottom of the tab)',
            shape.gapBelowEditor <= 2,
            `${shape.gapBelowEditor}px below the editor; plugin controls ${shape.pluginControls}; residual "${shape.residualText}"`);
        run.check('S-2', 'the encoding control no longer lives inside the tab',
            shape.hasEncodingToken === false, `token inside tab: ${shape.hasEncodingToken}`);
        await d.screenshot('sb-tab-no-strip');
    });
}

/** §6.2 — filename at the right end of the left cluster; selection/eol/encoding nearest the centre on the right. */
async function phasePlacement() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await ensureTextTab(d);
        await A.sleep(800);
        const bar = await A.call(d, READ_STATUS_BAR);
        if (!bar.cells.length) throw new Error('SETUP GUARD: no [data-status-bar-entry-id] cells — add the hook or fix the selector');

        const left = bar.cells.filter((c) => c.side === 'left');
        const right = bar.cells.filter((c) => c.side === 'right');
        const fileCell = bar.cells.find((c) => c.text.indexOf(ASSET_NAME) >= 0);

        run.check('P-1', 'the file name is shown in the status bar', Boolean(fileCell),
            JSON.stringify(bar.cells.map((c) => `${c.id}@${c.x}`)));
        run.check('P-2', 'the file name is the RIGHTMOST cell of the left cluster',
            Boolean(fileCell) && left.length > 0 && left[left.length - 1].id === fileCell.id,
            `left cluster: ${left.map((c) => c.id).join(' | ')}`);

        // The three settings cells must be the leftmost of the right cluster, i.e. nearest centre,
        // and in this order reading outward from the centre: selection, eol, encoding.
        const firstThree = right.slice(0, 3).map((c) => c.id);
        run.check('P-3', 'selection, line ending and encoding are the three cells nearest the centre on the right',
            firstThree.length === 3
            && /selection|cursor/i.test(firstThree[0])
            && /eol|line-?ending/i.test(firstThree[1])
            && /encoding/i.test(firstThree[2]),
            `right cluster (centre → edge): ${right.map((c) => c.id).join(' | ')}`);
    });
}

/** §6.3 — activating a non-text tab removes all four cells. This is the one that catches a stale active-tab read. */
async function phaseSplit() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await ensureTextTab(d);
        await A.sleep(600);
        const withText = await A.call(d, READ_STATUS_BAR);
        const textCells = withText.cells.filter((c) => /encoding|eol|line-?ending|selection|cursor|file-?name/i.test(c.id));
        run.check('T-1', 'the four cells are present while a text tab is active', textCells.length === 4,
            JSON.stringify(textCells.map((c) => c.id)));

        const switched = await A.call(d, function () {
            const tabs = Array.from(document.querySelectorAll('[data-editor-tab-id]'));
            const other = tabs.find((t) => !/text-editor/.test(t.getAttribute('data-editor-tab-id') || ''));
            if (!other) return null;
            other.click();
            return other.getAttribute('data-editor-tab-id');
        });
        if (!switched) throw new Error('SETUP GUARD: no non-text tab to switch to — open one first');
        await A.sleep(1200);
        const without = await A.call(d, READ_STATUS_BAR);
        const leftover = without.cells.filter((c) => /encoding|eol|line-?ending|selection|cursor|file-?name/i.test(c.id));
        run.check('T-2', 'switching to a non-text tab removes all four',
            leftover.length === 0, JSON.stringify(leftover.map((c) => c.id)));
        await d.screenshot('sb-non-text-tab');
    });
}

/** §6.4 — the encoding menu opens upward and is fully on screen. */
async function phaseMenu() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await ensureTextTab(d);
        await A.sleep(600);
        const bar = await A.call(d, READ_STATUS_BAR);
        const cell = bar.cells.find((c) => /encoding/i.test(c.id));
        if (!cell) throw new Error('SETUP GUARD: no encoding cell in the status bar');
        await d.click(cell.cx, cell.cy);
        await A.sleep(800);
        const menu = await A.call(d, function () {
            const m = document.querySelector('[data-context-menu="true"]');
            if (!m) return null;
            const r = m.getBoundingClientRect();
            return {
                rows: Array.from(m.children).map((c) => (c.textContent || '').trim().slice(0, 30)),
                top: Math.round(r.y), bottom: Math.round(r.y + r.height),
                viewport: window.innerHeight,
            };
        });
        if (!menu) throw new Error('SETUP GUARD: clicking the encoding cell opened no menu');
        run.check('M-1', 'the menu offers reopen-with and save-with',
            menu.rows.filter((r) => /reopen|重新打开|save|保存/i.test(r)).length >= 2, JSON.stringify(menu.rows));
        run.check('M-2', 'the menu opens upward and is fully on screen (not clipped by the window edge)',
            menu.bottom <= menu.viewport && menu.top >= 0 && menu.top < cell.cy,
            `top=${menu.top} bottom=${menu.bottom} viewport=${menu.viewport} cell=${cell.cy}`);
        await d.screenshot('sb-encoding-menu');
        await d.keys('Escape');
    });
}

/** §6.5 — the selection cell counts selected characters. */
async function phaseSelection() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const id = await ensureTextTab(d);
        const rect = await A.call(d, function () {
            const el = document.querySelector('.monaco-editor .view-lines');
            const r = el.getBoundingClientRect();
            return { cx: Math.round(r.x + 30), cy: Math.round(r.y + 8) };
        });
        await d.click(rect.cx, rect.cy);
        await A.sleep(250);
        await d.keys('Ctrl+a');
        await A.sleep(200);
        await d.type('abcdefghij');
        await A.sleep(1200);

        const read = async () => {
            const bar = await A.call(d, READ_STATUS_BAR);
            const c = bar.cells.find((x) => /selection|cursor/i.test(x.id));
            return c ? c.text : null;
        };
        const noSelection = await read();
        await d.keys('Ctrl+a');
        await A.sleep(700);
        const withSelection = await read();

        run.check('X-1', 'with no selection the cell reads a caret position', Boolean(noSelection) && /\d/.test(noSelection), String(noSelection));
        run.check('X-2', 'selecting text makes the cell report the selected count',
            Boolean(withSelection) && withSelection !== noSelection && /10/.test(withSelection),
            `no-selection="${noSelection}" selected="${withSelection}"`);
        await d.screenshot('sb-selection');
        void id;
    });
}

/** §6.6 — switching the line ending changes the bytes on disk. */
async function phaseEol() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const id = await ensureTextTab(d);
        const rect = await A.call(d, function () {
            const el = document.querySelector('.monaco-editor .view-lines');
            const r = el.getBoundingClientRect();
            return { cx: Math.round(r.x + 30), cy: Math.round(r.y + 8) };
        });
        await d.click(rect.cx, rect.cy);
        await A.sleep(250);
        await d.keys('Ctrl+a');
        await d.type('line one\nline two\n');
        await A.sleep(2500);

        const before = assetBytes(id);
        run.check('L-0', 'a new file on Windows is written with the OS line ending',
            Boolean(before) && before.includes(Buffer.from([0x0d, 0x0a])),
            before ? [...before.slice(0, 12)].map((b) => b.toString(16)).join(' ') : 'no file');

        const bar = await A.call(d, READ_STATUS_BAR);
        const cell = bar.cells.find((c) => /eol|line-?ending/i.test(c.id));
        if (!cell) throw new Error('SETUP GUARD: no line-ending cell in the status bar');
        await d.click(cell.cx, cell.cy);
        await A.sleep(700);
        await A.clickNamed(d, '[data-context-menu="true"] > div', '^LF', { flags: 'i' });
        await A.sleep(2500);

        const after = assetBytes(id);
        run.check('L-1', 'switching to LF removes every CRLF from the bytes on disk',
            Boolean(after) && !after.includes(Buffer.from([0x0d, 0x0a])) && after.includes(0x0a),
            after ? [...after.slice(0, 12)].map((b) => b.toString(16)).join(' ') : 'no file');
        await d.screenshot('sb-eol-lf');
    });
}

/** §6.7 §6.8 — the chosen reading encoding is remembered, in the record, across a close and a restart. */
async function phasePersist() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const id = await ensureTextTab(d);
        const bar = await A.call(d, READ_STATUS_BAR);
        const cell = bar.cells.find((c) => /encoding/i.test(c.id));
        if (!cell) throw new Error('SETUP GUARD: no encoding cell');

        await d.click(cell.cx, cell.cy);
        await A.sleep(700);
        await A.clickNamed(d, '[data-context-menu="true"] > div', 'Save with', { flags: 'i' });
        await A.sleep(900);
        await A.clickNamed(d, '[data-context-menu="true"] > div', '^GBK$', { flags: 'i' });
        await A.sleep(2500);

        const record = metadataRecord(id);
        run.check('R-1', 'the chosen encoding is written into the asset record (so it travels through VCS)',
            Boolean(record) && /gbk/i.test(JSON.stringify(record)), JSON.stringify(record).slice(0, 200));

        // Close and reopen: the file must come back decoded, not as mojibake.
        await A.call(d, function () {
            const t = Array.from(document.querySelectorAll('[data-editor-tab-id]'))
                .find((e) => /text-editor/.test(e.getAttribute('data-editor-tab-id') || ''));
            const b = t && (t.querySelector('button:last-of-type') || t.querySelector('[aria-label]'));
            if (b) b.click();
        });
        await A.sleep(1200);
        await ensureTextTab(d);
        await A.sleep(1500);

        const state = await A.call(d, function () {
            const lines = document.querySelector('.monaco-editor .view-lines');
            const cells = Array.from(document.querySelectorAll('[data-status-bar-entry-id]'))
                .filter((e) => /encoding/i.test(e.getAttribute('data-status-bar-entry-id')));
            return {
                text: lines ? (lines.innerText || '').slice(0, 60) : '',
                lossy: lines ? (lines.innerText || '').indexOf('�') >= 0 : null,
                encoding: cells.length ? (cells[0].textContent || '').trim() : null,
            };
        });
        run.check('R-2', 'reopening the asset uses the remembered encoding, with no replacement characters',
            state.lossy === false && /gbk/i.test(state.encoding || ''), JSON.stringify(state));
        await d.screenshot('sb-reopened-remembered');
    });
}

/** §6.9 §6.10 — the editor surface matches the rest of the workspace, and the first line is not flush to the top. */
async function phaseSurface() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        await ensureTextTab(d);
        const m = await A.call(d, function () {
            const root = document.querySelector('[data-text-editor-tab-id]');
            const editor = root && root.querySelector('.monaco-editor');
            const lines = root && root.querySelector('.view-lines');
            const firstLine = lines && lines.firstElementChild;
            const alphaOf = (c) => {
                const m2 = /rgba?\(([^)]+)\)/.exec(c || '');
                if (!m2) return null;
                const parts = m2[1].split(',').map((s) => parseFloat(s));
                return parts.length > 3 ? parts[3] : 1;
            };
            const surface = document.querySelector('.nl-editor-surface');
            return {
                editorBg: editor ? getComputedStyle(editor).backgroundColor : null,
                editorAlpha: editor ? alphaOf(getComputedStyle(editor).backgroundColor) : null,
                storySurfaceAlpha: surface ? alphaOf(getComputedStyle(surface).backgroundColor) : null,
                surfaceOpacityVar: getComputedStyle(document.documentElement).getPropertyValue('--nl-editor-surface-opacity').trim(),
                topGap: (editor && firstLine)
                    ? Math.round(firstLine.getBoundingClientRect().y - editor.getBoundingClientRect().y)
                    : null,
            };
        });
        run.check('U-1', 'the first line is not flush against the top of the editor',
            m.topGap !== null && m.topGap >= 4, `${m.topGap}px`);
        run.check('U-2', 'the editor surface carries the workspace surface opacity rather than being a solid slab',
            m.surfaceOpacityVar === '1' || (m.editorAlpha !== null && m.editorAlpha < 1),
            JSON.stringify(m));
        run.note(`surface readings: ${JSON.stringify(m)}`);
        await d.screenshot('sb-surface');
    });
}

/** §5 — the properties the previous round verified must still hold. */
async function phaseRegress() {
    await D.onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const errors = await A.call(d, function () { return (window.__nlsErr || []).slice(0, 5); });
        run.check('G-1', 'no page errors collected while driving the text editor', errors.length === 0, JSON.stringify(errors));
        run.note('freeze + lossy-interlock regressions are driven by the previous round scenario');
    });
}

(async () => {
    const phases = {
        strip: phaseStrip, placement: phasePlacement, split: phaseSplit, menu: phaseMenu,
        selection: phaseSelection, eol: phaseEol, persist: phasePersist, surface: phaseSurface,
        regress: phaseRegress,
    };
    const order = phase === 'all'
        ? ['strip', 'placement', 'surface', 'selection', 'menu', 'eol', 'persist', 'split', 'regress']
        : [phase];
    for (const name of order) {
        if (!phases[name]) throw new Error(`unknown phase "${name}"`);
        console.log(`\n=== phase ${name} ===`);
        await phases[name]();
    }
    const { red } = run.summary();
    A.releaseWindows();
    process.exit(red ? 1 : 0);
})().catch((e) => {
    console.error(e);
    run.summary();
    A.releaseWindows();
    process.exit(2);
});
