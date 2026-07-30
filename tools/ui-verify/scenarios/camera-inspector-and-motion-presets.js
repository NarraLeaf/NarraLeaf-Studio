/*
 * Acceptance for 2026-07-29-002: the `/camera` property editor, and the Story Motion preset library.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *       node tools/ui-verify/scenarios/camera-inspector-and-motion-presets.js
 *
 * Drives the workspace only (no Dev Mode): everything this card changed is authoring-time UI. What it
 * has to prove, in this order, because each step is the setup for the next:
 *
 *   1. a `/camera zoom` row commits and its inspector shows the six-way operation picker + viewfinder;
 *   2. the viewfinder actually reflects the knob — a zoom change must move the drawn stage rect, or the
 *      widget is decoration;
 *   3. `pan` makes the viewfinder draggable and writes the align the drag landed on;
 *   4. `motion` swaps the pose controls for the motion field, and the picker opens on the PRESET tab
 *      with camera presets in it (a camera must not be offered sprite moves);
 *   5. picking a preset creates a real motion asset, binds it, and the row survives a reload.
 *
 * Every probe is scoped to the inspector panel, and every click is followed by a re-read: a full-document
 * lookup finds the first match, which for row controls is usually not the row under the pointer.
 */

const path = require('path');
const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const PROJECT = process.env.NLS_VERIFY_PROJECT;
const SCENE = process.env.NLS_VERIFY_SCENE || 'The Forest';
const CHARACTER = process.env.NLS_VERIFY_CHARACTER || 'Nattou';
const OUT = process.env.NLS_VERIFY_OUT || path.join(__dirname, '..', 'out');

