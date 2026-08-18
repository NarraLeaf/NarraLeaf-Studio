/*
 * Saving the UI document while Dev Mode runs must not blank the running game.
 *
 * The defect this guards: a save bumps the bundle revision, and GameApp's navigation-reset effect -
 * which shares the `bundle` object as its dependency - used to tear down the NLR environment as
 * well, setting `nlrPreloadDone` back to false. Nothing raised it again: the boot effect is keyed on
 * the session id, which a reload does NOT change, and the hot-reload path restarts the environment
 * without touching that flag. The entire surface stack renders behind it, so the game went blank and
 * stayed blank until Dev Mode was restarted - with no error logged anywhere.
 *
 * Two things make this scenario worth having rather than a unit test:
 *  - the fault is an effect-dependency interaction inside a 2700-line component with a live NLR
 *    environment behind it; there is no harness that mounts it;
 *  - it only appears on the SECOND revision onward, so a single save proves nothing. This saves
 *    repeatedly and fails on the first blank.
 *
 * The save changes NOTHING in the document. That is deliberate: an author's ordinary Ctrl+S is the
 * reported trigger, and a no-op save removes any question of the content being at fault.
 *
 * Usage - the workspace must be open on a project copy this run may write to, with Dev Mode started:
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<pid> node tools/ui-verify/scenarios/devmode-save-keeps-stage.js
 */

const { withDriver } = require("../drive");
const A = require("../assert");

const PORT = Number(process.env.NLS_VERIFY_PORT || 9222);
const PID = process.env.NLS_VERIFY_PID;
const ROUNDS = Number(process.env.NLS_VERIFY_ROUNDS || 5);

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

/** How much of the game is actually drawn, and which revision produced it. */
const STAGE = new Function(`
function findState() {
    const host = document.querySelector('#root') || document.body.firstElementChild;
    const key = Object.keys(host || {}).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return null;
    const seen = new Set();
    const queue = [host[key]];
    while (queue.length) {
        const f = queue.shift();
        if (!f || seen.has(f)) continue;
        seen.add(f);
        let h = f.memoizedState; let g = 0;
        while (h && g++ < 40) {
            const s = h.memoizedState;
            if (s && typeof s === 'object' && 'bundle' in s && 'entry' in s) return s;
            h = h.next;
        }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
    }
    return null;
}
const st = findState();
return {
    nodes: document.querySelectorAll('[data-ui-element-id]').length,
    revision: st && st.bundle && st.bundle.revision,
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 50),
};
`);

/** A save that changes nothing, on the same service path the editor's own save uses. */
const SAVE_UNCHANGED = new Function(`
const host = document.querySelector('#root') || document.body.firstElementChild;
const key = Object.keys(host || {}).find((k) => k.startsWith('__reactContainer$'));
const seen = new Set();
const queue = [host[key]];
let services = null;
while (queue.length && !services) {
    const f = queue.shift();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const s = f.memoizedProps && f.memoizedProps.value && f.memoizedProps.value.context
        && f.memoizedProps.value.context.services;
    if (s && typeof s.get === 'function') { services = s; break; }
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
    if (f.return) queue.push(f.return);
}
if (!services) return { ok: false, why: 'workspace services unreachable' };
const uidoc = services.get('uiDocument');
return Promise.resolve(uidoc.save(uidoc.getDocument())).then(() => ({ ok: true }));
`);

async function main() {
  const before = await onWindow("dev-mode", A.WINDOWS.devmode, (d) => A.call(d, STAGE));
  // Setup guard: measuring "still drawn" against a stage that was never drawn passes for free.
  run.check(
    "D0",
    "the running game is drawing something before any save",
    before.nodes > 2,
    before
  );
  if (before.nodes <= 2) {
    throw new Error(
      "nothing on the Dev Mode stage to begin with - start Dev Mode on a project with a page"
    );
  }

  for (let round = 1; round <= ROUNDS; round += 1) {
    const saved = await onWindow("workspace", A.WINDOWS.workspace, (d) =>
      A.call(d, SAVE_UNCHANGED)
    );
    if (!saved.ok) {
      throw new Error(`save failed: ${saved.why}`);
    }
    await A.sleep(5000);
    const after = await onWindow("dev-mode", A.WINDOWS.devmode, (d) => A.call(d, STAGE));
    run.check(
      `D${round}`,
      `save #${round}: the stage is still drawn`,
      after.nodes >= before.nodes,
      after
    );
    run.check(
      `D${round}r`,
      `save #${round}: the reload actually happened (revision advanced)`,
      typeof after.revision === "number" && after.revision > (before.revision ?? 0),
      { before: before.revision, after: after.revision }
    );
  }

  await onWindow("dev-mode", A.WINDOWS.devmode, (d) => d.screenshot("devmode-after-saves"));
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
