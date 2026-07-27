/*
 * Card -026 acceptance — the Dev Mode debug panel in two modes: docked (takes width off the stage,
 * which re-fits) and floating (sits over the stage, which is whole again).
 * Card: docs/plans/2026-07-26-026-task-dev-mode-panel-dock-float.md
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *     node tools/ui-verify/scenarios/u026-dev-mode-panel-dock-float.js
 *
 * The mode oracle is the TOGGLE'S ACCESSIBLE NAME, not the layout: the button names the action it
 * will perform ("Float panel" while docked, "Dock panel" while floating), the same way the debug FAB
 * names "Open/Close preview debug tools menu". Reading the mode off the layout instead would make
 * D-1/D-2 circular — they would be asserting the very measurement that told them which mode to
 * expect.
 *
 * Every float-mode check degrades to a red rather than an exception when the toggle is absent. That
 * is the whole point of calibrating on the pre-change tree: a scenario that throws on the old code
 * proves nothing about whether its assertions can discriminate.
 */

const A = require('../assert');
const D = require('./_drive');

const run = A.createRun();
const DOCKED_NAME = '^Float panel$';   // shown while DOCKED — clicking it floats the panel
const FLOATING_NAME = '^Dock panel$';  // shown while FLOATING — clicking it docks the panel

// --- page-side readers ---------------------------------------------------------------------------

/**
 * The stage's fit area, the stage box inside it, and the debug panel — read in ONE evaluation so the
 * three cannot be sampled at different layout moments (the panel animates its width on a 220ms
 * tween; two separate reads across that window disagree with each other and with the eye).
 *
 * `StageViewportFrame` styles itself inline and carries no class or data attribute, so the box is
 * found by SHAPE: a centring flex parent whose only child has `flex: none` and an explicit pixel
 * width/height. That child is the design-aspect box the game paints into; its PARENT is the area the
 * fit is computed against — the thing a docked panel takes width from and a floating one must not.
 */
const READ_LAYOUT = function () {
    let box = null;
    for (const el of Array.from(document.querySelectorAll('div'))) {
        const s = el.style;
        // `flex: none` set in React comes back off `.style.flex` as the normalised longhand
        // `0 0 auto`. Matching the shorthand string alone found nothing and the guard reported
        // "the stage never laid out" about a stage that was on screen the whole time.
        if (s.flex !== 'none' && s.flex !== '0 0 auto') continue;
        if (!/^\d+(\.\d+)?px$/.test(s.width || '') || !/^\d+(\.\d+)?px$/.test(s.height || '')) continue;
        const p = el.parentElement;
        if (!p) continue;
        if (p.style.justifyContent !== 'center' || p.style.alignItems !== 'center') continue;
        box = el;
        break;
    }
    const out = { win: { w: innerWidth, h: innerHeight }, stage: null, area: null, panel: null };
    if (box) {
        const br = box.getBoundingClientRect();
        const ar = box.parentElement.getBoundingClientRect();
        out.stage = { x: br.x, y: br.y, w: br.width, h: br.height };
        out.area = { x: ar.x, y: ar.y, w: ar.width, h: ar.height };
    }
    const panel = document.querySelector('[role="complementary"]');
    if (panel) {
        const r = panel.getBoundingClientRect();
        const surface = panel.classList.contains('nl-editor-surface')
            ? panel
            : (panel.querySelector('.nl-editor-surface') || panel);
        const cs = getComputedStyle(panel);
        let covering = null;
        if (out.stage) {
            const cx = Math.round(out.stage.x + out.stage.w / 2);
            const cy = Math.round(out.stage.y + out.stage.h / 2);
            const hit = document.elementFromPoint(cx, cy);
            covering = Boolean(hit && panel.contains(hit));
        }
        out.panel = {
            x: r.x, y: r.y, w: r.width, h: r.height,
            position: cs.position,
            label: panel.getAttribute('aria-label'),
            surfaceBg: getComputedStyle(surface).backgroundColor,
            coversStageCentre: covering,
        };
    }
    return out;
};

