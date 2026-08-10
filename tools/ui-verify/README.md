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
node tools/ui-verify/drive.js shot before-panel --target dev-mode --out ./shots --prefix before-
```

## Starting where the run actually begins

A launch lands on the launcher's home screen — or, on a profile that has never been through it, on
first-run setup. Both are in the way of a run that is here to look at a project, and clicking past
them is where a scripted pass is most likely to break (the setup buttons are localized: on a Chinese
machine an English selector finds nothing and the run reads as stuck, not as mislocalized).

Three switches skip that, all of them **development-only** — a packaged build ignores them, because
argv there is where shortcuts and file associations arrive:

| | |
|---|---|
| `--skip-onboarding` | Open the home screen even on a profile that has never been through setup. Records nothing: the profile still owes the flow, and the next launch without the flag asks for it. |
| `--project <name-or-path>` | Open this project's workspace instead of the home screen. Implies `--skip-onboarding`. |
| `--onboarding` | Force first-run setup. Beats both of the above. |

```sh
node tools/ui-verify/drive.js projects           # which projects does this profile remember?
yarn dev:verify --project demo3                  # …then start in one of them
yarn dev:verify --skip-onboarding                # or on the home screen, setup out of the way
```

`--project` takes a directory path (absolute or relative to the working directory), or a name from
the recent list — exactly, or any unambiguous part of one, case-insensitively. Two matches is an
error rather than a guess. Anything that does not resolve leaves the launcher up and says why in the
main log, so a wrong name is a message, never a windowless app.

`projects` reads the profile's store directly (`.dev/temp/userData-dev/state/global.json`, or
`--user-data <dir>`), so it answers before an app is running and while one is. It marks entries whose
folder is gone. `--json` for machine-readable output. A worktree has its own profile and therefore
its own list — seed one by opening a project there once, or just launch with `--project <path>`,
which adds it on the way in.

Coordinates are **CSS pixels**; screenshot pixels are CSS px x `devicePixelRatio` (1.25 here), so divide
before clicking a point read off an image. The same factor applies to any distance you *report*: a
"61px" gap measured off a screenshot in the version-rail round was 49 CSS px, which was exactly the
width of the column that had just been added — the number sent someone looking for a second cause
that did not exist.

## Four traps, each of which has cost an acceptance here

**1. The stale bundle — check it before believing anything.** The launcher rebuilds `dist` only after
it owns the reload port. If something else holds that port it prints *"dist was left untouched"* and
exits, while a **previous instance keeps answering on the CDP port** — so the app you are driving can
be an hour older than the code you are accepting. Integration tests that drive `DevModeManager` leave
such processes behind. Assert freshness first:

```sh
ls -l --time-style=+%H:%M:%S dist/windows/workspace/index.js   # newer than your newest non-test source?
```

If it is not, kill by command line (`Get-CimInstance Win32_Process | Where CommandLine -like "*<worktree>*"`),
free the ports, relaunch, and check again. This nearly passed a 55-minute-old build twice in one round.

**2. `el.disabled` does not see an ancestor `<fieldset disabled>`.** That property reflects the
element's *own* attribute. The property framework disables structural fields by wrapping them, so ask
`el.matches(':disabled')`. Asking the wrong one reports a defect that is not there.

**3. The command palette does not substring-match.** `>unfreeze` does not find *Unfreeze Project
(Resume Saving Changes)*; `>freeze` does. Dump the visible rows and click one instead of typing a
query and pressing Enter blind — otherwise a command that silently did not run looks like a product
bug, and the app will happily keep behaving as though you never ran it.

**4. A subagent's "green" is not your green.** Run anything load-bearing three times. One test in the
version-control programme was reported green and was two-of-three red here; the cause was a real
product bug (two concurrent recursive `fs.rm` of one tree fail 20 times out of 20 on Windows, and the
loser returned success having done nothing).

As a module:

```js
const { withDriver } = require('./tools/ui-verify/drive');

await withDriver({ target: 'dev-mode' }, async (d) => {
    await d.click(320, 240);
    console.log(await d.evaluate('document.querySelectorAll("li").length'));
    console.log(await d.screenshot('timeline'));
});
```
