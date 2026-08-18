/*
 * Acceptance for the `nl.switch` widget.
 *
 * Written BEFORE the implementation landed, so the checks cannot be reverse-defined by whatever
 * the code happens to do. The four things this has to prove, and why each one is here:
 *
 *  1. BOTH REGISTRIES. A widget registered only in `BuiltinWidgetModules` inserts, selects and
 *     edits perfectly while painting nothing at all. So the canvas check asserts the two PARTS
 *     have non-zero rects on the editor canvas - not that the switch element exists in the DOM.
 *  2. THE `on` VARIANT IS REAL. The whole design rests on the parts carrying a second appearance
 *     variant that the renderer flips to. `createInitialContainerAppearance` only ever produces
 *     one variant, so this is exactly the sort of thing that silently ends up absent.
 *  3. THE TRAVEL ANIMATES THE THUMB. Read the thumb's COMPUTED transform in both states. The
 *     document saying `transformOffsetX: 24` proves nothing about what got painted.
 *  4. TWO SWITCHES ARE INDEPENDENT. `scopedWidgetRuntimeKey` has no instance dimension; the list
 *     round proved that "the right number of rows, all showing the same thing" is what a
 *     shared-key bug looks like. One switch that toggles is not evidence.
 *
 * Interaction lives in Dev Mode, not on the editor canvas: `UISurfaceEditorTab` builds a host
 * adapter with no `blueprintRuntime` (UISurfaceEditorTab.tsx:399), and the switch - like the
 * slider - refuses to run interaction without one. A run that "could not click the switch on the
 * canvas" is therefore reporting the intended contract, not a defect.
 *
 * Usage:
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> node tools/ui-verify/scenarios/switch-widget.js
 * The instance must already be in the workspace of the project copy this run may write to.
 */

const { withDriver } = require("../drive");
const A = require("../assert");

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const SURFACE_NAME = process.env.NLS_VERIFY_SURFACE || "Title";

const run = A.createRun();

/**
 * `findMatchingTarget` in `project/app/cdp.js` ends with `?? targets[0]`, so asking for a window
 * that is not open hands back whatever is first and every check afterwards runs against the wrong
 * page while reporting success. Assert the url actually names the window before touching it.
 */
function onWindow(target, title, fn) {
  return withDriver({ target, port: PORT }, async (d) => {
    const url = String(d.target && d.target.url);
    if (!url.includes(target)) {
      throw new Error(`asked for the "${target}" window and got ${url} — that window is not open`);
    }
    await A.assertVisible(d, title, PID);
    return fn(d);
  });
}

// --- reaching the workspace services from inside the page -----------------------------------------

/**
 * BFS the fiber tree for the workspace context. Inlined into every page function that needs it
 * because CDP can only hand back JSON - a service handle cannot cross the boundary, so everything
 * that touches a service has to happen inside one evaluate.
 */
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

/** Seed three switches on the named surface and report what the document now holds. */
const SEED = new Function(
  "surfaceName",
  `
${SERVICES_SRC}
const services = __services();
if (!services) return { ok: false, why: 'workspace services not reachable from the fiber tree' };
const uidoc = services.get('uiDocument');
if (!uidoc) return { ok: false, why: 'uiDocument service missing' };
const doc = uidoc.getDocument();
const surface = Object.values(doc.surfaces || {}).find((s) => s.name === surfaceName);
if (!surface) return { ok: false, why: 'surface "' + surfaceName + '" not found', have: Object.values(doc.surfaces || {}).map((s) => s.name) };
const rootId = surface.rootElementId;

// Idempotent: a re-run must not stack switches on top of the previous run's.
const existing = Object.values(uidoc.getDocument().elements)
    .filter((e) => e.type === 'nl.switch' && e.parentId === rootId);
if (existing.length >= 3) {
    return { ok: true, reused: true, surfaceId: surface.id, ids: existing.slice(0, 3).map((e) => e.id) };
}

const ids = [];
try {
    for (let i = 0; i < 3; i += 1) {
        const el = uidoc.createElement(rootId, 'nl.switch', { x: 80 + i * 120, y: 420, width: 52, height: 28 });
        ids.push(el.id);
    }
    // The third one is the "interaction disabled" case.
    const third = uidoc.getDocument().elements[ids[2]];
    uidoc.updateElementProps(ids[2], Object.assign({}, third.props, { interactionDisabled: true }));
} catch (err) {
    return { ok: false, why: 'createElement threw: ' + (err && err.message), ids };
}
// Dev Mode compiles from what is on disk, so an unsaved seed would have the run drive the page
// as it was before this function ran - and every Dev Mode check would be about the wrong page.
return Promise.resolve(uidoc.save(uidoc.getDocument()))
    .then(function () { return { ok: true, reused: false, saved: true, surfaceId: surface.id, ids }; })
    .catch(function (err) { return { ok: false, why: 'save threw: ' + (err && err.message), ids }; });
`
);

