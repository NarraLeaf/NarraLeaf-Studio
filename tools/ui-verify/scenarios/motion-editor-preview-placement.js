/*
 * Acceptance: the Story Motion editor's stage preview stands where the motion says it stands.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *       node tools/ui-verify/scenarios/motion-editor-preview-placement.js
 *
 * The defect this exists for: picking a camera preset stamps out a motion asset, and every preset
 * keyframe writes offsets only (a shake is a relative nudge, not a teleport). The asset normalizer
 * handed those keyframes back with the unwritten axes present as `undefined`, the preview's
 * `{...neutral, ...keyframe}` merge let that erase the neutral alignment, and the frame rendered
 * `calc(NaN% + 0px)` — a declaration the browser discards, so the frame fell to its static position
 * and the `translate(-50%, 50%)` alone carried it into the stage's bottom-left corner. The motion
 * path drew at the centre the whole time, because it reads the keyframes with its own defaults.
 *
 * So the assertion is on the two numbers the browser actually computed: the frame's `left`/`bottom`
 * must be finite and must put the camera frame over the stage, and the drawn frame must sit where
 * the motion path's first dot does.
 */

const path = require('path');
const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SCENE = process.env.NLS_VERIFY_SCENE || 'Corridor';
const OUT = process.env.NLS_VERIFY_OUT || path.join(__dirname, '..', 'out');

const results = [];
function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function onWorkspace(fn) {
    return withDriver({ target: 'workspace', port: PORT, outDir: OUT, prefix: 'motion-preview-' }, async (d) => {
        await A.assertVisible(d, A.WINDOWS.workspace, PID);
        return fn(d);
    });
}

async function openScene(d) {
    const hasRows = await A.call(d, function () {
        return document.querySelectorAll('[data-story-row-block-id]').length;
    });
    if (hasRows > 0) return hasRows;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const outlineVisible = await A.call(d, function (name) {
            return [...document.querySelectorAll('span, div')]
                .some(e => e.children.length === 0
                    && (e.textContent || '').trim() === name
                    && e.getBoundingClientRect().width > 0);
        }, SCENE);
        if (outlineVisible) break;
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
            return { cx, cy, reachable: Boolean(target && (target === leaf || leaf.contains(target) || target.contains(leaf))) };
        }, SCENE);
    }
    if (!hit || !hit.reachable) throw new Error(`SETUP GUARD: scene "${SCENE}" never became clickable`);
    await d.click(hit.cx, hit.cy);
    await A.sleep(2500);
    const rows = await A.call(d, function () {
        return document.querySelectorAll('[data-story-row-block-id]').length;
    });
    if (rows === 0) throw new Error(`SETUP GUARD: scene "${SCENE}" rendered no rows`);
    return rows;
}

const FOCUS_SLOT = function () {
    const areas = [...document.querySelectorAll('textarea')];
    const area = areas.find(e => /narration|旁白/i.test(e.placeholder || ''))
        || (document.activeElement && document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null);
    if (!area) return false;
    area.focus();
    return document.activeElement === area;
};

const READ_SLOT = function () {
    const areas = [...document.querySelectorAll('textarea')];
    const area = areas.find(e => /narration|旁白/i.test(e.placeholder || ''))
        || (document.activeElement && document.activeElement.tagName === 'TEXTAREA' ? document.activeElement : null);
    return area ? area.value : null;
};

const ROW_IDS = function () {
    return [...document.querySelectorAll('[data-story-row-block-id]')].map(e => e.getAttribute('data-story-row-block-id'));
};

async function selectRow(d, blockId) {
    const hit = await A.call(d, function (id) {
        const row = document.querySelector(`[data-story-row-block-id="${id}"]`);
        if (!row) return null;
        row.scrollIntoView({ block: 'center' });
        const r = row.getBoundingClientRect();
        return { cx: Math.round(r.x + 40), cy: Math.round(r.y + r.height / 2) };
    }, blockId);
    if (!hit) throw new Error(`row ${blockId} not in the DOM`);
    await d.click(hit.cx, hit.cy);
    await A.sleep(1200);
}

