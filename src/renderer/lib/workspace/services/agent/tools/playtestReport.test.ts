import { describe, expect, it } from "vitest";
import { DevModeAgentErrorCode, type DevModeAgentGameState } from "@shared/types/devMode";
import { describeAdvance, describeGameState, launchIsUp, playtestHint } from "./playtestReport";

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
