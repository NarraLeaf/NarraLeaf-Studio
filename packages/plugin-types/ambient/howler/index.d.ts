/**
 * A stand-in for `howler`, which ships no declarations of its own.
 *
 * Nothing here reaches the published package: `howler` is not part of either plugin surface, and
 * `exportReferencedTypes: false` keeps unreferenced types out of the bundle. It exists purely so
 * declaration generation can finish.
 *
 * The declaration bundler walks *every* file in the program - `node_modules` included - and
 * resolves a symbol for each import specifier it meets. A specifier that resolves to nothing has
 * no symbol, and it throws rather than skipping it:
 *
 *   Cannot find symbol for node ""howler"" in "import * as Howler from "howler";"
 *   from node_modules/narraleaf-react/dist/game/player/gameState.d.ts
 *
 * `narraleaf-react` is reachable from the plugin surface (`services.ts` imports it), the engine
 * depends on `howler` at runtime, and howler has neither bundled types nor an `@types` package
 * installed here - so generation died on a module neither surface exposes.
 *
 * Declared member by member rather than as the shorthand `declare module "howler";`: the walk
 * resolves *every* node it meets, so `typeof Howler.Howl` in the engine's `getHowl()` needs a
 * symbol for `Howl` too, and a shorthand module (implicitly `any`) has no members to find. Only
 * what the engine's declarations actually name has to be here - grep `Howler.` under
 * `node_modules/narraleaf-react/dist` if an engine update adds another one.
 *
 * Reached through `typeRoots` + `types` in tsconfig.gen.json, because that is the only inclusion
 * mechanism that survives: the bundler compiles the entry to `.d.ts` and builds its real program
 * over *that*, so a `/// <reference path>` in the entry is gone by the time it matters, and it
 * takes only `compilerOptions` from the tsconfig - never its `files`/`include`.
 *
 * Delete this the day `@types/howler` (or a typed howler) is a dependency of the repo.
 */
declare module "howler" {
  /** Only ever referenced as `typeof Howler.Howl`; its real shape is nothing this repo needs. */
  const Howl: unknown;
  export { Howl };
}