async function commitCommand(d, line) {
    const before = await A.call(d, ROW_IDS);
    const lastId = before[before.length - 1];
    await selectRow(d, lastId);
    // Every row carries its own insert button, so this has to be scoped to the row we just selected:
    // a document-wide match lands on the first row's control and inserts in the wrong place.
    const insert = await A.call(d, function (id) {
        const row = document.querySelector(`[data-story-row-block-id="${id}"]`);
        const button = row && [...row.querySelectorAll('button[aria-label]')]
            .find(b => /^Insert/i.test(b.getAttribute('aria-label') || ''));
        if (!button) return null;
        button.scrollIntoView({ block: 'center' });
        const r = button.getBoundingClientRect();
        return { cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
    }, lastId);
    if (!insert) throw new Error('SETUP GUARD: the selected row has no insert button');
    await d.click(insert.cx, insert.cy);
    await A.sleep(700);
    if (!(await A.call(d, FOCUS_SLOT))) throw new Error('SETUP GUARD: no command slot appeared');
    await d.type(line);
    await A.sleep(900);
    const typed = await A.call(d, READ_SLOT);
    if (typed !== line) throw new Error(`SETUP GUARD: the slot holds ${JSON.stringify(typed)}, not ${JSON.stringify(line)}`);
    const settled = await A.call(d, ROW_IDS);
    await d.keys('Enter');
    await A.sleep(1800);
    const after = await A.call(d, ROW_IDS);
    const added = after.filter(id => !settled.includes(id));
    if (added.length !== 1) throw new Error(`expected exactly one new row for "${line}", got ${added.length}`);
    return added[0];
}

async function openProperties(d) {
    const open = function () {
        const heading = [...document.querySelectorAll('*')]
            .find(e => e.children.length === 0 && /^(Properties|属性)$/.test((e.textContent || '').trim()));
        if (!heading) return false;
        const panel = heading.closest('[class*="flex-col"]');
        return Boolean(panel && panel.getBoundingClientRect().height > 120);
    };
    if (await A.call(d, open)) return;
    await A.clickNamed(d, '[aria-label]', '^Properties$');
    await A.sleep(1200);
    if (!(await A.call(d, open))) throw new Error('SETUP GUARD: could not open the Properties panel');
}

/**
 * The motion editor tab's stage preview, measured from the browser's own computed values.
 *
 * The stage is the `#15171b` fixed-size box; the target frame is its `translate(-50%, 50%)` child.
 * Both are read as numbers in stage units so "is the frame over the stage" is arithmetic, not a
 * judgement about a picture.
 */
const PREVIEW_GEOMETRY = function () {
    // The stage box carries its colour as a Tailwind arbitrary class, not an inline style, and its
    // size inline — so match the class and read the size off `style`.
    // An editor tab that is open but not in front is display:none, and everything in it measures 0×0
    // — which would read as "the preview is missing" rather than "look at the tab in front".
    const stage = [...document.querySelectorAll('div')]
        .find(e => /15171b/i.test(e.className || '') && parseFloat(e.style.width) > 200 && parseFloat(e.style.height) > 200
            && e.getBoundingClientRect().width > 0);
    if (!stage) return null;
    const frame = [...stage.children].find(e => /translate\(-50%, 50%\)/.test((e.style || {}).transform || ''));
    if (!frame) return { stageFound: true, frameFound: false };
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    // The motion path is the only SVG drawn in stage coordinates; every other one here is a 24px icon.
    // Scoped to this preview's own wrapper, because a second motion editor tab left open behind this
    // one has an identical path svg that measures 0×0.
    const svg = [...(stage.parentElement ? stage.parentElement.querySelectorAll('svg') : [])]
        .find(s => (s.getAttribute('viewBox') || '').endsWith(`${Math.round(parseFloat(stage.style.width))} ${Math.round(parseFloat(stage.style.height))}`));
    const dot = svg ? svg.querySelector('circle') : null;
    const dotRect = dot ? dot.getBoundingClientRect() : null;
    return {
        stageFound: true,
        frameFound: true,
        stageSize: { w: Math.round(parseFloat(stage.style.width)), h: Math.round(parseFloat(stage.style.height)) },
        // The authored declarations - this is where `calc(NaN% + 0px)` used to be silently dropped.
        inlineLeft: frame.style.left,
        inlineBottom: frame.style.bottom,
        computedLeft: getComputedStyle(frame).left,
        computedBottom: getComputedStyle(frame).bottom,
        frameHasImage: Boolean(frame.querySelector('img')),
        // Everything below in on-screen px, so ratios are scale-independent.
        stageRect: { x: stageRect.x, y: stageRect.y, w: stageRect.width, h: stageRect.height },
        frameRect: { x: frameRect.x, y: frameRect.y, w: frameRect.width, h: frameRect.height },
        dotRect: dotRect ? { cx: dotRect.x + dotRect.width / 2, cy: dotRect.y + dotRect.height / 2 } : null,
    };
};

(async () => {
    await onWorkspace(async (d) => {
        const shots = [];
        await openScene(d);
        await openProperties(d);

        // ── the author's path: a camera transform row, then a motion preset ─────────────────────
        const id = await commitCommand(d, '/transform camera');
        await selectRow(d, id);
        // The camera transform inspector offers its pose as a Preset/Motion pair; a Story Motion is
        // the second, and it is the half that opens the preset gallery.
        await A.clickNamed(d, 'button', '^(Motion|动画)$');
        await A.sleep(1200);
        await A.clickNamed(d, 'button', '(Choose motion|选择动画)', { flags: 'i' });
        await A.sleep(1400);
        await A.clickNamed(d, 'button', '^(Presets|预设)$');
        await A.sleep(1200);
        shots.push(await d.screenshot('preset-gallery'));
        // Shake is the preset that matters here: its keyframes move offsets on BOTH axes, so a lost
        // alignment shows up in x and y at once.
        await A.clickNamed(d, 'button', '^(Shake|震动)$');
        await A.sleep(2400);

        // ── open the motion that was just stamped out ──────────────────────────────────────────
        // The pencil is an `InspectOnlyButton` (a `<span role="button">`, so a frozen workspace's
        // `<fieldset disabled>` cannot kill it) — a `button` selector does not see it.
        await A.clickNamed(d, '[aria-label]', '^(Edit motion|编辑动画)$');
        await A.sleep(2600);
        shots.push(await d.screenshot('motion-editor'));

        let geo = null;
        for (let attempt = 0; attempt < 10 && !(geo && geo.frameFound); attempt += 1) {
            geo = await A.call(d, PREVIEW_GEOMETRY);
            if (!(geo && geo.frameFound)) await A.sleep(800);
        }
        console.log(JSON.stringify(geo, null, 2));
        if (!geo || !geo.frameFound) {
            record('the motion editor draws a stage preview', false, JSON.stringify(geo));
        } else {
            const finite = !/NaN/.test(`${geo.inlineLeft} ${geo.inlineBottom}`)
                && geo.computedLeft !== 'auto' && geo.computedBottom !== 'auto';
            record('the frame\'s placement is a real length, not a dropped NaN declaration', finite,
                `left="${geo.inlineLeft}" → ${geo.computedLeft}; bottom="${geo.inlineBottom}" → ${geo.computedBottom}`);

            // A camera frame IS the stage rectangle, so the two should coincide horizontally and
            // overlap almost completely. The bug put the frame's centre on the stage's corner, i.e.
            // an overlap of a quarter and a left edge half a stage-width outside.
            const dx = (geo.frameRect.x - geo.stageRect.x) / geo.stageRect.w;
            const overlapW = Math.max(0, Math.min(geo.frameRect.x + geo.frameRect.w, geo.stageRect.x + geo.stageRect.w) - Math.max(geo.frameRect.x, geo.stageRect.x));
            const overlapH = Math.max(0, Math.min(geo.frameRect.y + geo.frameRect.h, geo.stageRect.y + geo.stageRect.h) - Math.max(geo.frameRect.y, geo.stageRect.y));
            const covered = (overlapW * overlapH) / (geo.stageRect.w * geo.stageRect.h);
            record('the camera frame sits over the stage, not in its corner',
                Math.abs(dx) < 0.02 && covered > 0.85,
                `leftEdgeOffset=${(dx * 100).toFixed(1)}% ofStageWidth, stageCovered=${(covered * 100).toFixed(1)}%`);

            if (geo.dotRect) {
                const fx = geo.frameRect.x + geo.frameRect.w / 2;
                const fy = geo.frameRect.y + geo.frameRect.h / 2;
                const gapX = Math.abs(fx - geo.dotRect.cx) / geo.stageRect.w;
                const gapY = Math.abs(fy - geo.dotRect.cy) / geo.stageRect.h;
                record('the drawn frame and the motion path agree on where the motion is',
                    gapX < 0.03 && gapY < 0.03,
                    `frameCentre=(${fx.toFixed(0)},${fy.toFixed(0)}) firstDot=(${geo.dotRect.cx.toFixed(0)},${geo.dotRect.cy.toFixed(0)}) gap=${(gapX * 100).toFixed(1)}%/${(gapY * 100).toFixed(1)}% of stage`);
            } else {
                record('the motion path is drawn', false, 'no keyframe dot found');
            }
        }

        console.log(`\nshots: ${shots.join(', ')}`);
        const failed = results.filter(r => !r.ok);
        console.log(`\n${results.length - failed.length}/${results.length} passed`);
        process.exitCode = failed.length === 0 ? 0 : 1;
    });
})();
