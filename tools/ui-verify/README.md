# ui-verify

Mechanical CDP driver for UI verification runs. Drive only — no assertions, no scenarios.

> **The machine belongs to someone who is using it.** A verification run may not take the foreground,
> pin a window on top, or drag the operator to another virtual desktop. Start the instance with
> `yarn dev:verify` (or add `--disable-features=CalculateNativeWinOcclusion` to your own launch line)
> and none of that is necessary: a covered window keeps reporting `document.hidden === false`, so it
> can be measured while it sits behind the editor. Without the switch the visibility guard in
> `assert.js` fails with an error telling you to add it — it will not "fix" the problem by grabbing
> focus. See the note at the top of `focus.ps1`.

1. **Start an instance**: `yarn dev:verify` (spawns Electron with `--cdp --cdp-port=9222`). `yarn stop` ends it.
2. **Pick a window**: `node tools/ui-verify/drive.js targets`, then pass a substring of its title/url as
   `--target` (`launcher`, `workspace`, `dev-mode`).
3. **Drive it**: `shot <name>` / `click <x> <y>` / `keys <spec>...` / `eval <expr>`. Screenshots land in
   `tools/ui-verify/out/` (git-ignored) unless `--out <dir>` says otherwise.

```sh
node tools/ui-verify/drive.js targets
node tools/ui-verify/drive.js eval "location.href" --target dev-mode
node tools/ui-verify/drive.js click 700 450 --target dev-mode
node tools/ui-verify/drive.js shot before-panel --target dev-mode --out docs/plans/reports/assets --prefix 2026-07-26-U0-
```

Coordinates are **CSS pixels**; screenshot pixels are CSS px x `devicePixelRatio` (1.25 here), so divide
before clicking a point read off an image.

As a module:

```js
const { withDriver } = require('./tools/ui-verify/drive');

await withDriver({ target: 'dev-mode' }, async (d) => {
    await d.click(320, 240);
    console.log(await d.evaluate('document.querySelectorAll("li").length'));
    console.log(await d.screenshot('timeline'));
});
```
