/**
 * A run an `/ending` or `/quit` row has ended does not also land on the build's ending page.
 *
 * Such a row is usually the last one, so the engine reports the story's own end right behind it,
 * and the story's end opens the build's ending page. Measured in Dev Mode on the skeleton, whose
 * project ending page is the title screen: an `/ending` row picking its own page put that page up,
 * and the title screen opened over it a moment later, so the row's page was never seen. By the same
 * path a row choosing "show nothing" got the build's page. No test can drive `GameApp` through a story,
 * so this reads the file as text, the way `savePlaytimeForwarding.test.ts` does.
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

describe("the story's own end", () => {
    it("stands down when a row has already ended the run", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        const storyEnd = callbackBody(source, "const handleStoryEnd = useCallback(");
        // `quitGame` turns `gameEnteredRef` off for a row that put a page up; a row that chose no
        // page leaves the run entered and says so through `endingAnsweredRef`.
        expect(storyEnd).toMatch(/if \(!endingSurfaceId \|\| !gameEnteredRef\.current \|\| endingAnsweredRef\.current\) \{\s*return;/);

        const ending = callbackBody(source, "const handleEndingReached = useCallback(");
        expect(ending.indexOf("endingAnsweredRef.current = true")).toBeGreaterThanOrEqual(0);
        expect(ending.indexOf("endingAnsweredRef.current = true")).toBeLessThan(ending.indexOf("quitGame("));
    });

    it("is heard again in the next run", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        // Every place a run is entered - a new game and a load - clears the previous run's answer.
        const entries = source.split("gameEnteredRef.current = true;").length - 1;
        const resets = source.split("gameEnteredRef.current = true;\n        endingAnsweredRef.current = false;").length - 1
            + source.split("gameEnteredRef.current = true;\r\n        endingAnsweredRef.current = false;").length - 1;
        expect(entries).toBeGreaterThan(0);
        expect(resets).toBe(entries);
    });
});
