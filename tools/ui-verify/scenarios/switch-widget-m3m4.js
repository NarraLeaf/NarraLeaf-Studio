/*
 * Acceptance for the switch's M3 (boolean value binding) and M4 (drag to toggle).
 *
 * Written BEFORE either implementation landed. What each half has to prove:
 *
 *  M3 - a `checked` bound to a Blueprint Value graph actually drives the widget. The assertion is
 *       deliberately end-to-end and contradictory-by-construction: the authored `props.checked` is
 *       FALSE while the bound graph returns TRUE, so a switch that renders checked can only have
 *       got there through the binding. Asserting that a binding record exists would prove nothing -
 *       the binding path was silently dead for weeks once already (StrictMode killed the store),
 *       and every check that looked at the document rather than the pixels passed throughout.
 *
 *  M4 - dragging past the halfway point toggles, dragging short of it does not, and a plain press
 *       with no movement still toggles. The third is the regression guard: the easiest way to ship
 *       drag-to-toggle is to break the click.
 *
 * Interaction lives in Dev Mode: the editor canvas builds a host adapter with no `blueprintRuntime`
 * (UISurfaceEditorTab.tsx), and the switch refuses to run interaction without one.
 *
 * Usage:
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<pid> node tools/ui-verify/scenarios/switch-widget-m3m4.js
 * The workspace must already be open on the project copy this run may write to, with Dev Mode
 * started AFTER the seed (it compiles from disk).
 */

const { withDriver } = require('../drive');
const A = require('../assert');

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SURFACE_NAME = process.env.NLS_VERIFY_SURFACE || 'Title';

const run = A.createRun();

function onWindow(target, title, fn) {
    return withDriver({ target, port: PORT }, async (d) => {
        const url = String(d.target && d.target.url);
        if (!url.includes(target)) {
            throw new Error(`asked for the "${target}" window and got ${url} - that window is not open`);
        }
        await A.assertVisible(d, title, PID);
        return fn(d);
    });
}

const SERVICES_SRC = `
function __services() {
    const host = document.querySelector('#root') || document.body.firstElementChild;
    const key = Object.keys(host || {}).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null;
    const seen = new Set();
    const queue = [host[key]];
    while (queue.length) {
        const fiber = queue.shift();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const services = fiber.memoizedProps && fiber.memoizedProps.value
            && fiber.memoizedProps.value.context && fiber.memoizedProps.value.context.services;
        if (services && typeof services.get === 'function') return services;
        if (fiber.child) queue.push(fiber.child);
        if (fiber.sibling) queue.push(fiber.sibling);
        if (fiber.return) queue.push(fiber.return);
    }
    return null;
}`;

/**
 * Seed two wide switches: one bound to a boolean graph that returns true, one plain.
 *
 * 200px wide on purpose. Travel is derived from the element box, and a 52px default would put the
 * "short drag" case within a few pixels of the click threshold - the M4b check would then be
 * measuring the threshold rather than the halfway rule.
 */
const SEED = new Function('surfaceName', `
${SERVICES_SRC}
const services = __services();
if (!services) return { ok: false, why: 'workspace services not reachable' };
const uidoc = services.get('uiDocument');
const doc = uidoc.getDocument();
const surface = Object.values(doc.surfaces || {}).find((s) => s.name === surfaceName);
if (!surface) return { ok: false, why: 'surface not found', have: Object.values(doc.surfaces || {}).map((s) => s.name) };
const rootId = surface.rootElementId;

const existing = Object.values(uidoc.getDocument().elements)
    .filter((e) => e.type === 'nl.switch' && e.parentId === rootId && Math.abs(e.layout.width) === 200);
let bound, plain;
if (existing.length >= 2) {
    bound = existing[0]; plain = existing[1];
} else {
    try {
        bound = uidoc.createElement(rootId, 'nl.switch', { x: 80, y: 300, width: 200, height: 48 });
        plain = uidoc.createElement(rootId, 'nl.switch', { x: 80, y: 380, width: 200, height: 48 });
    } catch (err) {
        return { ok: false, why: 'createElement threw: ' + (err && err.message) };
    }
}

// The contradiction that makes the M3 check mean something: authored false, bound graph true.
//
// Guarded so a re-run is a genuine no-op. Creating the binding and saving again on every run
// rewrites the document under a Dev Mode that is already running, and the running game goes blank
// until it is restarted - which then reads as "the widget disappeared" on the NEXT run rather than
// on the one that caused it. Cost an investigation once.
const alreadyBound = Boolean(
    bound.valueBindings && bound.valueBindings.checked && bound.valueBindings.checked.valueType === 'boolean'
);
let binding = null;
if (!alreadyBound) {
    try {
        binding = uidoc.ensureElementBlueprintValueBinding(bound.id, 'checked', {
            valueType: 'boolean',
            displayName: 'Bound checked',
            literalValue: true,
        });
    } catch (err) {
        return { ok: false, why: 'ensureElementBlueprintValueBinding threw: ' + (err && err.message) };
    }
}

const after = uidoc.getDocument().elements[bound.id];
const record = after && after.valueBindings && after.valueBindings.checked;
const report = {
    ok: true,
    reused: alreadyBound,
    boundId: bound.id,
    plainId: plain.id,
    authoredChecked: after.props && after.props.checked,
    bindingValueType: record && record.valueType,
    blueprintId: (binding && binding.blueprintId) || (record && record.blueprintId),
};
if (alreadyBound) {
    return report;
}
return Promise.resolve(uidoc.save(uidoc.getDocument())).then(function () { return report; });
`);

