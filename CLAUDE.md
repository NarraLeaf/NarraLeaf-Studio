# Working in this repository

## Ask the tools before you grep

`project/app/` holds command-line tools that answer questions a search answers badly. The four that
answer questions - `blueprint.js`, `ui.js`, `debug.js`, `cdp.js` - each have a `.md` beside them;
read that file before working in the area it covers. The rest (`dev-electron.js`, `stop-dev.js`,
`pack-electron.js`) are what `yarn dev` and the packaging scripts run, and are documented by their
own header comments.

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
of them only fail in a full run.

## Conventions

- Comments and identifiers in English; prose in `docs/` uses British spelling.
- Comments explain what the code does and why, for someone reading the repository cold. No
  references to planning documents, work items or session workflow.
- The interface has a design system (`docs/design-system.md`) and it is not optional.
- Editing the English skeleton template under `resources/templates/skeleton/content/` means
  regenerating the Chinese and Japanese ones: `node scripts/gen-skeleton-locale.mjs --check`, add any
  missing strings to `scripts/gen-skeleton-locale.zh.json` and `scripts/gen-skeleton-locale.ja.json`,
  then run it without `--check` and commit all of them.