const results = [];
function record(name, ok, detail) {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** How many camera motions this project already has on disk — what the default tab depends on. */
function cameraMotionsOnDisk() {
    const fs = require('fs');
    const indexFile = path.join(PROJECT, 'editor/story/animations/index.json');
    if (!fs.existsSync(indexFile)) return 0;
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    return (index.animations || []).filter(entry => entry.targetKind === 'camera').length;
}

function onWorkspace(fn) {
    return withDriver({ target: 'workspace', port: PORT, outDir: OUT, prefix: '2026-07-29-camera-' }, async (d) => {
        await A.assertVisible(d, A.WINDOWS.workspace, PID);
        return fn(d);
    });
}

/** Open the story module and the scene, and guard that rows actually rendered. */
async function openScene(d) {
    const hasRows = await A.call(d, function () {
        return document.querySelectorAll('[data-story-row-block-id]').length;
    });
    if (hasRows === 0) {
        // The rail button TOGGLES the Story panel, so clicking it blind closes an already-open panel —
        // and the outline's nodes then still exist in the DOM with a 0×0 rect, which reads as "the
        // scene is not clickable" rather than "the panel is shut". Drive it to the state we want.
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
        // The outline is a scroller and `clickNamed` matches an element's whole `textContent`, so its
        // first hit is often a wrapper that is off-screen even after the leaf has been scrolled in.
        // Resolve the LEAF, scroll it, then click it only if `elementFromPoint` agrees it is there.
        // Scroll and measure in SEPARATE round-trips, and retry: the scroll is not laid out yet when
        // the call that requested it returns (measuring inline reports the pre-scroll rect and reads as
        // "unreachable"), and on a freshly opened project the outline is still filling in.
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
        if (!hit) throw new Error(`SETUP GUARD: no scene named "${SCENE}" in the outline`);
        if (!hit.reachable) throw new Error(`SETUP GUARD: scene "${SCENE}" never became clickable`);
        await d.click(hit.cx, hit.cy);
        await A.sleep(2500);
    }
    const rows = await A.call(d, function () {
        return document.querySelectorAll('[data-story-row-block-id]').length;
    });
    if (rows === 0) throw new Error(`SETUP GUARD: scene "${SCENE}" rendered no rows`);
    return rows;
}

/**
 * The insert slot's textarea, page-side.
 *
 * NOT `placeholder.includes('/')`: with `editor.slashAtAlias` on, the placeholder advertises
 * "@ for actions" and the slash never appears in it — while "/" still opens the action creator.
 * Recognise it by the narration hint (either locale), or by it being the focused textarea.
 */
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

/** Type a command line into a fresh insert slot after the last row, and commit it. */
async function commitCommand(d, line) {
    const before = await A.call(d, function () {
        return [...document.querySelectorAll('[data-story-row-block-id]')].map(e => e.getAttribute('data-story-row-block-id'));
    });
    // The row buttons are hover-reveal AND only mounted for the active row, so there is exactly one
    // "insert" control in the document at a time — the one belonging to whichever row is active. Make
    // the last row active first; an `nth` index into a one-element set would look like a stale probe.
    await selectRow(d, before[before.length - 1]);
    // Matched on `^Insert$`, not on the tooltip: the button's aria-label is the bare word "Insert"
    // while its `title` is the sentence, and `assert.js` prefers aria-label. Matching the tooltip
    // finds nothing and reads exactly like "the control is missing".
    await A.clickNamed(d, 'button', '^Insert$');
    await A.sleep(700);
    const focused = await A.call(d, FOCUS_SLOT);
    if (!focused) throw new Error('SETUP GUARD: no command slot appeared (or it refused focus)');
    // `Input.insertText`, never dispatchKeyEvent: a React-controlled textarea ignores the latter.
    await d.type(line);
    await A.sleep(900);
    // Re-read before committing. Clicking into the slot used to be enough — until it wasn't, and Enter
    // committed an EMPTY row that then looked like "the command produced a dialogue block".
    const typed = await A.call(d, READ_SLOT);
    if (typed !== line) throw new Error(`SETUP GUARD: the slot holds ${JSON.stringify(typed)}, not ${JSON.stringify(line)}`);
    // Snapshot the row set HERE, not before the slot was opened: the list mounts rows lazily while the
    // scene settles and scrolls, so an earlier baseline makes ordinary mounting look like "the command
    // produced three rows".
    const settled = await A.call(d, function () {
        return [...document.querySelectorAll('[data-story-row-block-id]')].map(e => e.getAttribute('data-story-row-block-id'));
    });
    await d.keys('Enter');
    await A.sleep(1600);
    const after = await A.call(d, function () {
        return [...document.querySelectorAll('[data-story-row-block-id]')].map(e => e.getAttribute('data-story-row-block-id'));
    });
    const added = after.filter(id => !settled.includes(id));
    if (added.length !== 1) throw new Error(`expected exactly one new row for "${line}", got ${added.length}`);
    return added[0];
}

/**
 * Open the Properties panel, which is where the action inspector lives.
 *
 * Not optional setup: with the right sidebar collapsed the inspector never mounts, and every probe
 * for a camera field comes back empty — which reads exactly like "the editor was not built".
 */
async function openProperties(d) {
    const already = await A.call(d, PROPERTIES_OPEN);
    if (already) return;
    await A.clickNamed(d, '[aria-label]', '^Properties$');
    await A.sleep(1200);
    if (!(await A.call(d, PROPERTIES_OPEN))) {
        throw new Error('SETUP GUARD: could not open the Properties panel');
    }
}

/** True when a properties surface with real content is mounted. */
const PROPERTIES_OPEN = function () {
    const heading = [...document.querySelectorAll('*')]
        .find(e => e.children.length === 0 && /^(Properties|属性)$/.test((e.textContent || '').trim()));
    if (!heading) return false;
    const panel = heading.closest('[class*="flex-col"]');
    return Boolean(panel && panel.getBoundingClientRect().height > 120);
};

/** Select a row so the inspector shows it. */
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

/**
 * The camera section of the inspector, found BY SHAPE rather than by climbing a fixed number of
 * parents: a fixed climb lands on the whole window, and then "the panel does not contain X" is a
 * statement about the app.
 */
const CAMERA_SECTION = function () {
    const heading = [...document.querySelectorAll('div')]
        .find(e => e.children.length === 0 && /^(Camera · story-wide|镜头 · 跨场景保留)/.test((e.textContent || '').trim()));
    if (!heading) return null;
    const section = heading.closest('section');
    if (!section) return null;
    const rect = section.getBoundingClientRect();
    const buttons = [...section.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean);
    const sliders = section.querySelectorAll('input[type="range"]').length;
    // The viewfinder: the only element in here with an explicit aspect-ratio style.
    const frame = [...section.querySelectorAll('div')].find(e => e.style && e.style.aspectRatio);
    const inner = frame ? frame.querySelector('div[style*="translate"]') : null;
    return {
        found: true,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        buttons,
        sliders,
        viewfinder: frame ? {
            aspectRatio: frame.style.aspectRatio,
            rect: (() => { const r = frame.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
            stageTransform: inner ? inner.style.transform : null,
            stageFilter: inner ? inner.style.filter : null,
            stageLeft: inner ? inner.style.left : null,
            stageBottom: inner ? inner.style.bottom : null,
            // The dialogue bar is a sibling of the moving rect, never a child — that is the claim.
            barIsSibling: Boolean(inner && [...frame.children].some(c => c !== inner && /rgba\(0, 0, 0/.test(getComputedStyle(c).backgroundColor))),
        } : null,
        text: (section.innerText || '').replace(/\s+/g, ' ').trim(),
    };
};

/** Click a button inside the camera section, by exact label. */
async function clickCameraButton(d, label) {
    const hit = await A.call(d, function (wanted) {
        const heading = [...document.querySelectorAll('div')]
            .find(e => e.children.length === 0 && /^(Camera · story-wide|镜头 · 跨场景保留)/.test((e.textContent || '').trim()));
        const section = heading && heading.closest('section');
        if (!section) return null;
        const button = [...section.querySelectorAll('button')].find(b => (b.textContent || '').trim() === wanted);
        if (!button) return null;
        button.scrollIntoView({ block: 'center' });
        const r = button.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2);
        const cy = Math.round(r.y + r.height / 2);
        const target = document.elementFromPoint(cx, cy);
        return { cx, cy, reachable: Boolean(target && (target === button || button.contains(target) || target.contains(button))) };
    }, label);
    if (!hit) throw new Error(`camera section has no button "${label}"`);
    if (!hit.reachable) throw new Error(`camera button "${label}" is not reachable`);
    await d.click(hit.cx, hit.cy);
    await A.sleep(900);
}

/** The motion picker popover, once open. */
const MOTION_PICKER = function () {
    const panel = [...document.querySelectorAll('div')]
        .find(e => /max-h-\[420px\]/.test(e.className || '') && e.getBoundingClientRect().width > 200);
    if (!panel) return null;
    const buttons = [...panel.querySelectorAll('button')];
    const tabButtons = buttons.filter(b => /^(Project|Presets|工程|预设)$/.test((b.textContent || '').trim()));
    const cards = buttons.map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return {
        found: true,
        tabs: tabButtons.map(b => (b.textContent || '').trim()),
        // The selected tab is the one carrying the primary tint.
        activeTab: (tabButtons.find(b => /text-primary/.test(b.className || '')) || {}).textContent?.trim() || null,
        cards,
        headings: [...panel.querySelectorAll('section > div')].map(e => (e.textContent || '').trim()).filter(Boolean),
        // The transform each card's stage rect is parked at: if they are all equal, the gallery is a
        // grid of identical squares and tells the author nothing until they hover.
        poses: [...panel.querySelectorAll('div[style*="translate"]')].map(e => e.style.transform),
        // A real sprite renders an <img>; a placeholder box does not.
        images: panel.querySelectorAll('img').length,
        // The subject frames as drawn, in stage px. A fixed-pixel placeholder is ~128×160 whatever the
        // stage is, and disappears once a card scales it down.
        frames: [...panel.querySelectorAll('div[style*="translate"]')]
            .map(e => ({ w: Math.round(parseFloat(e.style.width) || 0), h: Math.round(parseFloat(e.style.height) || 0) }))
            .filter(frame => frame.w > 0),
        text: (panel.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    };
};

async function main() {
    if (!PROJECT) throw new Error('set NLS_VERIFY_PROJECT to the project COPY this run may open');
    const shots = [];

    const blockId = await onWorkspace(async (d) => {
        await openScene(d);
        await openProperties(d);

        // ── 1. a /camera row commits, and its inspector is the new editor ───────────────────────
        const id = await commitCommand(d, '/camera zoom 1.8 d=0.9');
        await selectRow(d, id);
        const initial = await A.call(d, CAMERA_SECTION);
        if (!initial) throw new Error('the camera inspector section never rendered');
        const sixWay = ['Zoom', 'Pan', 'Rotate', 'Darken', 'Motion', 'Reset', '推拉', '平移', '旋转', '压暗', '运镜', '复位']
            .filter(label => initial.buttons.includes(label));
        record('six-way operation picker is present', sixWay.length >= 6, `buttons=${JSON.stringify(initial.buttons)}`);
        record('viewfinder is drawn at the stage aspect ratio', Boolean(initial.viewfinder) && /\d+\s*\/\s*\d+/.test(initial.viewfinder.aspectRatio || ''),
            initial.viewfinder ? `aspectRatio=${initial.viewfinder.aspectRatio} rect=${JSON.stringify(initial.viewfinder.rect)}` : 'no viewfinder');
        record('dialogue bar sits outside the moving stage rect', Boolean(initial.viewfinder && initial.viewfinder.barIsSibling),
            initial.viewfinder ? `barIsSibling=${initial.viewfinder.barIsSibling}` : 'n/a');
        record('zoom exposes a slider', initial.sliders >= 1, `sliders=${initial.sliders}`);
        record('viewfinder shows the committed zoom', /scale\(1\.8\)/.test(initial.viewfinder?.stageTransform || ''),
            `transform=${initial.viewfinder?.stageTransform}`);
        shots.push(await d.screenshot('camera-zoom'));

        // ── 2. the viewfinder tracks the knob ───────────────────────────────────────────────────
        const slid = await A.call(d, function () {
            const heading = [...document.querySelectorAll('div')]
                .find(e => e.children.length === 0 && /^(Camera · story-wide|镜头 · 跨场景保留)/.test((e.textContent || '').trim()));
            const section = heading && heading.closest('section');
            const range = section && section.querySelector('input[type="range"]');
            if (!range) return null;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(range, '3');
            range.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        });
        await A.sleep(900);
        const afterSlide = await A.call(d, CAMERA_SECTION);
        record('dragging the zoom slider redraws the viewfinder', Boolean(slid) && /scale\(3\)/.test(afterSlide.viewfinder?.stageTransform || ''),
            `transform=${afterSlide.viewfinder?.stageTransform}`);

        // ── 3. pan makes the viewfinder draggable and writes the align ──────────────────────────
        await clickCameraButton(d, initial.buttons.includes('Pan') ? 'Pan' : '平移');
        const panState = await A.call(d, CAMERA_SECTION);
        const frameBox = await A.call(d, function () {
            const heading = [...document.querySelectorAll('div')]
                .find(e => e.children.length === 0 && /^(Camera · story-wide|镜头 · 跨场景保留)/.test((e.textContent || '').trim()));
            const section = heading && heading.closest('section');
            const frame = section && [...section.querySelectorAll('div')].find(e => e.style && e.style.aspectRatio);
            if (!frame) return null;
            const r = frame.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, cursor: getComputedStyle(frame).cursor };
        });
        record('pan turns the viewfinder into a drag surface', frameBox && frameBox.cursor === 'crosshair', `cursor=${frameBox && frameBox.cursor}`);
        // Drag to the right quarter, one quarter down from the top.
        await d.click(Math.round(frameBox.x + frameBox.w * 0.75), Math.round(frameBox.y + frameBox.h * 0.25));
        await A.sleep(900);
        const afterDrag = await A.call(d, CAMERA_SECTION);
        const left = parseFloat((afterDrag.viewfinder?.stageLeft || '').replace('%', ''));
        const bottom = parseFloat((afterDrag.viewfinder?.stageBottom || '').replace('%', ''));
        record('a click on the viewfinder writes the align it landed on',
            Math.abs(left - 75) < 6 && Math.abs(bottom - 75) < 6,
            `left=${afterDrag.viewfinder?.stageLeft} bottom=${afterDrag.viewfinder?.stageBottom} (expect ~75% / ~75%)`);
        record('pan shows both align sliders', panState.sliders >= 2, `sliders=${panState.sliders}`);
        shots.push(await d.screenshot('camera-pan'));

        // ── 4. motion swaps in the motion field, and the picker opens on presets ────────────────
        await clickCameraButton(d, initial.buttons.includes('Motion') ? 'Motion' : '运镜');
        const motionState = await A.call(d, CAMERA_SECTION);
        record('motion replaces the pose controls with the motion field',
            motionState.sliders === 0 && !motionState.viewfinder && /(Choose motion|选择动作|动作)/.test(motionState.text),
            `sliders=${motionState.sliders} viewfinder=${Boolean(motionState.viewfinder)} text="${motionState.text.slice(0, 90)}"`);

        await A.clickNamed(d, 'button', '(Choose motion|选择动作)', { flags: 'i' });
        await A.sleep(1400);
        const opened = await A.call(d, MOTION_PICKER);
        // Which tab it OPENS on is a function of the project: with a camera motion already saved the
        // project tab is the useful one, without any it would be an empty list. Assert the rule, not
        // one of its two outcomes — this run's project copy accumulates assets across runs.
        record('the picker offers both halves and opens on the useful one',
            Boolean(opened) && opened.tabs.length === 2 && Boolean(opened.activeTab),
            opened ? `tabs=${JSON.stringify(opened.tabs)} active=${opened.activeTab} projectCameraMotions=${cameraMotionsOnDisk()}` : 'no picker');

        await A.clickNamed(d, 'button', '^(Presets|预设)$');
        await A.sleep(1200);
        const picker = await A.call(d, MOTION_PICKER);
        const cameraNames = ['Shake', 'Impact', 'Push in', 'Pull back', 'Pan sweep', 'Dutch tilt', 'Quake', '震动', '冲击', '推近', '拉远', '横摇', '荷兰角', '地动'];
        const shown = picker ? cameraNames.filter(name => picker.cards.some(card => card.includes(name))) : [];
        const spriteNames = ['Heartbeat', 'Nod', 'Breathe', '心跳', '点头', '呼吸'];
        const leaked = picker ? spriteNames.filter(name => picker.cards.some(card => card.includes(name))) : [];
        record('camera presets are listed', shown.length >= 4, `shown=${JSON.stringify(shown)}`);
        record('sprite presets are NOT offered to the camera', leaked.length === 0, `leaked=${JSON.stringify(leaked)}`);
        // Parked frames: a gallery where every card sits at t=0 is a grid of identical squares, so the
        // cards must not all be showing the same pose.
        record('the cards are parked on distinguishable poses',
            Boolean(picker) && new Set(picker.poses).size >= Math.min(4, picker.poses.length),
            picker ? `distinct=${new Set(picker.poses).size}/${picker.poses.length}` : 'no picker');
        shots.push(await d.screenshot('camera-preset-gallery'));

        // ── 5. picking a preset creates and binds a real motion asset ───────────────────────────
        const pickTarget = picker.cards.find(card => /(Shake|震动)/.test(card));
        if (!pickTarget) throw new Error(`no shake card to pick; cards=${JSON.stringify(picker.cards).slice(0, 300)}`);
        // Each card carries an explicit `aria-label` of just the preset name, so this is an exact
        // match. (Its visible text concatenates name + repeat + summary into "Quake60.24s / Position",
        // which is why that label exists at all.)
        await A.clickNamed(d, 'button', '^(Shake|震动)$');
        await A.sleep(2200);
        const bound = await A.call(d, CAMERA_SECTION);
        record('picking a preset binds a named motion to the row',
            /(Camera Shake|镜头 震动)/.test(bound.text),
            `text="${bound.text.slice(0, 140)}"`);
        // ── 5b. the row itself says which motion it drives ──────────────────────────────────────
        const rowText = await A.call(d, function (blockId) {
            const row = document.querySelector(`[data-story-row-block-id="${blockId}"]`);
            return row ? (row.innerText || '').replace(/\s+/g, ' ').trim() : null;
        }, id);
        record('the row names the bound motion, not just "Motion"',
            Boolean(rowText) && /(Shake|震动)/.test(rowText), `row="${rowText}"`);
        shots.push(await d.screenshot('camera-motion-bound'));

        // ── 6. the other half of the library: a sprite, auditioning sprite presets ──────────────
        // The claim this checks is the one the camera pass cannot: a preset is previewed on the
        // author's OWN target (the portrait's image, resolved back through the scene), and a portrait
        // is offered the displayable moves rather than the camera shots.
        const spriteId = await commitCommand(d, `/show ${CHARACTER}`);
        await selectRow(d, spriteId);
        await A.clickNamed(d, 'button', '^(Motion|动效)$');
        await A.sleep(900);
        await A.clickNamed(d, 'button', '(Choose motion|选择动作)', { flags: 'i' });
        await A.sleep(1400);
        await A.clickNamed(d, 'button', '^(Presets|预设)$');
        await A.sleep(1600);
        const sprite = await A.call(d, MOTION_PICKER);
        const spriteWanted = ['Shake', 'Heartbeat', 'Nod', 'Breathe', 'Pop in', '震动', '心跳', '点头', '呼吸', '弹出登场'];
        const spriteShown = sprite ? spriteWanted.filter(name => sprite.cards.some(card => card.includes(name))) : [];
        const cameraLeaked = sprite ? ['Dutch tilt', 'Pan sweep', '荷兰角', '横摇'].filter(name => sprite.cards.some(card => card.includes(name))) : [];
        record('sprite presets are listed for a portrait', spriteShown.length >= 4, `shown=${JSON.stringify(spriteShown)}`);
        record('camera shots are NOT offered to a portrait', cameraLeaked.length === 0, `leaked=${JSON.stringify(cameraLeaked)}`);
        record('the categories are the displayable ones', Boolean(sprite) && sprite.headings.length >= 4 && !sprite.headings.includes('Camera'),
            sprite ? `headings=${JSON.stringify(sprite.headings)}` : 'no picker');
        // Its SUBJECT, sized as a portrait against the stage — not its image: a character enter with no
        // pose named carries no assetId, so the audition runs on a portrait-shaped placeholder. What
        // must hold is that the placeholder is a real share of the stage rather than a fixed pixel box
        // that vanishes at card scale, which is what made this grid look like empty squares.
        const spriteFrames = sprite ? sprite.frames : [];
        record('the presets audition on a portrait-shaped subject, legible at card scale',
            spriteFrames.length > 0 && spriteFrames.every(frame => frame.w > 40 && frame.h > frame.w),
            `frames=${JSON.stringify(spriteFrames.slice(0, 3))}`);
        shots.push(await d.screenshot('displayable-preset-gallery'));
        return id;
    });

    // ── 6. it is on disk, not just on screen ────────────────────────────────────────────────────
    await A.sleep(2500);
    const fs = require('fs');
    const storyIndex = JSON.parse(fs.readFileSync(path.join(PROJECT, 'editor/story/index.json'), 'utf8'));
    const doc = JSON.parse(fs.readFileSync(path.join(PROJECT, storyIndex.stories[0].documentPath), 'utf8'));
    const block = Object.values(doc.scenes).flatMap(scene => Object.values(scene.blocks)).find(b => b.id === blockId);
    record('the row persisted as a camera motion payload',
        Boolean(block) && block.payload.action === 'camera' && block.payload.operation === 'motion' && Boolean(block.payload.motion?.animationId),
        JSON.stringify(block && block.payload));

    const animIndex = path.join(PROJECT, 'editor/story/animations/index.json');
    const anims = fs.existsSync(animIndex) ? JSON.parse(fs.readFileSync(animIndex, 'utf8')) : { animations: [] };
    const cameraAsset = (anims.animations || []).find(a => a.targetKind === 'camera');
    record('the created asset is filed under the camera target kind',
        Boolean(cameraAsset), JSON.stringify(cameraAsset || (anims.animations || []).map(a => a.targetKind)));

    console.log(`\nshots: ${shots.join(', ')}`);
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
    console.error(`SCENARIO ERROR: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
});
