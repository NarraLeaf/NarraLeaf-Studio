import { describe, expect, it } from "vitest";
import { decideStartupExtras, type StartupExtras } from "./startupExtras";

const ALL: (keyof StartupExtras)[] = [
    "statusBarItem",
    "launchUpdateCheck",
    "nativeCrashDumps",
    "sessionMarker",
    "developmentReloadSocket",
    "developmentDebugServer",
];

describe("decideStartupExtras", () => {
    it("starts nothing extra in a command-line run", () => {
        for (const devMode of [false, true]) {
            const extras = decideStartupExtras({ commandLineRun: true, devMode });
            for (const key of ALL) {
                expect(extras[key], `${key} with devMode=${devMode}`).toBe(false);
            }
        }
    });

    it("starts everything a person needs in an ordinary development launch", () => {
        const extras = decideStartupExtras({ commandLineRun: false, devMode: true });
        for (const key of ALL) {
            expect(extras[key], key).toBe(true);
        }
    });

    it("leaves the development conveniences alone in a packaged launch", () => {
        const extras = decideStartupExtras({ commandLineRun: false, devMode: false });
        expect(extras.developmentReloadSocket).toBe(false);
        expect(extras.developmentDebugServer).toBe(false);
        // Everything a shipped Studio still owes the person in front of it.
        expect(extras.statusBarItem).toBe(true);
        expect(extras.launchUpdateCheck).toBe(true);
        expect(extras.nativeCrashDumps).toBe(true);
        expect(extras.sessionMarker).toBe(true);
    });

    // The point of the table is that a seventh entry is a decision rather than an oversight, so a
    // new one arriving without an answer for a run should fail here rather than on a build agent.
    it("answers every entry it declares", () => {
        const extras = decideStartupExtras({ commandLineRun: true, devMode: true });
        expect(Object.keys(extras).sort()).toEqual([...ALL].sort());
    });
});
