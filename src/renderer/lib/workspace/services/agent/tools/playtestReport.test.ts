import { describe, expect, it } from "vitest";
import { DevModeAgentErrorCode, type DevModeAgentGameState } from "@shared/types/devMode";
import { describeAdvance, describeGameState, describeInputResult, describeIssues, launchIsUp, playtestHint } from "./playtestReport";

const inStory: DevModeAgentGameState = {
    ready: true,
    inGame: true,
    entries: 2,
    line: { speaker: "林", text: "末班车来了", complete: true },
    choices: null,
    page: null,
};

describe("playtestHint", () => {
    it("says to start the game only when it is not running", () => {
        expect(playtestHint(DevModeAgentErrorCode.notRunning)).toMatch(/playtest_start/);
        expect(playtestHint(DevModeAgentErrorCode.noAnswer)).toMatch(/running but its window is not responding/);
        expect(playtestHint(DevModeAgentErrorCode.noAnswer)).toMatch(/playtest_stop, then playtest_start/);
        expect(playtestHint(DevModeAgentErrorCode.captureTimeout)).toBeUndefined();
        expect(playtestHint(undefined)).toBeUndefined();
    });
});

describe("describeGameState", () => {
    it("names the speaker and the line, or narration", () => {
        expect(describeGameState(inStory)).toBe("Now on - 林: \"末班车来了\".");
        expect(describeGameState({ ...inStory, line: { speaker: null, text: "雨", complete: false } }))
            .toBe("Now on - narration: \"雨\" (still typing).");
    });
    it("numbers a menu's options from 1", () => {
        expect(describeGameState({ ...inStory, line: null, choices: [{ text: "上车", disabled: false }, { text: "留下", disabled: true }] }))
            .toBe("A choice menu is showing: 1. 上车; 2. 留下 (disabled). Pick one with playtest_advance {choice}.");
    });
});

describe("launchIsUp", () => {
    it("waits for a story entered since the launch, with a line up", () => {
        const fresh = { story: true, entriesBefore: -1, sawOutOfStory: false };
        expect(launchIsUp({ ...inStory, ready: false }, fresh)).toBe(false);
        expect(launchIsUp({ ...inStory, line: null }, fresh)).toBe(false);
        expect(launchIsUp(inStory, fresh)).toBe(true);
    });
    it("does not take the game a relaunch replaces for the new one", () => {
        expect(launchIsUp(inStory, { story: true, entriesBefore: 2, sawOutOfStory: false })).toBe(false);
        expect(launchIsUp({ ...inStory, entries: 3 }, { story: true, entriesBefore: 2, sawOutOfStory: false })).toBe(true);
        expect(launchIsUp(inStory, { story: true, entriesBefore: 2, sawOutOfStory: true })).toBe(true);
    });
    it("takes a page launch as up once the game can be driven", () => {
        expect(launchIsUp({ ...inStory, inGame: false, line: null }, { story: false, entriesBefore: -1, sawOutOfStory: false })).toBe(true);
    });
});

describe("describeAdvance", () => {
    it("says an ending as an outcome, with its name, and the page the game went to after it", () => {
        expect(describeAdvance({ advanced: 3, ending: { name: "海边的日出" } })).toBe('Read on 3 line(s) and reached the ending "海边的日出".');
        expect(describeAdvance({ advanced: 1, ending: { name: null } })).toBe("Read on 1 line(s) and reached an ending (it has no name).");
        expect(describeGameState({ ...inStory, inGame: false, line: null, page: "Title" }))
            .toBe('No story is running: the "Title" page is showing.');
    });
    it("gives the reason when it stopped short", () => {
        expect(describeAdvance({ advanced: 1, error: "A choice menu is showing." })).toBe("Read on 1 line(s), then stopped: A choice menu is showing.");
        expect(describeAdvance({ advanced: 2 })).toBe("Read on 2 line(s).");
    });
});

describe("describeInputResult", () => {
    const onTitle: DevModeAgentGameState = { ready: true, inGame: false, entries: 0, line: null, choices: null, page: "Title" };

    it("says what was done, what changed, what is showing, and to look", () => {
        const text = describeInputResult({
            did: "Clicked Title: Root / Menu / Load (id load).",
            changed: ['now showing "Load"'],
            surfaces: ["Title", "Load"],
            state: onTitle,
        });
        expect(text).toBe(
            'Clicked Title: Root / Menu / Load (id load). Then: now showing "Load". On screen: "Title", "Load". '
            + 'No story is running: the "Title" page is showing. Call playtest_screenshot to see it.',
        );
    });

    it("says so when nothing visible changed, rather than claiming the press did nothing", () => {
        const text = describeInputResult({ did: "Pressed Escape.", changed: [], surfaces: ["Title"], state: onTitle });
        expect(text).toContain("Nothing visible changed");
        expect(text).toContain("such as a setting");
    });
});

describe("describeIssues", () => {
    it("counts the run's errors and warnings and says where each happened, newest first", () => {
        const text = describeIssues([
            { level: "warning", message: "Nothing is wired to Value.", surface: "Config" },
            { level: "error", message: "The picture is missing.", story: "Main", scene: "Opening", row: 12 },
        ]);
        expect(text).toBe(
            "Dev Mode reports 1 error(s) and 1 warning(s) in this run, newest first:\n"
            + '- warning at page "Config": Nothing is wired to Value.\n'
            + "- error at Main / Opening:12: The picture is missing.",
        );
    });

    it("says nothing when the run reported nothing, and spells out only the first few", () => {
        expect(describeIssues(undefined)).toBe("");
        expect(describeIssues([])).toBe("");
        const many = Array.from({ length: 20 }, (_, index) => ({ level: "warning" as const, message: `w${index}` }));
        const text = describeIssues(many);
        expect(text).toContain("0 error(s) and 20 warning(s)");
        expect(text).toContain("...and 12 more");
    });
});

describe("launchIsUp past lines", () => {
    const base: DevModeAgentGameState = { ready: true, inGame: true, entries: 1, line: null, choices: null, page: null };

    it("is up on a scene that opens on a timed wait or a video, and on one that already ended", () => {
        const launch = { story: true, entriesBefore: 0, sawOutOfStory: false };
        expect(launchIsUp({ ...base, pausedBy: { kind: "video" } }, launch)).toBe(true);
        expect(launchIsUp({ ...base, pausedBy: { kind: "timed", ms: 3000 } }, launch)).toBe(true);
        expect(launchIsUp({ ...base, inGame: false, page: "Title" }, launch)).toBe(true);
        expect(launchIsUp(base, launch)).toBe(false);
    });

    it("is not up on a window remounted to its title page, which counts from zero again", () => {
        expect(launchIsUp({ ...base, inGame: false, entries: 0, page: "Title" }, { story: true, entriesBefore: 2, sawOutOfStory: false })).toBe(false);
    });
});