/** Structural report on one switch: its parts, their slots, and their appearance variants. */
const INSPECT = new Function(
  "switchId",
  `
${SERVICES_SRC}
const services = __services();
if (!services) return { ok: false, why: 'services unreachable' };
const doc = services.get('uiDocument').getDocument();
const el = doc.elements[switchId];
if (!el) return { ok: false, why: 'switch element gone' };

function rowValue(part, variantId, key) {
    const appearance = part.props && part.props.appearance;
    if (!appearance) return { missing: 'appearance' };
    const variant = (appearance.variants || []).find((v) => v.id === variantId);
    if (!variant) return { missing: 'variant:' + variantId };
    const group = (variant.propertyGroups || []).find((g) => g.key === key);
    if (!group) return { missing: 'group:' + key };
    const row = (group.rows || [])[0];
    return { value: row && row.value, hasTransition: Boolean(group.transition) };
}

const children = (el.childrenIds || []).map((id) => doc.elements[id]).filter(Boolean);
const track = children.find((c) => c.extra && c.extra.switchSlot === 'track');
const thumb = children.find((c) => c.extra && c.extra.switchSlot === 'thumb');
return {
    ok: true,
    checked: el.props && el.props.checked,
    interactionDisabled: el.props && el.props.interactionDisabled,
    childCount: children.length,
    childTypes: children.map((c) => c.type),
    trackId: track && track.id,
    thumbId: thumb && thumb.id,
    propsPointAtParts: Boolean(el.props && el.props.trackElementId === (track && track.id)
        && el.props.thumbElementId === (thumb && thumb.id)),
    trackVariantIds: track ? (track.props.appearance.variants || []).map((v) => v.id) : null,
    thumbVariantIds: thumb ? (thumb.props.appearance.variants || []).map((v) => v.id) : null,
    trackOffColour: track ? rowValue(track, 'default', 'backgroundColor') : null,
    trackOnColour: track ? rowValue(track, 'on', 'backgroundColor') : null,
    thumbOffTravel: thumb ? rowValue(thumb, 'default', 'transformOffsetX') : null,
    thumbOnTravel: thumb ? rowValue(thumb, 'on', 'transformOffsetX') : null,
};
`
);

/**
 * Painted geometry and chrome of one element id.
 *
 * The node carrying `data-ui-element-id` is `EditorNodeWrapper`'s div, and it paints NOTHING: it is
 * transparent with `transform: none`. `RectangleChromeRenderer` puts the appearance model's
 * `transformOffsetX` and `backgroundColor` on motion.divs two to four levels below it. Reading the
 * id-bearing node therefore reports "the thumb never moved, the track never changed colour" for a
 * widget that is doing both — which is exactly what this check said on its first run.
 *
 * So: rect from the id-bearing node, chrome from the nearest descendant that actually has it.
 */
const PAINTED = new Function(
  "elementId",
  `
const nodes = Array.from(document.querySelectorAll('[data-ui-element-id="' + elementId + '"]'));
if (!nodes.length) return { painted: false, count: 0 };
// The canvas and the panel thumbnail both render the same element id. Take the widest one: the
// editor canvas is full size, the card preview is a few dozen pixels. Probing the thumbnail by
// accident is a documented way to "prove" a layout that is not the one under test.
const best = nodes
    .map((n) => ({ n, r: n.getBoundingClientRect() }))
    .sort((a, b) => b.r.width - a.r.width)[0];
const subtree = [best.n].concat(Array.from(best.n.querySelectorAll('*')));
const transformed = subtree.find((n) => {
    const t = getComputedStyle(n).transform;
    return t && t !== 'none';
});
const filled = subtree.find((n) => {
    const bg = getComputedStyle(n).backgroundColor;
    return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
});
return {
    painted: best.r.width > 0 && best.r.height > 0,
    count: nodes.length,
    w: Math.round(best.r.width),
    h: Math.round(best.r.height),
    transform: transformed ? getComputedStyle(transformed).transform : 'none',
    backgroundColor: filled ? getComputedStyle(filled).backgroundColor : 'none',
};
`
);

