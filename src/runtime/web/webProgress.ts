/**
 * The Export/Import Progress nodes, on a page.
 *
 * A web export has no filesystem, and the progress document exists precisely because it must sit
 * outside every per-app store so two packages can both reach it. A browser has no such place: its
 * origin-scoped storage is exactly the per-app store the feature is built to get around, and
 * `showSaveFilePicker` is a user-chosen file rather than the one path both editions agree on.
 *
 * So this shell refuses, and says why. It deliberately does NOT write into IndexedDB and report
 * success: that would produce a build whose Export button appears to work and whose document no
 * other package will ever find - a failure the author discovers from players, months later, and
 * cannot tell from the feature working.
 *
 * `missing` is not used here either. Missing means "nobody has exported yet", which is a fact about
 * the player; this is a fact about the build, and an author who wired the `missing` branch to
 * "start a new game" must not be sent down it by a shell that simply cannot look.
 *
 * A separate module rather than an object literal inside `web.ts` so it can be exercised without
 * importing that file, which installs itself on `window` at import.
 *
 * Comments in English per project convention.
 */

import type { GameRuntimeProgressBridge } from "@shared/types/gameRuntime";

export const WEB_PROGRESS_UNSUPPORTED_REASON =
  "This web build cannot carry progress between editions: a page has no shared file to write.";

export const webProgressBridge: GameRuntimeProgressBridge = {
  write: async () => {
    console.warn(`[GameRuntime] Export Progress refused: ${WEB_PROGRESS_UNSUPPORTED_REASON}`);
    return { outcome: "failed", error: WEB_PROGRESS_UNSUPPORTED_REASON };
  },
  read: async () => {
    console.warn(`[GameRuntime] Import Progress refused: ${WEB_PROGRESS_UNSUPPORTED_REASON}`);
    return { outcome: "failed", document: null, error: WEB_PROGRESS_UNSUPPORTED_REASON };
  }
};
