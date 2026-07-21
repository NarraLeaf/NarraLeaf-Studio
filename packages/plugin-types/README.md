# narraleaf-studio

TypeScript declarations for the [NarraLeaf Studio](https://github.com/NarraLeaf/NarraLeaf-Studio)
plugin API.

This package contains **types only**. Studio itself supplies the implementation
at load time through an import map — there is no runtime code here.

```bash
yarn add -D narraleaf-studio
```

## Usage

```ts
// Studio entry — runs in the editor
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
    setup(app) {
        app.services.blueprintNodes.registerMany(myNodes());
        app.services.ui.notifications.info(`${app.manifest.name} loaded`);
    },
});
```

```ts
// Runtime entry — runs inside the game
import { defineRuntimePlugin } from "narraleaf-studio/runtime";

export default defineRuntimePlugin({
    setup(app) {
        app.game.blueprintNodes.registerMany(myNodes());
    },
});
```

| Subpath                    | Surface                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `narraleaf-studio/plugin`  | Editor: `definePlugin`, `PluginApp`, `PluginServices`, `ui`       |
| `narraleaf-studio/runtime` | Game: `defineRuntimePlugin`, `RuntimePluginApp`                   |

The two are physically isolated at runtime. Importing `narraleaf-studio/plugin`
from a runtime entry throws — the runtime host has no Studio services.

## You must mark these external

Both specifiers have to be `external` in your bundler. Studio resolves them (and
`react`, `react-dom`) through an import map, so bundling them produces a second,
broken React instance and a plugin that fails to load.

```js
// esbuild
external: [
    "narraleaf-studio/plugin",
    "narraleaf-studio/runtime",
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
]
```

If you forget, this package's stub throws at import with a message saying so.

## How these types are produced

Generated directly from Studio's source by `packages/plugin-types/build.mjs`,
not written by hand:

| Output            | Generated from                                                   |
| ----------------- | ---------------------------------------------------------------- |
| `dist/plugin.d.ts`  | `src/renderer/plugin/index.ts`                                   |
| `dist/runtime.d.ts` | `src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts` |

Only what those entry points explicitly export is public. The build fails if the
generated declarations do not typecheck on their own, so a release cannot ship a
bundle that does not compile.

## Versioning

This package versions independently of Studio: it changes when the plugin API
changes, which is far less often than the app ships. Studio does not yet enforce
a compatibility range at install time, so treat a major bump as "recompile your
plugin and check it still typechecks".

## Getting started

See the plugin authoring guide in the
[NarraLeaf/Plugins](https://github.com/NarraLeaf/Plugins) registry, which has a
working starter template.

## License

MPL-2.0