/** Every switch shell the running game shows, keyed so a specific one can be found. */
const LIVE = new Function(`
return Array.from(document.querySelectorAll('[role="switch"][data-ui-switch-checked]')).map((el) => {
    const wrapper = el.closest('[data-ui-element-id]');
    const r = el.getBoundingClientRect();
    return {
        id: wrapper ? wrapper.getAttribute('data-ui-element-id') : null,
        checked: el.getAttribute('aria-checked'),
        x: r.x, y: r.y, w: r.width, h: r.height,
        cy: Math.round(r.y + r.height / 2),
        leftX: Math.round(r.x + r.width * 0.12),
        rightX: Math.round(r.x + r.width * 0.88),
        nearX: Math.round(r.x + r.width * 0.30),
        onScreen: r.width > 0 && r.height > 0 && r.y >= 0 && r.y + r.height <= innerHeight,
    };
});
`);

async function findSwitch(d, id) {
    const all = await A.call(d, LIVE);
    return all.find((s) => s.id === id) || null;
}

/**
 * Poll for a switch instead of trusting one probe.
 *
 * Saving the document pushes an update into the running game, and a query landing mid-re-render
 * finds nothing - which reads exactly like "the widget is not there". A screenshot forces a paint,
 * so it is part of the retry rather than decoration. This check failed once for this reason on a
 * re-run of a scenario that had passed moments earlier.
 */
async function waitForSwitch(d, id, tries = 12) {
    let last = null;
    for (let i = 0; i < tries; i += 1) {
        last = await findSwitch(d, id);
        if (last && last.onScreen) return last;
        await d.screenshot('switch-m3m4-settle');
        await A.sleep(700);
    }
    return last;
}

async function main() {
    const seeded = await onWindow('workspace', A.WINDOWS.workspace, async (d) => {
        const result = await A.call(d, SEED, SURFACE_NAME);
        run.check('M0', 'two 200px switches seeded, one bound to a boolean graph', result.ok, result);
        if (!result.ok) throw new Error('setup guard failed: ' + JSON.stringify(result));
        run.check('M1', 'the binding was stored with valueType "boolean"',
            result.bindingValueType === 'boolean', result.bindingValueType);
        run.check('M2', 'the bound switch is authored OFF, so only the binding can turn it on',
            result.authoredChecked !== true, result.authoredChecked);
        return result;
    });

    await onWindow('dev-mode', A.WINDOWS.devmode, async (d) => {
        const bound = await waitForSwitch(d, seeded.boundId);
        const plain = await waitForSwitch(d, seeded.plainId);
        run.check('M3a', 'both seeded switches are on screen in the running game',
            Boolean(bound && bound.onScreen && plain && plain.onScreen), { bound, plain });
        if (!bound || !plain) throw new Error('seeded switches are not in the running game');

        // --- M3: the boolean binding drives the widget --------------------------------------------
        run.check('M3b', 'the bound switch renders CHECKED although its authored value is false',
            bound.checked === 'true', { authored: seeded.authoredChecked, rendered: bound.checked });
        run.check('M3c', 'the unbound switch beside it is still off (the binding is not global)',
            plain.checked === 'false', plain.checked);
        await d.screenshot('switch-m3-bound-on');

        // --- M4: drag past halfway toggles ---------------------------------------------------------
        run.check('M4a', 'the plain switch starts from off', plain.checked === 'false', plain.checked);
        await d.drag(plain.leftX, plain.cy, plain.rightX, plain.cy);
        let now = await findSwitch(d, seeded.plainId);
        run.check('M4b', 'dragging across the track toggles it on', now.checked === 'true', now.checked);
        await d.screenshot('switch-m4-after-drag');

        // --- M4: a short drag does not -------------------------------------------------------------
        // Back to off first, by the gesture we already proved works.
        await d.drag(now.rightX, now.cy, now.leftX, now.cy);
        now = await findSwitch(d, seeded.plainId);
        run.check('M4c', 'dragging back across turns it off again', now.checked === 'false', now.checked);

        await d.drag(now.leftX, now.cy, now.nearX, now.cy);
        now = await findSwitch(d, seeded.plainId);
        run.check('M4d', 'a drag that stops short of halfway does NOT toggle', now.checked === 'false', now.checked);

        // --- M4: a plain click still toggles (the regression this feature invites) -----------------
        await d.click(Math.round(now.x + now.w / 2), now.cy);
        await A.sleep(600);
        now = await findSwitch(d, seeded.plainId);
        run.check('M4e', 'a press with no movement still toggles (click not regressed)',
            now.checked === 'true', now.checked);
    });
}

main()
    .then(() => {
        const { red } = run.summary();
        A.releaseWindows();
        process.exit(red > 0 ? 1 : 0);
    })
    .catch((err) => {
        console.error(err);
        run.summary();
        A.releaseWindows();
        process.exit(1);
    });
