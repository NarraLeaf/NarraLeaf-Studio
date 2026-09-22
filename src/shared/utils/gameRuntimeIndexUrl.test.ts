import { describe, expect, it } from "vitest";
import {
    buildGameRuntimeIndexUrl,
    readGameRuntimeIndexUrl,
    withoutGameRuntimeCrashDetails,
} from "./gameRuntimeIndexUrl";

const LOG = "C:\Users\Player\AppData\Roaming\my-game\logs\game.log";

describe("the address the shell gives its own page", () => {
    it("carries what the crash screen needs before it can read anything", () => {
        const url = buildGameRuntimeIndexUrl({ policy: "log", logPath: LOG });
        const read = readGameRuntimeIndexUrl(new URL(url).search);

        expect(new URL(url).pathname).toBe("/index.html");
        expect(read).toEqual({ policy: "log", logPath: LOG, crashDetails: null, launch: null });
    });

    it("states the policy even when there is no failure to draw", () => {
        // The page that comes back from a restart has to know as much as the one that died.
        const url = buildGameRuntimeIndexUrl({ policy: "restart", logPath: LOG });
        expect(url).not.toContain("nlcrash");
        expect(readGameRuntimeIndexUrl(new URL(url).search).policy).toBe("restart");
    });

    it("round-trips a death description through the query", () => {
        const details = "The game's display process exited: crashed (exit code 2)";
        const url = buildGameRuntimeIndexUrl({ policy: "details", logPath: LOG, crashDetails: details });
        expect(readGameRuntimeIndexUrl(new URL(url).search).crashDetails).toBe(details);
    });
});

describe("what a page makes of an address that says nothing", () => {
    it("keeps the default policy where no policy is stated", () => {
        // The web export: a static file nobody navigates to with a query.
        expect(readGameRuntimeIndexUrl("")).toEqual({
            policy: "details",
            logPath: null,
            crashDetails: null,
            launch: null,
        });
    });

    it("refuses a policy it does not recognize rather than carrying it", () => {
        expect(readGameRuntimeIndexUrl("?nlpolicy=shout").policy).toBe("details");
    });

    it("drops a launch it cannot read, and the page measures from itself", () => {
        expect(readGameRuntimeIndexUrl("?nllaunch=%7Bnot-json").launch).toBeNull();
        expect(readGameRuntimeIndexUrl(`?nllaunch=${encodeURIComponent(JSON.stringify({ origin: "process" }))}`).launch).toBeNull();
    });
});

describe("the launch the page is placed against", () => {
    it("round-trips when the process began and what it did before the page", () => {
        const launch = {
            origin: "process" as const,
            zero: 1_726_900_000_000,
            milestones: [
                { name: "appReady" as const, at: 1_726_900_000_180 },
                { name: "windowCreated" as const, at: 1_726_900_000_240 },
            ],
        };
        const url = buildGameRuntimeIndexUrl({ policy: "log", logPath: LOG, launch });

        expect(readGameRuntimeIndexUrl(new URL(url).search).launch).toEqual(launch);
    });

    it("survives the crash screen's restart, because it is still the same process", () => {
        const launch = { origin: "process" as const, zero: 1_726_900_000_000, milestones: [] };
        const url = buildGameRuntimeIndexUrl({ policy: "log", logPath: LOG, crashDetails: "boom", launch });

        expect(readGameRuntimeIndexUrl(withoutGameRuntimeCrashDetails(new URL(url).search)).launch).toEqual(launch);
    });

    it("keeps only the milestones it knows, in the order they happened", () => {
        const raw = JSON.stringify({
            origin: "process",
            zero: 1000,
            milestones: [
                { name: "windowCreated", at: 1300 },
                { name: "somethingElse", at: 1100 },
                { name: "appReady", at: 1200 },
                { name: "appReady", at: 900 },
            ],
        });

        expect(readGameRuntimeIndexUrl(`?nllaunch=${encodeURIComponent(raw)}`).launch?.milestones).toEqual([
            { name: "appReady", at: 1200 },
            { name: "windowCreated", at: 1300 },
        ]);
    });
});

describe("restarting from the crash screen", () => {
    it("drops the failure and keeps everything else", () => {
        // Clearing the whole query would take the policy and the log path with it, leaving the
        // restarted game knowing less about itself than the one that crashed.
        const url = buildGameRuntimeIndexUrl({ policy: "log", logPath: LOG, crashDetails: "boom" });
        const next = withoutGameRuntimeCrashDetails(new URL(url).search);

        expect(readGameRuntimeIndexUrl(next)).toEqual({
            policy: "log",
            logPath: LOG,
            crashDetails: null,
            launch: null,
        });
    });

    it("leaves no stray question mark where there was nothing else", () => {
        expect(withoutGameRuntimeCrashDetails("?nlcrash=boom")).toBe("");
    });
});