/**
 * The switch shells the running game is showing, by aria state.
 *
 * NOT a bare `[role="switch"]`: Studio's own `Switch` control renders that too, so with the
 * inspector open on a selected switch the two authoring toggles join the list and shift every
 * index - `switch#0` would then be a control in the properties panel. `data-ui-switch-checked`
 * is on the widget root and nowhere else.
 */
const LIVE_SWITCHES = new Function(`
const els = Array.from(document.querySelectorAll('[role="switch"][data-ui-switch-checked]'));
return els.map((el) => {
    const r = el.getBoundingClientRect();
    return {
        id: el.getAttribute('data-ui-element-id') || null,
        checked: el.getAttribute('aria-checked'),
        disabled: el.getAttribute('aria-disabled'),
        x: r.x, y: r.y, w: r.width, h: r.height,
        cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2),
        onScreen: r.width > 0 && r.height > 0 && r.y >= 0 && r.y + r.height <= innerHeight,
    };
});
`);

// --- the run ---------------------------------------------------------------------------------------

/**
 * Part ids of switch#0, captured in the workspace phase.
 *
 * The Dev Mode window is a different renderer process with no workspace services in its fiber
 * tree, so `INSPECT` cannot run there at all. Carrying the two ids across as plain strings is the
 * only way the Dev Mode checks can name the elements they measure — and an earlier draft of this
 * file called `INSPECT` in the Dev Mode block, which would have failed for a reason that has
 * nothing to do with the widget.
 */
let parts = { trackId: null, thumbId: null };

