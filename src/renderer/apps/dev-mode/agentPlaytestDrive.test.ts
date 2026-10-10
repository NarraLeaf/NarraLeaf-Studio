import { describe, expect, it } from "vitest";
import type { GameAppTestControls, GameAppTestState } from "@/lib/ui-editor/runtime/app/GameApp";
import { buildGameTestState } from "@/lib/ui-editor/runtime/app/gameTestState";
import { DevModeAgentErrorCode } from "@shared/types/devMode";
import {
    NOT_IN_GAME_MESSAGE,
    PLAYTEST_TIMING,
    advanceLines,
    captureWithin,
    movedOn,
    runAgentDriveAction,
    type PlaytestClock,
    type PlaytestGame,
} from "./agentPlaytestDrive";

/**
 * An agent's play-test, step by step, against a pretend engine on a pretend clock.
 *
 * The engine is modelled on what the real one does, because the bug these pin came from a gap
 * between the two (acceptance run #2: every reported line one step behind the screen):
 *
 * - a `say` announces its line and begins a dialog state; the typewriter runs `typeMs`, a click on a
 *   line still typing completes it, a click on a whole line settles it and the story reads on;
 * - the rows between two lines (`/show … d=0.4`, `/sound`) run by themselves for `ms`, during which
 *   the engine has no current dialog - but the box still draws the last line, whole, and the
 *   current action id changes with every row. Both of those are modelled (`boxText`, `actionId`) and
 *   neither may leak into what the driver reads;
 * - a click during those rows is swallowed;
 * - an `/ending` counts itself, tears the session down (no controls for `quitMs`) and lands on a page.
 *
 * The state the driver reads is put together by the real `buildGameTestState`.
 */

type ScriptItem =
    | { say: string; speaker?: string | null; typeMs: number }
    | { rows: number }
    | { menu: { text: string; index: number; disabled?: boolean; to: number }[] }
    | { ending: string | null; page?: string | null; quitMs?: number };

function virtualClock(options: { frames?: boolean } = {}): PlaytestClock & { advanceTo(ms: number): void } {
    let now = 0;
    let frames = 0;
    return {
        now: () => now,
        sleep: async ms => {
            now += ms;
            await Promise.resolve();
        },
        requestFrame: callback => {
            if (options.frames !== false && frames < 3) {
                frames += 1;
                queueMicrotask(callback);
            }
        },
        advanceTo: ms => {
            now = ms;
        },
    };
}

