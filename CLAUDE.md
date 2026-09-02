# Working in this repository

## Ask the tools before you grep

`project/app/` holds command-line tools that answer questions a search answers badly. The five that
answer questions - `blueprint.js`, `ui.js`, `story.js`, `debug.js`, `cdp.js` - each have a `.md`
beside them; read that file before working in the area it covers. The rest (`dev-electron.js`,
`stop-dev.js`, `pack-electron.js`) are what `yarn dev` and the packaging scripts run, and are
documented by their own header comments.

### Blueprints — `project/app/blueprint.js` (`blueprint.md`)

The blueprint catalogue is 600-odd node types spread over sixty-odd files under
`src/renderer/lib/ui-editor/blueprint-nodes/built-in`, and the graphs themselves are stored as JSON
that nobody can write by hand with confidence. Both problems have one answer:

```sh
node project/app/blueprint.js node blueprint.sound.play        # pins, fields, scope, graph kinds
node project/app/blueprint.js nodes save slot --owner widgetMain
node project/app/blueprint.js targets --project <dir>          # surfaces and elements, as owner= fields
node project/app/blueprint.js show   --project <dir> --blueprint "Quit" --out x.bp
node project/app/blueprint.js check  x.bp --project <dir>
node project/app/blueprint.js apply  x.bp --project <dir> --write
```

It reads the same registry and the same graph validator the editor uses, so there is no second
catalogue that can fall behind. **Do not grep the node definitions to find a node type, and do not
drive the canvas over CDP to build a blueprint** - write a `.bp` file, check it, apply it. Start
from `show` when changing one that exists: a file describes a whole blueprint, and applying it drops
the layers it does not mention.

A `.bp` named without a directory lives in `.ignored/` at the root of this checkout, which git
ignores - that is where scratch files for these tools go, rather than the repository root.

### Interfaces — `project/app/ui.js` (`ui.md`)

The same problem one layer up: seventeen widget types whose props are only stated as defaults inside
their modules, and an `editor/ui/uidoc.json` that is a flat map of generated ids nobody can edit by
hand. Same answer:

```sh
node project/app/ui.js widget nl.list                          # props, bindable props, events, parts
node project/app/ui.js usage nl.list --prop itemsBinding       # how the shipped skeleton does it
node project/app/ui.js surfaces --project <dir>                # owner= lines for blueprint.js
node project/app/ui.js show   --project <dir> --surface Title --out title.ui
node project/app/ui.js check  title.ui --project <dir>
node project/app/ui.js apply  title.ui --project <dir> --write
```

It reads the widget module registry, the shared widget-logic table and the value-binding table the
runtime consults, so there is no second catalogue either. **Do not hand-edit `uidoc.json`, and do not
drive the canvas over CDP to build a page** - write a `.ui` file, check it, apply it. Start from
`show` when changing something that exists: a block describes a whole surface, and applying it drops
the elements it does not mention. `.ui` files use the same `.ignored/` scratch directory as `.bp`.

`ui` owns `uidoc.json` and `blueprint` owns `uigraphs.json`; the seam between them is the element id,
which a `.ui` file names for itself. `ui check` is also the thing that catches a value binding
pointing at a blueprint some other element owns - a prop that silently shows nothing.

### Stories — `project/app/story.js` (`story.md`)

Fifty-odd slash commands whose params are only stated inside their specs, and scenes stored as
thousands of blocks in one JSON file. Same answer again:

```sh
node project/app/story.js command say                          # params, types, what it builds
node project/app/story.js commands --category flow
node project/app/story.js targets --project <dir>              # every name a line can use
node project/app/story.js show  --project <dir> --scene "The corridor" --out ch1.story
node project/app/story.js check ch1.story --project <dir>
node project/app/story.js apply ch1.story --project <dir> --write
```

It parses, resolves and builds through the same three calls Enter makes in the row editor, so a line
that commits in Studio lands the same row here. `check` adds the project linter's story rules - the
ones the lint panel runs - so **finding out whether a scene is well-formed no longer needs Studio
open**. **Do not drive the story editor over CDP to type rows.**

Two things are specific to this one. **The `.story` format is for the tool, not for authors**: Studio
deliberately offers no text-based way to write a story, and nothing here appears in its interface -
it is not a feature to point anyone at. And **about a row in four has no spelling** (mostly transform
and transition shapes the command line cannot state); those print as `» label` lines, come back
verbatim, and must not be edited in the file. `show` names them. A green `check` still says nothing
about whether the scene plays right - that is Dev Mode's answer, and it has not moved.

### A running dev app — `project/app/debug.js` (`debug.md`), `project/app/cdp.js` (`cdp.md`)

`debug.js` pulls Studio's own log panel and the DevTools console of any window over HTTP, with no
CDP session and no screenshots. `cdp.js` drives the app when something really does need clicking.

## Verifying a change

```sh
yarn lint                      # tsc over the five projects; it does not run the project linter
yarn test                      # vitest
node scripts/style-ratchet.mjs # the design-system debt gate, and not part of yarn lint
node project/build/build-runtime.js --dev   # ~3s; the one gate the three above cannot see
```

The fourth is not optional if you touched anything under `src/renderer/lib/ui-editor/` or anything
those files import. The game runtime bundles part of the Studio renderer and refuses most of the
rest, and that refusal lives in an esbuild plugin - so an import the runtime may not have is green
under tsc, green under vitest, and breaks every game build, preview and test run. It has reached
`develop` that way.

Some failures are the environment rather than the change: a handful of `src/main` and `src/runtime`
tests need POSIX paths, elevation or an `unzip` on PATH and fail on Windows regardless. Compare
against a clean checkout before calling one a regression, and run it the same way both times - a few
of them only fail in a full run. A test that times out at exactly 5000ms is usually the load rather
than the change; the ones that walk the whole source tree do it under a full run and pass on their
own.

**None of the `yarn` lines work from a git worktree of this repository.** Yarn walks up to the main
checkout, finds a package the worktree is not a declared workspace of, and exits on a usage error
having run nothing - `The nearest package directory ... doesn't seem to be part of the project
declared in ...`. It exits non-zero, so it cannot be mistaken for a pass, but the gate has not run.
The scripts are thin, so run what they run:

```sh
for p in shared main renderer runtime builtin-plugins; do npx tsc --project src/$p/tsconfig.json --noEmit; done
npx vitest run
node scripts/style-ratchet.mjs                        # already direct, works anywhere
node project/build/build-{runtime,main,apps,builtin-plugins}.js --dev   # what `yarn build:dev` runs
```

Dependencies come from the main checkout rather than from an install of their own: link
`node_modules` in (a junction on Windows, a symlink elsewhere) and every tool above reads it
happily. **Do not run `yarn install` while a dev session is running anywhere on the machine.** The
link step deletes and re-lays packages, it cannot replace an `.exe` that a running esbuild or
Electron holds open, and it aborts there - leaving a half-installed tree that every worktree on the
machine is sharing. The symptom is a build that succeeded five minutes ago failing on
`Could not resolve` for a package nobody touched.

## Conventions

- Comments and identifiers in English; prose in `docs/` uses British spelling.
- Comments explain what the code does and why, for someone reading the repository cold. No
  references to planning documents, work items or session workflow.
- The interface has a design system (`docs/design-system.md`) and it is not optional.
- Editing the English skeleton template under `resources/templates/skeleton/content/` means
  regenerating the Chinese and Japanese ones: `node scripts/gen-skeleton-locale.mjs --check`, add any
  missing strings to `scripts/gen-skeleton-locale.zh.json` and `scripts/gen-skeleton-locale.ja.json`,
  then run it without `--check` and commit all of them.