async function main() {
  const seeded = await onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    const result = await A.call(d, SEED, SURFACE_NAME);
    run.check(
      "S0",
      "workspace services reachable, three switches on the surface",
      result.ok,
      result
    );
    if (!result.ok) throw new Error("setup guard failed: " + JSON.stringify(result));
    if (result.reused) run.note("reused switches from a previous run - state may not be pristine");

    for (let i = 0; i < result.ids.length; i += 1) {
      const info = await A.call(d, INSPECT, result.ids[i]);
      const tag = `switch#${i}`;

      run.check(
        `S1.${i}`,
        `${tag}: exactly two container parts, slots track+thumb`,
        info.ok &&
          info.childCount === 2 &&
          info.trackId &&
          info.thumbId &&
          info.childTypes.every((t) => t === "nl.container"),
        info
      );

      run.check(`S2.${i}`, `${tag}: props point at its own parts`, info.propsPointAtParts, {
        trackId: info.trackId,
        thumbId: info.thumbId
      });

      run.check(
        `S3.${i}`,
        `${tag}: both parts carry the fixed "on" appearance variant`,
        Array.isArray(info.trackVariantIds) &&
          info.trackVariantIds.includes("on") &&
          Array.isArray(info.thumbVariantIds) &&
          info.thumbVariantIds.includes("on"),
        { track: info.trackVariantIds, thumb: info.thumbVariantIds }
      );

      run.check(
        `S4.${i}`,
        `${tag}: thumb "on" variant carries a non-zero travel with a transition`,
        info.thumbOnTravel &&
          typeof info.thumbOnTravel.value === "number" &&
          info.thumbOnTravel.value > 0 &&
          info.thumbOnTravel.hasTransition,
        { off: info.thumbOffTravel, on: info.thumbOnTravel }
      );

      run.check(
        `S5.${i}`,
        `${tag}: track changes colour between off and on`,
        info.trackOffColour &&
          info.trackOnColour &&
          info.trackOffColour.value !== info.trackOnColour.value,
        { off: info.trackOffColour, on: info.trackOnColour }
      );
    }
    return result;
  });

  // Canvas: the two-registries check. Run this only once the surface editor tab is open.
  await onWindow("workspace", A.WINDOWS.workspace, async (d) => {
    const first = await A.call(d, INSPECT, seeded.ids[0]);
    parts = { trackId: first.trackId, thumbId: first.thumbId };
    const track = await A.call(d, PAINTED, first.trackId);
    const thumb = await A.call(d, PAINTED, first.thumbId);
    run.check("S6", "track paints on the editor canvas with a non-zero box", track.painted, track);
    run.check("S7", "thumb paints on the editor canvas with a non-zero box", thumb.painted, thumb);
    // The palette button is named for the action, not the widget - "插入开关" / "Insert Switch".
    // An anchored `^(switch|开关)$` finds nothing and reads as a missing palette entry; that is
    // what this check did on its first run, and the product was right both times.
    const palette = await A.call(d, function () {
      return Array.from(document.querySelectorAll("button"))
        .map((el) =>
          (
            el.getAttribute("aria-label") ||
            el.getAttribute("data-tip") ||
            el.getAttribute("title") ||
            ""
          ).trim()
        )
        .filter((name) => /switch|开关/i.test(name));
    });
    run.check("S8", "the insert palette offers a Switch", palette.length > 0, palette);
    await d.screenshot("switch-canvas");
  });

  // Dev Mode: the parts that only a running game can answer.
  await onWindow("dev-mode", A.WINDOWS.devmode, async (d) => {
    let live = await A.call(d, LIVE_SWITCHES);
    run.check("S9", "the running game shows three switch shells", live.length === 3, live);
    if (live.length < 2)
      throw new Error("cannot test interaction without at least two switches on screen");

    if (!parts.thumbId || !parts.trackId)
      throw new Error("part ids were never captured in the workspace phase");

    // A re-run inherits whatever the last run left switched on, and "click it and expect true"
    // would then be asserting the opposite of what happens. Normalise to off first.
    for (let i = 0; i < live.length && live[i].checked === "true"; i += 1) {
      if (live[i].disabled) break;
      await d.click(live[i].cx, live[i].cy);
      await A.sleep(600);
      live = await A.call(d, LIVE_SWITCHES);
    }
    run.check("S9a", "switch#0 starts from off", live[0].checked === "false", live[0]);

    const before = live.map((s) => s.checked);
    const thumbBefore = await A.call(d, PAINTED, parts.thumbId);
    const trackBefore = await A.call(d, PAINTED, parts.trackId);
    run.check(
      "S9b",
      "both parts of switch#0 are painted in the running game",
      thumbBefore.painted && trackBefore.painted,
      { thumb: thumbBefore, track: trackBefore }
    );
    await d.screenshot("switch-devmode-off");

    // A real mouse event, not el.click(): synthetic clicks do not move focus, and this codebase
    // has already produced one phantom defect that way.
    run.check("S10", "switch#0 is reachable where it is drawn", live[0].onScreen, live[0]);
    await d.click(live[0].cx, live[0].cy);
    await A.sleep(600);

    live = await A.call(d, LIVE_SWITCHES);
    run.check(
      "S11",
      "clicking switch#0 flips its aria-checked",
      live[0].checked !== before[0] && live[0].checked === "true",
      { before: before[0], after: live[0].checked }
    );
    run.check(
      "S12",
      "switch#1 did NOT follow it (per-element runtime state, not shared)",
      live[1].checked === before[1],
      { before: before[1], after: live[1].checked }
    );

    const thumbAfter = await A.call(d, PAINTED, parts.thumbId);
    run.check(
      "S13",
      "the thumb actually moved on screen (computed transform changed)",
      thumbBefore.transform !== thumbAfter.transform,
      { before: thumbBefore.transform, after: thumbAfter.transform }
    );

    const trackAfter = await A.call(d, PAINTED, parts.trackId);
    run.check(
      "S14",
      "the track actually changed colour on screen",
      trackBefore.backgroundColor !== trackAfter.backgroundColor,
      { before: trackBefore.backgroundColor, after: trackAfter.backgroundColor }
    );
    await d.screenshot("switch-devmode-on");

    // The disabled one.
    const disabled = live[2];
    if (disabled && disabled.onScreen) {
      const was = disabled.checked;
      await d.click(disabled.cx, disabled.cy);
      await A.sleep(600);
      const now = (await A.call(d, LIVE_SWITCHES))[2];
      run.check(
        "S15",
        "an interaction-disabled switch does not flip when clicked",
        now.checked === was,
        { before: was, after: now.checked }
      );
    } else {
      run.check(
        "S15",
        "an interaction-disabled switch does not flip when clicked",
        false,
        "switch#2 not on screen"
      );
    }
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