function pretendEngine(clock: PlaytestClock, script: ScriptItem[], options: { startAt?: number; readable?: boolean; clickGuardMs?: number } = {}) {
    let position = 0;
    let startedAt = options.startAt ?? 0;
    let started = false;
    let completedByClick = false;
    let promptSerial = 0;
    let prompt: { serial: number; speaker: string | null; text: string } | null = null;
    let endings = 0;
    let lastEnding: string | null = null;
    let inGame = true;
    let page: string | null = null;
    let controlsBackAt: number | null = null;
    /** What the dialogue box still draws: the last line, after it is settled. Never to be reported. */
    let boxText: string | null = null;
    /** The engine's current action; it changes with every row, line or not. Never to be reported. */
    let actionId = "start";
    const clicks: string[] = [];

    const enter = (index: number, at: number) => {
        position = index;
        startedAt = at;
        completedByClick = false;
        actionId = `action-${index}`;
        const item = script[index];
        if (item && "say" in item) {
            promptSerial += 1;
            prompt = { serial: promptSerial, speaker: item.speaker ?? null, text: item.say };
            boxText = item.say;
        }
        if (item && "ending" in item) {
            endings += 1;
            lastEnding = item.ending;
            inGame = false;
            controlsBackAt = at + (item.quitMs ?? 600);
            page = item.page === undefined ? "Title" : item.page;
        }
    };
    /** Run the rows that run by themselves, up to now. */
    const sync = () => {
        if (!started) {
            if (clock.now() < startedAt) {
                return;
            }
            started = true;
            enter(0, startedAt);
        }
        for (;;) {
            const item = script[position];
            if (!inGame || !item || !("rows" in item) || clock.now() < startedAt + item.rows) {
                return;
            }
            enter(position + 1, startedAt + item.rows);
        }
    };
    const current = () => (started && inGame ? script[position] : undefined);
    const lineComplete = (item: { typeMs: number }) => completedByClick || clock.now() - startedAt >= item.typeMs;
    const read = (): GameAppTestState | null => {
        sync();
        if (controlsBackAt !== null && clock.now() < controlsBackAt) {
            return null;
        }
        const item = current();
        const dialog = item && "say" in item ? { actionId, ended: lineComplete(item) } : null;
        return buildGameTestState({
            inGame,
            entries: 1,
            dialog: options.readable === false ? undefined : dialog,
            prompt,
            choices: item && "menu" in item
                ? item.menu.map(option => ({ index: option.index, text: option.text, disabled: option.disabled === true }))
                : null,
            endings,
            lastEnding,
            page: inGame ? null : page,
        });
    };
    const game: PlaytestGame & { clicks: string[]; boxText: () => string | null } = {
        clicks,
        boxText: () => boxText,
        read,
        advance: async () => {
            sync();
            const item = current();
            if (!item || !("say" in item)) {
                clicks.push("swallowed");
                return;
            }
            // An engine that takes no input for a moment after a line comes up.
            if (options.clickGuardMs !== undefined && clock.now() - startedAt < options.clickGuardMs) {
                clicks.push("swallowed");
                return;
            }
            if (!lineComplete(item)) {
                completedByClick = true;
                clicks.push(`complete ${item.say}`);
                return;
            }
            if (position === script.length - 1) {
                clicks.push(`nothing after ${item.say}`);
                return;
            }
            clicks.push(`next from ${item.say}`);
            enter(position + 1, clock.now());
            sync();
        },
        choose: async engineIndex => {
            sync();
            const item = current();
            if (!item || !("menu" in item)) {
                throw new Error("no menu");
            }
            const option = item.menu.find(entry => entry.index === engineIndex);
            if (!option) {
                throw new Error(`no option ${engineIndex}`);
            }
            clicks.push(`choose ${option.text}`);
            enter(option.to, clock.now());
            sync();
        },
    };
    return game;
}

const LONG = 5000;
const SHORT = 200;

