# Working in this repository

## Ask the tools before you grep

`project/app/` holds command-line tools that answer questions a search answers badly. Each has a
`.md` beside it. Read that file before working in the area it covers.

### Blueprints — `project/app/blueprint.js` (`blueprint.md`)

The blueprint catalogue is 600-odd node types spread over fifty files under
`src/renderer/lib/ui-editor/blueprint-nodes/built-in`, and the graphs themselves are stored as JSON
that nobody can write by hand with confidence. Both problems have one answer:

```sh
node project/app/blueprint.js node blueprint.sound.play        # pins, fields, scope, graph kinds
node project/app/blueprint.js nodes save slot --owner widgetMain
node project/app/blueprint.js targets --project <dir>          # surfaces and elements, as owner= fields
node project/app/blueprint.js show   --project <dir> --out x.bp
node project/app/blueprint.js check  x.bp --project <dir>
node project/app/blueprint.js apply  x.bp --project <dir> --write
```

It reads the same registry and the same graph validator the editor uses, so there is no second
catalogue that can fall behind. **Do not grep the node definitions to find a node type, and do not
drive the canvas over CDP to build a blueprint** - write a `.bp` file, check it, apply it.

### A running dev app — `project/app/debug.js` (`debug.md`), `project/app/cdp.js` (`cdp.md`)

`debug.js` pulls Studio's own log panel and the DevTools console of any window over HTTP, with no
CDP session and no screenshots. `cdp.js` drives the app when something really does need clicking.

## Verifying a change

```sh
yarn lint                      # tsc over the five projects; it does not run the project linter
yarn test                      # vitest
node scripts/style-ratchet.mjs # the design-system debt gate, and not part of yarn lint
```

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
  regenerating the Chinese one: `node scripts/gen-skeleton-locale.mjs --check`, add any missing
  strings to `scripts/gen-skeleton-locale.zh.json`, then run it without `--check` and commit both.