/** The dock/float toggle, identified by the accessible-name contract the card fixes. */
const READ_TOGGLE = function (dockedRe, floatingRe) {
    const panel = document.querySelector('[role="complementary"]');
    if (!panel) return { panelPresent: false };
    const controls = Array.from(panel.querySelectorAll('button, [role="button"], [role="switch"]'));
    const nameOf = (b) => (b.getAttribute('aria-label') || b.getAttribute('title')
        || (b.textContent || '').trim().replace(/\s+/g, ' '));
    const docked = new RegExp(dockedRe);
    const floating = new RegExp(floatingRe);
    const hit = controls.find((b) => docked.test(nameOf(b)) || floating.test(nameOf(b)));
    // Every visible control inside the panel must be named — the round just finished clearing these
    // out, and a new header control is exactly where a nameless icon button reappears.
    const nameless = controls.filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const role = b.getAttribute('role');
        if (b.closest('label') && (role === 'switch' || role === 'checkbox')) return false;
        return !(b.getAttribute('aria-label') || b.getAttribute('title')
            || b.getAttribute('aria-labelledby') || (b.textContent || '').trim());
    }).map((b) => String(b.className).slice(0, 60));
    if (!hit) {
        return { panelPresent: true, found: false, nameless, names: controls.map(nameOf).filter(Boolean) };
    }
    const r = hit.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2);
    const cy = Math.round(r.y + r.height / 2);
    const el = document.elementFromPoint(cx, cy);
    return {
        panelPresent: true,
        found: true,
        name: nameOf(hit),
        mode: floating.test(nameOf(hit)) ? 'float' : 'dock',
        cx, cy,
        reachable: Boolean(el && (el === hit || hit.contains(el) || el.contains(hit))),
        nameless,
    };
};

/**
 * A point on the panel's header strip that is NOT on top of a control — the place a human would grab
 * to move a floating panel. Grabbing blind at the header's centre lands on the snapshot `Select` in
 * this panel, and a drag that starts on a combobox is not a test of the panel's drag handle.
 */
const HEADER_GRAB = function (titleText) {
    const panel = document.querySelector('[role="complementary"]');
    if (!panel) return null;
    const title = Array.from(panel.querySelectorAll('*'))
        .find((e) => (e.textContent || '').trim() === titleText && e.children.length === 0);
    if (!title) return null;
    const header = title.parentElement;
    const r = header.getBoundingClientRect();
    const cy = Math.round(r.y + r.height / 2);
    for (let f = 0.05; f <= 0.95; f += 0.05) {
        const cx = Math.round(r.x + r.width * f);
        const el = document.elementFromPoint(cx, cy);
        if (!el || !header.contains(el)) continue;
        if (el.closest('button, [role="button"], [role="switch"], select, input, [role="combobox"], [role="listbox"]')) continue;
        return { cx, cy, header: { x: r.x, y: r.y, w: r.width, h: r.height } };
    }
    return { cx: null, cy: null, header: { x: r.x, y: r.y, w: r.width, h: r.height }, why: 'every sampled point on the header is a control' };
};

// --- helpers -------------------------------------------------------------------------------------

const inWindow = (b, win) => b.x >= -1 && b.y >= -1 && b.x + b.w <= win.w + 1 && b.y + b.h <= win.h + 1;
const fits = (box, area) => box.w <= area.w + 1 && box.h <= area.h + 1;
const round = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])) : o);

/** Click the toggle and wait for its accessible name to flip; returns the new reading. */
async function toggleMode(d, want) {
    const before = await A.call(d, READ_TOGGLE, DOCKED_NAME, FLOATING_NAME);
    if (!before.found) return before;
    if (before.mode === want) return before;
    if (!before.reachable) throw new Error(`SETUP GUARD: the mode toggle "${before.name}" has a rect but is covered`);
    await d.click(before.cx, before.cy);
    for (let i = 0; i < 20; i += 1) {
        await A.sleep(250);
        const now = await A.call(d, READ_TOGGLE, DOCKED_NAME, FLOATING_NAME);
        if (now.found && now.mode === want) { await A.sleep(500); return now; }
    }
    return A.call(d, READ_TOGGLE, DOCKED_NAME, FLOATING_NAME);
}

