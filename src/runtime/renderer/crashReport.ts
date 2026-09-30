import type { GameCrashReportResult, GameCrashStoryPosition } from "@shared/types/gameRuntime";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { getShellLocale } from "./shellLocale";

/**
 * The crash screen's side of the report file: gather what only this page knows, and ask the shell
 * to write it.
 *
 * Everything here has to hold with the game half-gone. The story position is three strings that were
 * recorded while the game was healthy, the language was resolved at module load, and the failure was
 * handed to the screen - nothing is computed out of a tree that has just stopped rendering, and
 * nothing here can throw its way into a second crash.
 */

/**
 * Whether this shell can write one at all.
 *
 * False on the web export, which has no log file to gather and nowhere to leave the result, and
 * false wherever the preload never ran - the case the rest of the crash screen exists to survive. In
 * both, the screen draws no button rather than one that apologises; the failure, the copy button and
 * the log path are untouched either way.
 */
export function canSaveCrashReport(): boolean {
    try {
        return typeof getGameRuntimeBridge()?.saveCrashReport === "function";
    } catch {
        return false;
    }
}

/**
 * The position is passed in rather than read here: the boundary took it while unwinding, which is
 * the last moment it is still true. By the time this runs the player has clicked a button on a
 * screen that replaced the game, and the record has been cleared by the teardown in between.
 */
export async function saveCrashReport(
    details: string,
    story: GameCrashStoryPosition | null,
): Promise<GameCrashReportResult> {
    let bridge: ReturnType<typeof getGameRuntimeBridge>;
    try {
        bridge = getGameRuntimeBridge();
    } catch {
        bridge = null;
    }
    if (!bridge?.saveCrashReport) {
        // Not reachable from the screen, which draws the button only where `canSaveCrashReport`
        // already answered yes. Here so a caller that skipped the question gets an answer rather
        // than a thrown TypeError inside a crash handler.
        return { outcome: "failed", error: "no report file on this shell" };
    }
    try {
        return await bridge.saveCrashReport({ details, language: getShellLocale(), story });
    } catch (error) {
        return { outcome: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}