describe("advanceLines: one step is one line, and the answer is what is on screen", () => {
    it("is not a line behind across rows with no line (/show d=0.4, /sound) - acceptance run #2", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "最后一班车进站的时候…", typeMs: SHORT },
            { rows: 400 },
            { rows: 50 },
            { say: "你也是等这班车的吗？", speaker: "林", typeMs: 900 },
            { say: "我还以为今晚只有我一个人。", speaker: "林", typeMs: 900 },
            { rows: 300 },
            { say: "车门打开，", typeMs: SHORT },
        ]);
        clock.advanceTo(SHORT);
        let outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome).toMatchObject({ advanced: 1, state: { line: { speaker: "林", text: "你也是等这班车的吗？", complete: true } } });
        expect(outcome.error).toBeUndefined();
        outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome.state?.line).toEqual({ speaker: "林", text: "我还以为今晚只有我一个人。", complete: true });
        outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome.state?.line).toEqual({ speaker: null, text: "车门打开，", complete: true });
        // One click per line, none spent completing a line or lost in the rows between two.
        expect(game.clicks).toEqual([
            "next from 最后一班车进站的时候…",
            "next from 你也是等这班车的吗？",
            "next from 我还以为今晚只有我一个人。",
        ]);
    });

    it("never reports the line the box still draws once the engine has settled it", () => {
        // The box keeps drawing the last line, whole, while the rows after it run; the engine says
        // no line is current. The engine is believed.
        const state = buildGameTestState({
            inGame: true,
            entries: 1,
            dialog: null,
            prompt: { serial: 3, speaker: "林", text: "你也是等这班车的吗？" },
            choices: null,
            endings: 0,
            lastEnding: null,
            page: null,
        });
        expect(state.line).toBeNull();
        expect(state.lineId).toBeNull();
        expect(state.readable).toBe(true);
    });

    it("counts lines only: rows with no line between them are not steps", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "start", typeMs: 0 },
            { rows: 100 },
            { rows: 100 },
            { say: "only line", speaker: "林", typeMs: 0 },
            { rows: 100 },
            { menu: [{ text: "A", index: 0, to: 5 }] },
            { say: "after", typeMs: 0 },
        ]);
        const outcome = await advanceLines(game, { steps: 5 }, clock);
        expect(outcome.advanced).toBe(2);
        expect(outcome.error).toMatch(/choice menu is showing/);
        expect(outcome.state?.choices?.map(choice => choice.text)).toEqual(["A"]);
        expect(game.clicks).not.toContain("swallowed");
    });

    it("lets a short line finish by itself and completes a long one with one click", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "one", speaker: "林", typeMs: LONG },
            { say: "two", speaker: "林", typeMs: LONG },
            { say: "three", speaker: "林", typeMs: SHORT },
        ]);
        const outcome = await advanceLines(game, { steps: 2 }, clock);
        expect(outcome.advanced).toBe(2);
        expect(outcome.state?.line).toEqual({ speaker: "林", text: "three", complete: true });
        expect(game.clicks).toEqual(["complete one", "next from one", "complete two", "next from two"]);
    });

    it("tells a line repeated word for word from the one before it", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "again", typeMs: SHORT },
            { say: "again", typeMs: SHORT },
            { say: "done", typeMs: SHORT },
        ]);
        clock.advanceTo(SHORT);
        const outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome.state?.lineId).toBe("line-2");
        expect(outcome.state?.line).toEqual({ speaker: null, text: "again", complete: true });
        expect(game.clicks).toEqual(["next from again"]);
    });

    it("waits for a scene's first line before clicking, so an early advance is not swallowed", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "one", typeMs: SHORT },
            { say: "two", typeMs: SHORT },
        ], { startAt: 1200 });
        const outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome.advanced).toBe(1);
        expect(outcome.state?.line?.text).toBe("two");
        expect(game.clicks).not.toContain("swallowed");
    });

    it("takes `choice` as 1-based over the options shown, and does not stop on the menu's prompt line", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { menu: [{ text: "A", index: 0, to: 1 }, { text: "C", index: 2, to: 3 }] },
            { say: "after A", typeMs: SHORT },
            { rows: 300 },
            { say: "after C", typeMs: SHORT },
        ]);
        const outcome = await advanceLines(game, { steps: 1, choice: 2 }, clock);
        expect(outcome.error).toBeUndefined();
        expect(outcome.advanced).toBe(1);
        expect(game.clicks).toEqual(["choose C"]);
        expect(outcome.state?.line).toEqual({ speaker: null, text: "after C", complete: true });
    });

    it("refuses a choice out of range or with no menu, without clicking", async () => {
        const clock = virtualClock();
        const menuGame = pretendEngine(clock, [{ menu: [{ text: "A", index: 0, to: 1 }] }]);
        expect((await advanceLines(menuGame, { steps: 1, choice: 2 }, clock)).error).toMatch(/1 option\(s\); choice 2/);
        const lineGame = pretendEngine(clock, [{ say: "one", typeMs: 0 }]);
        expect((await advanceLines(lineGame, { steps: 1, choice: 1 }, clock)).error).toMatch(/No choice menu/);
        expect(menuGame.clicks).toEqual([]);
    });

    it("reads on from a scene that opens with timed waits, though the click that would complete its first line is swallowed", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { rows: 3000 },
            { say: "one", typeMs: LONG },
            { say: "two", typeMs: SHORT },
        ], { clickGuardMs: 300 });
        const outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome.error).toBeUndefined();
        expect(outcome.advanced).toBe(1);
        expect(outcome.state?.line).toEqual({ speaker: null, text: "two", complete: true });
        expect(game.clicks).toEqual(["swallowed", "complete one", "next from one"]);
    });

    it("clicks once more when a click on a whole line was swallowed", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "one", typeMs: 0 },
            { say: "two", typeMs: 0 },
        ], { clickGuardMs: 2000 });
        clock.advanceTo(10);
        const outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome.error).toBeUndefined();
        expect(outcome.advanced).toBe(1);
        expect(outcome.state?.line?.text).toBe("two");
        expect(game.clicks).toEqual(["swallowed", "next from one"]);
    });

    it("stops with a reason when a click does not move the game", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [{ say: "the end", typeMs: 0 }]);
        const outcome = await advanceLines(game, { steps: 3 }, clock);
        expect(outcome.advanced).toBe(0);
        expect(outcome.error).toMatch(/did not move on/);
    });

    it("says so when no line comes up after a click, instead of clicking into the rows", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "one", typeMs: 0 },
            { rows: 60_000 },
            { say: "much later", typeMs: 0 },
        ]);
        const outcome = await advanceLines(game, { steps: 2 }, clock);
        expect(outcome.advanced).toBe(1);
        expect(outcome.error).toMatch(/No line came up within 10 s/);
        expect(game.clicks).toEqual(["next from one"]);
    });

    it("names the ending reached and the page the game went to, counting the line clicked past", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "真的赶上了。", typeMs: 0 },
            { say: "一起去看日出吧。", speaker: "林", typeMs: 0 },
            { rows: 200 },
            { say: "天亮了。", typeMs: 0 },
            { ending: "海边的日出", page: "Title", quitMs: 1500 },
        ]);
        const outcome = await advanceLines(game, { steps: 5 }, clock);
        expect(outcome.advanced).toBe(3);
        expect(outcome.error).toBeUndefined();
        expect(outcome.ending).toEqual({ name: "海边的日出" });
        expect(outcome.state).toMatchObject({ inGame: false, page: "Title", line: null });
    });

    it("stops at an ending with no page, which leaves the last frame standing", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "last", typeMs: 0 },
            { ending: null, page: null, quitMs: 0 },
        ]);
        const outcome = await advanceLines(game, { steps: 3 }, clock);
        expect(outcome.advanced).toBe(1);
        expect(outcome.ending).toEqual({ name: null });
    });

    it("paces the steps of an engine that reports no dialog state, waiting for a line only once", async () => {
        const clock = virtualClock();
        let clicks = 0;
        const blind: PlaytestGame = {
            read: () => buildGameTestState({
                inGame: true, entries: 1, dialog: undefined, prompt: null, choices: null, endings: 0, lastEnding: null, page: null,
            }),
            advance: async () => {
                clicks += 1;
            },
            choose: async () => undefined,
        };
        const outcome = await advanceLines(blind, { steps: 3 }, clock);
        expect(outcome).toMatchObject({ advanced: 3 });
        expect(outcome.error).toBeUndefined();
        expect(clicks).toBe(3);
        expect(clock.now()).toBeLessThan(PLAYTEST_TIMING.appearMs + 3 * PLAYTEST_TIMING.blindPauseMs + 500);
    });

    it("refuses on the title page rather than clicking it", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [{ ending: null, page: "Title", quitMs: 0 }]);
        const outcome = await advanceLines(game, { steps: 1 }, clock);
        expect(outcome).toMatchObject({ advanced: 0, error: NOT_IN_GAME_MESSAGE });
        expect(game.clicks).toEqual([]);
    });

    it("stops when its time budget runs out, saying how far it got", async () => {
        const clock = virtualClock();
        const script = Array.from({ length: 50 }, (_, index) => ({ say: `line ${index}`, typeMs: LONG }));
        const game = pretendEngine(clock, script);
        const outcome = await advanceLines(game, { steps: 50 }, clock, PLAYTEST_TIMING, 10_000);
        expect(outcome.advanced).toBeGreaterThan(0);
        expect(outcome.advanced).toBeLessThan(50);
        expect(outcome.error).toMatch(/Stopped after \d+ of 50/);
    });
});

