/**
 * Re-exported so this module's existing importers keep their spelling. The rule itself lives in
 * `@shared/utils/asarPath`, because the packaged game's main process needs it too and cannot reach
 * into Studio's main tree.
 *
 * Comments in English per project convention.
 */

export { unpackAsarPath } from "@shared/utils/asarPath";
