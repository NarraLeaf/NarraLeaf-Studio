# Working in this repository

## Ask the tools before you grep

`project/app/` holds command-line tools that answer questions a search answers badly. Each has a
`.md` beside it. Read that file before working in the area it covers.

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
