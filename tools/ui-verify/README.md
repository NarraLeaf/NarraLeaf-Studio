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

## Answering a file dialog without leaving the browser

A native picker runs its own COM input loop outside Chromium. CDP cannot see it, let alone type into
it, so the only way to answer one from a script is to reach outside the process and drive the Win32
dialog by hand (`file-dialog.ps1`) — Windows-only, sensitive to which control id that kind of dialog
happens to use, and the single most fragile step in any run that imports or exports a file.

Two experimental conditions remove that step. Both are development-only in the strong sense: a
packaged Studio ignores `--experimental` outright, and a condition flag without it does nothing at
all except say so in the log.

```sh
yarn dev:verify --experimental --x-scripted-file-dialog
```

With `--x-scripted-file-dialog` on, **no picker opens**. Every open and save dialog instead waits as
a request in the page that raised it, on `window.__NLS_STUDIO_DIALOG__`:

```js
// after clicking whatever opens the picker
await d.evaluate('__NLS_STUDIO_DIALOG__.pending()');
// [{ id: 1, kind: 'open', window: 'workspace', title: 'Select Folder',
//    selects: 'directory', multiple: false, extensions: [] }]
await d.evaluate('__NLS_STUDIO_DIALOG__.resolve(1, "D:/Temp/import-fixture")');
```

`resolve(id, path | paths)` answers it, `cancel(id)` answers it the way closing the dialog would, and
both return `false` when nothing by that id is waiting — so a wrong id is an answer, not a hang. The
main process collects answers within ~150ms and names every request in the log as it is raised and
again as it is answered. Drive the page that raised the dialog: the request waits there, because that
is the window whose grant is about to be minted.

The answer has to be something the dialog could actually have returned — a file that exists for a
file picker, a folder that exists for a folder picker, one path where one was asked for, a save
destination inside a folder that exists. Anything else is refused, the request stays waiting, and the
reason appears on it as `rejected`. That is deliberate: the answer goes on to mint exactly the grant
a picked path would, so a picker that accepted paths nobody can pick would turn everything after it
into a test of a product that does not exist.

**The other one is blunter, and is a debt you take on for the run.** `--x-unscoped-file-access` stops
the window file system policy from refusing paths nothing granted, so a window reads and writes
anywhere on disk without a picker having handed it anything. Protected storage (authorization,
signing credentials, the plugin directories) is still refused and plugin permissions are unchanged —
it relaxes what a *window* may reach, and nothing else.

Reach for it only when the grant itself is in the way, never as a shortcut past the picker: Studio
hands out reach one grant at a time, and anything you accept on a path that never had one is
behaviour no author can reproduce. Every distinct path it lets through is named once in `main.log`:

```text
[Experimental] unscoped-file-access allowed write on D:\Temp\outeport.json for the workspace
window. Nothing granted that path; Studio as shipped refuses it.
```

Grep for that line at the end of a run. If a path you accepted something on is in there, the run did
not show what it looks like it showed — go back and get the grant the product would have required,
which with the condition above is one `resolve` call.

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
