/**
 * The page an `/ending` row lands on opens after the endings record has taken the ending.
 *
 * That page is where a game asks about endings - an "all endings reached" check, a gallery that
 * unlocks a card - and it asks the moment it opens. Opened ahead of the write, it read the record as
 * it stood before this ending, and a player who had just finished the last route was shown it
 * locked. No test can drive `GameApp` through a whole story to see that, so this reads the file as
 * text, the way `savePlaytimeForwarding.test.ts` does, and pins the two halves of the hand-off:
 *
 *  1. the ending handler hands the record's promise to `quitGame`;
 *  2. `quitGame` waits for it after the run has stopped and before the page opens - not before the
 *     run stops, or a click in the meantime could advance a story that has ended.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";

const APP_FILE = path.join(path.resolve(__dirname), "GameApp.tsx");

/** The source from `start` up to the next `useCallback` declaration after it. */
function callbackBody(source: string, start: string): string {
    const from = source.indexOf(start);
    expect(from, `${start} is not in GameApp.tsx`).toBeGreaterThanOrEqual(0);
    const next = source.indexOf("= useCallback(", from + start.length);
    return source.slice(from, next < 0 ? undefined : next);
}

describe("the ending page", () => {
    it("is handed the endings record to wait for", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        const handler = callbackBody(source, "const handleEndingReached = useCallback(");

        expect(handler).toMatch(/const recorded = persistence\s*\?\s*markEndingReached\(/);
        expect(handler).toContain("quitGame(page, recorded)");
    });

    it("opens once the record has landed, after the run has stopped", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        const quit = callbackBody(source, "const quitGame = useCallback(");

        const stopsTakingClicks = quit.indexOf("setGameStageVisible(false)");
        const waits = quit.indexOf("await landAfter");
        const opens = quit.indexOf("await openSurface(");
        expect(stopsTakingClicks).toBeGreaterThanOrEqual(0);
        expect(waits).toBeGreaterThan(stopsTakingClicks);
        expect(opens).toBeGreaterThan(waits);
    });
});