describe("movedOn", () => {
    const base = buildGameTestState({
        inGame: true,
        entries: 1,
        dialog: { actionId: "a", ended: true },
        prompt: { serial: 1, speaker: null, text: "same" },
        choices: null,
        endings: 0,
        lastEnding: null,
        page: null,
    });
    it("sees the line settled, a new line, a menu, an ending and the controls going as moves", () => {
        expect(movedOn(base, base)).toBe(false);
        expect(movedOn(base, { ...base, line: null, lineId: null })).toBe(true);
        expect(movedOn(base, { ...base, lineId: "line-2" })).toBe(true);
        expect(movedOn(base, { ...base, choices: [] })).toBe(true);
        expect(movedOn(base, { ...base, endings: 1 })).toBe(true);
        expect(movedOn(base, { ...base, inGame: false })).toBe(true);
        expect(movedOn(base, null)).toBe(true);
    });
});

describe("captureWithin: a capture that never settles", () => {
    it("answers in its budget, naming the missing frames, instead of hanging", async () => {
        const clock = virtualClock({ frames: false });
        const answer = await captureWithin(() => new Promise<string>(() => undefined), clock, 9000);
        expect(answer.success).toBe(false);
        expect(answer.code).toBe(DevModeAgentErrorCode.captureTimeout);
        expect(answer.error).toMatch(/within 9 s: it waits on an animation frame, and the Dev Mode window drew none/);
        expect(clock.now()).toBe(9000);
    });

    it("says the window was drawing when it was", async () => {
        const clock = virtualClock({ frames: true });
        const answer = await captureWithin(() => new Promise<string>(() => undefined), clock, 9000);
        expect(answer.error).toMatch(/although the window was drawing/);
    });

    it("passes a capture through, and an empty one as empty", async () => {
        const clock = virtualClock();
        expect(await captureWithin(async () => "data:image/png;base64,AAAA", clock)).toEqual({
            success: true,
            data: { kind: "capture", png: "data:image/png;base64,AAAA", source: "engine" },
        });
        expect(await captureWithin(async () => null, clock)).toMatchObject({ success: true, data: { png: "" } });
    });
});

