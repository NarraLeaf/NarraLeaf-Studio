/**
 * Studio's binding to lorelib.
 *
 * Replaces `@lore-vcs/sdk`'s runtime, which stays a devDependency used only by
 * `tools/lore-abi-extract.mjs` to snapshot the ABI this binding is checked against.
 * The reasoning is in docs/version-control.md; the short version is that the SDK's
 * argument conversion can silently zero-fill an identifier, and it loads the native
 * library during module evaluation, which turns an unsupported host into a
 * main-process startup crash rather than one missing feature.
 *
 * Import rule, unchanged and load-bearing: nothing above `vcs/backend.ts` may reach
 * this module at module scope, directly or transitively. `backend.ts` imports it
 * dynamically behind a platform gate; everything else uses `import type`.
 */

export { LORE_VERBS, type LoreVerbName } from "./abi/definitions";
export {
    invoke,
    LoreCallError,
    LorePathIgnoredError,
    type InvokeOptions,
    type LoreCallResult,
    type LoreGlobals,
} from "./call";
export { decodeEvent, LoreTag, type LoreEvent } from "./events";
export * from "./events";
export {
    loadLoreLibrary,
    LoreCapabilityError,
    LoreLibraryError,
    resetLoreLibraryForRetry,
    resolveLoreLibraryPath,
    unpackAsarPath,
    type LoreLibrary,
} from "./library";
export {
    contextBytes,
    decodeBytes,
    decodeHash,
    decodeOptionalHash,
    decodeString,
    hashBytes,
    LoreValueError,
    partitionBytes,
    repositoryPath,
    revisionBytes,
    type LoreHex,
} from "./values";
export * from "./verbs";
