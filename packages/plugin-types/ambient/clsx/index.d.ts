/**
 * A stand-in for `clsx` — which, unlike howler next door, does ship perfectly
 * good declarations. This is not here because types are missing. It is here
 * because of how `narraleaf-react` reads them.
 *
 * clsx exports a single entity that is both a function and a namespace, through
 * `export = clsx`. The engine's PlayerProps then writes:
 *
 *   import clsx from "clsx";
 *   className?: clsx.ClassValue;
 *
 * A *default* import of an `export =` module carries the value meaning across
 * and nothing else, so `clsx.ClassValue` has no namespace to look in and the
 * engine's own declaration file does not compile:
 *
 *   node_modules/narraleaf-react/dist/game/player/elements/type.d.ts(36,17):
 *   error TS2503: Cannot find namespace 'clsx'.
 *
 * Every other tsconfig in this repository has skipLibCheck on and therefore
 * never sees it. The verify pass in build.mjs deliberately does not, because
 * the files it is checking ARE declarations — which makes it the one place the
 * engine's declarations have to hold up on their own.
 *
 * Declared with `export default` rather than clsx's own `export =`: an alias to
 * a default-exported identifier keeps every meaning that identifier has, so the
 * namespace survives the import the engine writes. The member list mirrors
 * node_modules/clsx/clsx.d.ts and nothing here reaches the published package —
 * clsx is on neither plugin surface.
 *
 * Delete this the day narraleaf-react imports the type directly
 * (`import type { ClassValue } from "clsx"`). That is the real fix and it
 * belongs upstream; this only stops one library's declaration style from
 * failing a check that is meant to be about ours.
 */
declare module "clsx" {
    namespace clsx {
        type ClassValue = ClassArray | ClassDictionary | string | number | bigint | null | boolean | undefined;
        type ClassDictionary = Record<string, any>;
        type ClassArray = ClassValue[];
    }
    function clsx(...inputs: clsx.ClassValue[]): string;
    export default clsx;
}
