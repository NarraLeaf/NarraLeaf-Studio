/*
 * Drive a fresh instance to the state every scenario assumes and none of them creates:
 * launcher -> project -> Story -> <scene> -> Dev Mode -> New Game, story on stage.
 *
 *   NLS_VERIFY_PORT=<cdp> NLS_VERIFY_PID=<electron pid> NLS_VERIFY_PROJECT=<project copy> \
 *     node tools/ui-verify/scenarios/goto-devmode.js
 *
 * `u4-dev-mode-console.js` and `u5-language-and-empty-states.js` both start by measuring windows
 * that only exist once someone has already navigated there — on a fresh instance u4 dies with
 * `clickNamed timed out for "^First Day"`, which reads like a missing editor tab rather than
 * "nothing has opened the project yet". Run this first, then the scenario.
 */

const D = require("./_drive");

(async () => {
  await D.driveToDevMode();
  console.log("ready: dev-mode is up with the story on stage");
})().catch((e) => {
  console.error("\nSCRIPT FAIL:", e.message);
  process.exit(1);
});