describe("runAgentDriveAction", () => {
    function controlsFor(game: PlaytestGame): GameAppTestControls | null {
        if (game.read() === null) {
            return null;
        }
        return {
            startStory: async () => undefined,
            advance: game.advance,
            choose: game.choose,
            capture: async () => null,
            readState: () => game.read()!,
        };
    }

    it("waits for the game's controls before an advance, then reports where it landed", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "one", speaker: "林", typeMs: 0 },
            { say: "two", speaker: "林", typeMs: 0 },
        ]);
        const answer = await runAgentDriveAction(() => (clock.now() >= 1000 ? controlsFor(game) : null), { kind: "advance", steps: 1 }, clock);
        expect(answer).toMatchObject({
            success: true,
            data: { kind: "advance", advanced: 1, state: { ready: true, inGame: true, line: { speaker: "林", text: "two", complete: true } } },
        });
    });

    it("rides out the controls going away on the way to an ending page, and names the ending", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [
            { say: "最后一句", typeMs: 0 },
            { ending: "独自归途", page: "Title", quitMs: 2000 },
        ]);
        const answer = await runAgentDriveAction(() => controlsFor(game), { kind: "advance", steps: 5 }, clock);
        expect(answer).toMatchObject({
            success: true,
            data: { kind: "advance", advanced: 1, ending: { name: "独自归途" }, state: { ready: true, inGame: false, page: "Title" } },
        });
        expect(answer.success && answer.data.kind === "advance" && answer.data.error).toBeFalsy();
    });

    it("refuses with the starting code when the controls never come", async () => {
        const clock = virtualClock();
        const answer = await runAgentDriveAction(() => null, { kind: "advance", steps: 1 }, clock);
        expect(answer).toMatchObject({ success: false, code: DevModeAgentErrorCode.starting });
    });

    it("reads the state without waiting when not asked to settle", async () => {
        const clock = virtualClock();
        expect(await runAgentDriveAction(() => null, { kind: "state" }, clock)).toEqual({
            success: true,
            data: { kind: "state", state: { ready: false, inGame: false, entries: 0, line: null, choices: null, page: null } },
        });
        expect(clock.now()).toBe(0);
    });

    it("settles a first line still typing into a whole one", async () => {
        const clock = virtualClock();
        const game = pretendEngine(clock, [{ say: "first", typeMs: LONG }]);
        const answer = await runAgentDriveAction(() => controlsFor(game), { kind: "state", settle: true }, clock);
        expect(answer).toMatchObject({ success: true, data: { state: { line: { text: "first", complete: true } } } });
        expect(game.clicks).toEqual(["complete first"]);
    });
});
