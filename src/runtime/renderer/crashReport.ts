import type { GameCrashReportResult } from "@shared/types/gameRuntime";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { readStoryPosition } from "@/lib/ui-editor/runtime/app/lastStoryPosition";
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

export async function saveCrashReport(details: string): Promise<GameCrashReportResult> {
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
    let story = null;
    try {
        story = readStoryPosition();
    } catch {
        // A report without the position is still the report. Where the player was is the one field
        // that can be missing without costing the reader the rest.
        story = null;
    }
    try {
        return await bridge.saveCrashReport({ details, language: getShellLocale(), story });
    } catch (error) {
        return { outcome: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}