// --- the run -------------------------------------------------------------------------------------

(async () => {
    await D.driveToDevMode();

    await D.onWindow('dev-mode', A.WINDOWS.devmode, async (d) => {
        await D.openRuntimePanel(d);
        await A.sleep(900);

        // --- setup guards: prove the things being measured are actually there ---------------------
        const first = await A.call(d, READ_LAYOUT);
        if (!first.stage) throw new Error('SETUP GUARD: no StageViewportFrame box in the DOM — the stage never laid out');
        if (!(first.stage.w > 0 && first.stage.h > 0)) throw new Error(`SETUP GUARD: stage box has no size: ${JSON.stringify(first.stage)}`);
        if (!first.panel) throw new Error('SETUP GUARD: the runtime panel opened but has no [role="complementary"] box');
        if (first.panel.w <= 0) throw new Error(`SETUP GUARD: the panel box is 0 wide: ${JSON.stringify(first.panel)}`);

        const toggle0 = await A.call(d, READ_TOGGLE, DOCKED_NAME, FLOATING_NAME);
        run.check('D-5a', 'the panel header carries a mode toggle with an accessible name ("Float panel" / "Dock panel")',
            Boolean(toggle0.found), toggle0.found ? `${toggle0.name} (mode=${toggle0.mode}, reachable=${toggle0.reachable})`
                : `no match; panel controls named: ${JSON.stringify(toggle0.names || [])}`);
        run.check('D-5c', 'no visible control inside the panel lacks an accessible name',
            Array.isArray(toggle0.nameless) && toggle0.nameless.length === 0, toggle0.nameless || 'panel absent');

        // --- docked ------------------------------------------------------------------------------
        // Measured with or WITHOUT the toggle. The docked half is the behaviour the app already has
        // (U0-2), so these three have to be green on the pre-change tree — an assertion that has only
        // ever been seen red, because everything downstream of a missing control short-circuited, has
        // not been shown to measure anything at all. Only the FLOAT half legitimately needs a toggle.
        let dockedToggle = toggle0;
        if (toggle0.found) {
            dockedToggle = await toggleMode(d, 'dock');
            if (dockedToggle.mode !== 'dock') throw new Error(`SETUP GUARD: could not reach docked mode; toggle reads "${dockedToggle.name}"`);
            await A.sleep(700);
        }
        const docked = await A.call(d, READ_LAYOUT);
        await d.screenshot('u026-docked');

        run.check('D-1', 'docked: stage fit area + panel width == window width (the panel really takes space)',
            Math.abs(docked.area.w + docked.panel.w - docked.win.w) <= 2,
            `area=${Math.round(docked.area.w)} + panel=${Math.round(docked.panel.w)} = ${Math.round(docked.area.w + docked.panel.w)} vs win=${docked.win.w}`);
        run.check('D-3a', 'docked: stage box fits its area and sits inside the window',
            fits(docked.stage, docked.area) && inWindow(docked.stage, docked.win),
            `stage=${JSON.stringify(round(docked.stage))} area=${JSON.stringify(round(docked.area))} win=${JSON.stringify(docked.win)}`);
        run.check('D-8a', 'docked: the panel is an opaque reading surface',
            A.alphaOf(docked.panel.surfaceBg) === 1, `background=${docked.panel.surfaceBg}`);

        if (!toggle0.found) {
            for (const [id, text] of [
                ['D-2', 'floating: stage fit area == window width, panel still visible'],
                ['D-3b', 'floating: stage box fits its area and sits inside the window'],
                ['D-3c', 'the design aspect ratio is identical in both modes (a refit, not a crop or stretch)'],
                ['D-3d', 'floating gives the stage back the width the docked panel took'],
                ['D-4a', 'floating: dragging the header moves the panel by the drag delta'],
                ['D-4b', 'floating: a drag past the edge leaves the panel fully inside the window'],
                ['D-5b', 'the toggle flips both ways'],
                ['D-6a', 'float mode survives closing and reopening the panel'],
                ['D-6b', 'float mode survives a timeline jump (game-session remount)'],
                ['D-7', 'floating: the panel does not cover the centre of the stage it is debugging'],
                ['D-8b', 'floating: the panel is still an opaque reading surface'],
            ]) run.check(id, text, false, 'no mode toggle — the float half is unreachable');
            return;
        }

        // --- floating ----------------------------------------------------------------------------
        const floatToggle = await toggleMode(d, 'float');
        run.check('D-5b', 'the toggle flips both ways (docked -> floating -> docked)', floatToggle.mode === 'float',
            `after clicking "${dockedToggle.name}" the toggle reads "${floatToggle.name}"`);
        await A.sleep(900);
        const floating = await A.call(d, READ_LAYOUT);
        await d.screenshot('u026-floating');

        run.check('D-2', 'floating: the stage gets the whole window back, and the panel is still visible',
            Math.abs(floating.area.w - floating.win.w) <= 2 && floating.panel.w > 0,
            `area=${Math.round(floating.area.w)} vs win=${floating.win.w}; panel=${JSON.stringify(round(floating.panel))}`);
        run.check('D-3b', 'floating: stage box fits its area and sits inside the window',
            fits(floating.stage, floating.area) && inWindow(floating.stage, floating.win),
            `stage=${JSON.stringify(round(floating.stage))} area=${JSON.stringify(round(floating.area))}`);

        const aDock = docked.stage.w / docked.stage.h;
        const aFloat = floating.stage.w / floating.stage.h;
        run.check('D-3c', 'the design aspect ratio is identical in both modes (a refit, not a crop or a stretch)',
            Math.abs(aDock - aFloat) < 0.01, `docked=${aDock.toFixed(4)} floating=${aFloat.toFixed(4)}`);

        // Only meaningful while the docked stage is WIDTH-bound: in a window wide enough that height
        // is the binding constraint, giving the width back cannot make the stage any bigger, and
        // demanding it grow would be asserting against the fit algorithm rather than the panel.
        const widthBound = docked.area.w / docked.area.h < aDock;
        if (widthBound) {
            run.check('D-3d', 'floating gives the stage back the width the docked panel took',
                floating.stage.w > docked.stage.w + 1,
                `docked=${Math.round(docked.stage.w)}px floating=${Math.round(floating.stage.w)}px`);
        } else {
            run.note(`D-3d skipped: the docked stage is height-bound at this window size (area ${Math.round(docked.area.w)}x${Math.round(docked.area.h)}), so reclaiming width cannot change it`);
        }

        run.check('D-7', 'floating: the panel does not cover the centre of the stage it is debugging',
            floating.panel.coversStageCentre === false,
            `coversStageCentre=${floating.panel.coversStageCentre}; panel=${JSON.stringify(round(floating.panel))} stage=${JSON.stringify(round(floating.stage))}`);
        run.check('D-8b', 'floating: the panel is still an opaque reading surface',
            A.alphaOf(floating.panel.surfaceBg) === 1, `background=${floating.panel.surfaceBg}`);

        // --- dragging ----------------------------------------------------------------------------
        const grab = await A.call(d, HEADER_GRAB, 'Story Runtime');
        if (!grab || grab.cx === null) {
            const why = grab ? grab.why : 'no header found';
            run.check('D-4a', 'floating: dragging the header moves the panel by the drag delta', false, `no grab point: ${why}`);
            run.check('D-4b', 'floating: a drag past the edge leaves the panel fully inside the window', false, `no grab point: ${why}`);
        } else {
            const before = (await A.call(d, READ_LAYOUT)).panel;
            const dx = -220;
            const dy = 130;
            await d.drag(grab.cx, grab.cy, grab.cx + dx, grab.cy + dy);
            await A.sleep(600);
            const after = (await A.call(d, READ_LAYOUT)).panel;
            await d.screenshot('u026-floating-dragged');
            const movedX = after.x - before.x;
            const movedY = after.y - before.y;
            run.check('D-4a', 'floating: dragging the header moves the panel by the drag delta',
                Math.abs(movedX - dx) <= 8 && Math.abs(movedY - dy) <= 8,
                `asked (${dx},${dy}) got (${Math.round(movedX)},${Math.round(movedY)}); ${JSON.stringify(round(before))} -> ${JSON.stringify(round(after))}`);

            // Now shove it hard past the top-left corner: a floating panel that can be dragged out of
            // the window is the "floated but cannot be moved out of the way" failure with extra steps.
            const g2 = await A.call(d, HEADER_GRAB, 'Story Runtime');
            if (g2 && g2.cx !== null) {
                await d.drag(g2.cx, g2.cy, g2.cx - 1600, g2.cy - 1200);
                await A.sleep(600);
            }
            const shoved = (await A.call(d, READ_LAYOUT));
            await d.screenshot('u026-floating-shoved');
            run.check('D-4b', 'floating: a drag past the edge leaves the panel fully inside the window',
                inWindow(shoved.panel, shoved.win),
                `panel=${JSON.stringify(round(shoved.panel))} win=${JSON.stringify(shoved.win)}`);
        }

        // --- the mode is remembered ---------------------------------------------------------------
        await toggleMode(d, 'float');
        await A.sleep(400);
        await d.keys('Escape');
        await A.sleep(900);
        const closed = await A.call(d, function () { return Boolean(document.querySelector('[role="tablist"]')); });
        if (closed) {
            run.note('D-6a: Escape did not close the panel; reopening was not exercised');
        }
        await D.openRuntimePanel(d);
        await A.sleep(1200);
        const reopened = await A.call(d, READ_TOGGLE, DOCKED_NAME, FLOATING_NAME);
        const reopenedLayout = await A.call(d, READ_LAYOUT);
        run.check('D-6a', 'float mode survives closing and reopening the panel',
            reopened.found && reopened.mode === 'float'
                && Math.abs(reopenedLayout.area.w - reopenedLayout.win.w) <= 2,
            `toggle="${reopened.name}" area=${Math.round(reopenedLayout.area.w)} win=${reopenedLayout.win.w}`);

        // A timeline jump replaces the whole GameApp session. `activePanel` is owned by DevModeContent
        // precisely so the jump does not close the drawer it was made from; the mode has to live at
        // the same level or it silently resets under the user every time they jump.
        await D.selectTab(d, '^Timeline$');
        const row = await A.call(d, function () {
            const tabs = document.querySelector('[role="tablist"]');
            if (!tabs) return null;
            const rows = Array.from(tabs.parentElement.querySelectorAll('li, [data-timeline-row], [role="listitem"]'))
                .filter((el) => /^\d+\s/.test((el.innerText || '').replace(/\s+/g, ' ').trim()));
            const el = rows.find((e) => Number((e.innerText || '').trim().match(/^(\d+)/)[1]) === 10) || rows[0];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const cx = Math.round(r.x + r.width / 2);
            const cy = Math.round(r.y + r.height / 2);
            const hit = document.elementFromPoint(cx, cy);
            return { cx, cy, reachable: Boolean(hit && (el.contains(hit) || hit === el)) };
        });
        if (!row || !row.reachable) {
            run.check('D-6b', 'float mode survives a timeline jump (game-session remount)', false,
                row ? 'the timeline row has a rect but is covered' : 'no timeline rows to jump to');
        } else {
            await d.click(row.cx, row.cy);
            await A.sleep(3000);
            const afterJump = await A.call(d, READ_TOGGLE, DOCKED_NAME, FLOATING_NAME);
            const afterLayout = await A.call(d, READ_LAYOUT);
            await d.screenshot('u026-after-jump');
            run.check('D-6b', 'float mode survives a timeline jump (game-session remount)',
                afterJump.found && afterJump.mode === 'float'
                    && Math.abs(afterLayout.area.w - afterLayout.win.w) <= 2,
                `toggle="${afterJump.name}" area=${afterLayout.area ? Math.round(afterLayout.area.w) : null} win=${afterLayout.win.w}`);
        }
    });

    process.exitCode = run.summary().red > 0 ? 1 : 0;
})().catch((e) => {
    console.error('\nSCRIPT FAIL:', e.message);
    process.exit(1);
});
