/**
 * An agent's play-test, as the Dev Mode window carries it out: read where the game is, photograph
 * it, or read on through its lines.
 *
 * Everything goes through the test controls the game app publishes (`GameAppTestControls`), so an
 * advance is the click a player makes and a choice goes through the choice runtime. What this adds
 * is the reading between the clicks, which a player does with their eyes: a click on a line still
 * typing only completes it, so a step that counted clicks moved half as far as it said - one step
 * here is one line, finished typing. And every wait is bounded and ends in a sentence, because
 * the agent on the other end cannot see a window that is simply not answering.
 *
 * Pure apart from the clock it is handed, so the step logic is pinned by tests without a game.
 *
 * Comments in English per project convention.
 */

import type { GameAppTestControls, GameAppTestState } from "@/lib/ui-editor/runtime/app/GameApp";
import {
    DEV_MODE_AGENT_BUDGET_MS,
    DevModeAgentErrorCode,
    type DevModeAgentAction,
    type DevModeAgentGameState,
    type DevModeAgentResult,
} from "@shared/types/devMode";
import type { RequestStatus } from "@shared/types/ipcEvents";

export type PlaytestClock = {
    now(): number;
    sleep(ms: number): Promise<void>;
    /** `requestAnimationFrame`, or a stand-in: only used to tell whether the window is drawing. */
    requestFrame(callback: () => void): void;
};

export const browserPlaytestClock: PlaytestClock = {
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
    requestFrame: callback => {
        window.requestAnimationFrame(() => callback());
    },
};

export const PLAYTEST_TIMING = {
    /** How often the game is read while waiting on it. */
    pollMs: 50,
    /** How long a click on a whole line has to take the game off it before the step is called stuck. */
    moveMs: 3000,
    /**
     * How long the next line is given to come up once the game has left the last one: the rows in
     * between (a transition, a `/show` with a duration, a scene change and its assets) run first.
     */
    appearMs: 10_000,
    /** The same, for the first line after a launch, which waits on the scene's assets. */
    firstAppearMs: 10_000,
    /** How long a new line is given to finish typing by itself before a click completes it. */
    typingMs: 1500,
    /** How long the completing click is given to show the whole line. */
    completeMs: 1000,
    /** The pause after a click whose effect cannot be read (an engine that reports no dialog state). */
    blindPauseMs: 400,
    /** How long a page (the title, an ending page) is given to come up once the story is left. */
    pageMs: 8000,
};

export type PlaytestTiming = typeof PLAYTEST_TIMING;

/** The game, as this module drives it: through whatever controls are current at each act. */
export type PlaytestGame = {
    advance(): Promise<void>;
    choose(engineIndex: number): Promise<void>;
    /**
     * Where the game is; null while it has no controls - between two sessions, which is where a
     * quit to a page (an `/ending`, the story running out) passes on its way to that page.
     */
    read(): GameAppTestState | null;
};

export const NOT_IN_GAME_MESSAGE =
    "No story is running - a page such as the title is showing. playtest_advance reads on through dialogue; "
    + "start from a scene with playtest_start {scene} to play one.";

export function toAgentGameState(state: GameAppTestState | null): DevModeAgentGameState {
    if (!state) {
        return { ready: false, inGame: false, entries: 0, line: null, choices: null, page: null };
    }
    return {
        ready: true,
        inGame: state.inGame,
        entries: state.entries,
        line: state.line ? { ...state.line } : null,
        choices: state.choices ? state.choices.map(choice => ({ text: choice.text, disabled: choice.disabled })) : null,
        page: state.page,
    };
}

function lineKey(state: GameAppTestState | null): string | null {
    if (!state?.line) {
        return null;
    }
    // The engine names each line (`lineId`); the words only stand in for an engine that cannot.
    return state.lineId ?? `${state.line.speaker ?? ""}\u0000${state.line.text}`;
}

/** Whether `next` is somewhere other than `from`, as far as a reader can tell. */
export function movedOn(from: GameAppTestState, next: GameAppTestState | null): boolean {
    if (!next || !next.inGame || next.entries !== from.entries || next.endings !== from.endings) {
        return true;
    }
    if (next.choices !== null && from.choices === null) {
        return true;
    }
    if (lineKey(next) !== lineKey(from)) {
        return true;
    }
    // Same words, same speaker, and no line id to tell them apart - a line repeated word for word.
    // It shows as the old one typing again.
    return Boolean(from.line?.complete && next.line && !next.line.complete);
}

/**
 * Whether `next` is `from`'s own line, now shown in full: a click that only finished the typing, or
 * the typewriter running out by itself. Not a move - the reader is still on the same line - but not a
 * stuck game either.
 */
export function completedInPlace(from: GameAppTestState, next: GameAppTestState | null): boolean {
    return Boolean(
        next?.inGame && from.line && !from.line.complete && next.line?.complete && next.choices === null
            && lineKey(next) === lineKey(from),
    );
}

/**
 * Whether the game has come to rest somewhere a reader stops: a line other than `leftKey`, a menu,
 * or out of the story.
 */
function reachedStop(state: GameAppTestState | null, leftKey: string | null): boolean {
    if (!state) {
        return false;
    }
    if (!state.inGame || state.choices !== null) {
        return true;
    }
    return state.line !== null && lineKey(state) !== leftKey;
}

async function waitUntil(
    game: PlaytestGame,
    test: (state: GameAppTestState | null) => boolean,
    ms: number,
    clock: PlaytestClock,
    timing: PlaytestTiming,
    deadline: number,
): Promise<GameAppTestState | null | undefined> {
    const end = Math.min(clock.now() + ms, deadline);
    for (;;) {
        const state = game.read();
        if (test(state)) {
            return state;
        }
        if (clock.now() >= end) {
            return undefined;
        }
        await clock.sleep(timing.pollMs);
    }
}

/** Out of the story: wait (bounded) for the page it went to, so the answer names that page. */
async function settleOutOfStory(
    game: PlaytestGame,
    clock: PlaytestClock,
    timing: PlaytestTiming,
    deadline: number,
): Promise<GameAppTestState | null> {
    const landed = await waitUntil(
        game,
        next => next !== null && (next.inGame || next.page !== null),
        timing.pageMs,
        clock,
        timing,
        deadline,
    );
    return landed === undefined ? game.read() : landed;
}

/**
 * Bring the game to rest: wait for a line other than `leftKey` (any line when null), a menu, or the
 * game leaving the story; let a line still typing finish - clicking once to complete it when it
 * takes longer than `typingMs`. Answers where the game ended up.
 */
async function settleLine(
    game: PlaytestGame,
    leftKey: string | null,
    clock: PlaytestClock,
    timing: PlaytestTiming,
    deadline: number,
    options: { appearMs: number; typingMs: number },
): Promise<GameAppTestState | null> {
    let state = game.read();
    if (!reachedStop(state, leftKey)) {
        state = await waitUntil(game, next => reachedStop(next, leftKey), options.appearMs, clock, timing, deadline) ?? game.read();
    }
    if (!state || !state.inGame) {
        return settleOutOfStory(game, clock, timing, deadline);
    }
    if (!state.line || state.line.complete || state.choices || lineKey(state) === leftKey) {
        return state;
    }
    const typing = state;
    const finished = await waitUntil(
        game,
        next => !next || !next.line || next.line.complete || next.choices !== null || lineKey(next) !== lineKey(typing),
        options.typingMs,
        clock,
        timing,
        deadline,
    );
    if (finished !== undefined) {
        return finished && !finished.inGame ? settleOutOfStory(game, clock, timing, deadline) : finished;
    }
    // Read again right before the click: a line that finished in the last poll must not be clicked
    // past, which would move the game a line further than it was asked to go. The read and the
    // click run in one turn of the page's event loop, so nothing finishes in between.
    const now = game.read();
    if (now?.line && !now.line.complete && !now.choices && lineKey(now) === lineKey(typing)) {
        await game.advance();
        await waitUntil(
            game,
            next => !next || !next.line || next.line.complete || lineKey(next) !== lineKey(typing),
            timing.completeMs,
            clock,
            timing,
            deadline,
        );
    }
    return game.read();
}

/**
 * Where an advance ended. `state` is null only when the game had no controls at the end. `ending`
 * is set when an `/ending` row ran during the advance: its name, or null for one with no name.
 */
export type PlaytestAdvanceOutcome = {
    advanced: number;
    error?: string;
    ending?: { name: string | null };
    state: GameAppTestState | null;
};

/**
 * Read on `steps` lines, picking the `choice`-th option first when given. `choice` is 1-based over
 * the options as shown; see `DevModeAgentAction`.
 *
 * One step is one click on a line shown in full, and it is over when the game has come to rest
 * again: on the NEXT line, shown in full, or a menu, or out of the story. So the answer always names
 * what is on screen, and a screenshot taken right after shows exactly that.
 */
export async function advanceLines(
    game: PlaytestGame,
    request: { steps: number; choice?: number },
    clock: PlaytestClock,
    timing: PlaytestTiming = PLAYTEST_TIMING,
    budgetMs: number = DEV_MODE_AGENT_BUDGET_MS.advance - 2000,
): Promise<PlaytestAdvanceOutcome> {
    const deadline = clock.now() + budgetMs;
    let advanced = 0;
    let endingsBefore: number | null = null;
    let last: GameAppTestState | null = null;
    const readOrNull = (): GameAppTestState | null => {
        try {
            return game.read();
        } catch {
            return null;
        }
    };
    /** Whether an `/ending` ran since the advance began, as far as the last read can tell. */
    const reachedEnding = (state: GameAppTestState | null): GameAppTestState | null => {
        const known = state ?? last;
        return known && endingsBefore !== null && known.endings > endingsBefore ? known : null;
    };
    const finish = (state: GameAppTestState | null, error?: string): PlaytestAdvanceOutcome => {
        const ended = reachedEnding(state);
        return { advanced, ...(error ? { error } : {}), ...(ended ? { ending: { name: ended.lastEnding } } : {}), state };
    };
    try {
        let state = game.read();
        if (!state || !state.inGame) {
            return finish(state, NOT_IN_GAME_MESSAGE);
        }
        endingsBefore = state.endings;
        // A scene still coming up gets its first line before anything is clicked - a click into a
        // transition is swallowed - and a line still typing is completed, so the first step reads
        // on to the NEXT line rather than spending itself finishing this one.
        state = await settleLine(game, null, clock, timing, deadline, { appearMs: timing.appearMs, typingMs: 0 });
        last = state ?? last;
        // An engine that does not report its dialog state, with no line read after that wait: every
        // later step would wait as long again for nothing, so from here on the steps are paced.
        const blind = Boolean(state && state.inGame && !state.readable && state.line === null && state.choices === null);

        if (request.choice !== undefined) {
            const options = state?.choices;
            if (!state || !options) {
                return finish(state, "No choice menu is showing, so there is nothing to pick. Leave out `choice` to read on.");
            }
            const option = options[request.choice - 1];
            if (!option) {
                return finish(state, `The menu shows ${options.length} option(s); choice ${request.choice} is not one of them (choice is 1-based).`);
            }
            if (option.disabled) {
                return finish(state, `Option ${request.choice} ("${option.text}") is disabled, so the game will not take it.`);
            }
            const leftKey = lineKey(state);
            await game.choose(option.index);
            const closed = await waitUntil(game, next => !next || !next.inGame || next.choices === null, timing.moveMs, clock, timing, deadline);
            if (closed === undefined) {
                return finish(game.read(), `The menu was still showing after option ${request.choice} ("${option.text}") was picked.`);
            }
            advanced += 1;
            // A prompt line written above the menu is not the line the pick leads to.
            state = await settleLine(game, leftKey, clock, timing, deadline, { appearMs: timing.appearMs, typingMs: timing.typingMs });
            last = state ?? last;
        }

        while (advanced < request.steps) {
            if (clock.now() >= deadline) {
                return finish(state, `Stopped after ${advanced} of ${request.steps} step(s): one advance may take at most ${Math.round(budgetMs / 1000)} s.`);
            }
            if (!state || !state.inGame) {
                // An ending is where a story is meant to stop: said as what happened, not as a refusal.
                return finish(state, reachedEnding(state) ? undefined : "The game is no longer in a story: it ran out of rows or went back to a page.");
            }
            if (state.choices) {
                return finish(state, "A choice menu is showing. Pick an option with `choice` (1-based, in the order shown).");
            }
            if (reachedEnding(state)) {
                // An ending with no page of its own leaves the last frame standing, story and all.
                return finish(state);
            }
            if (!state.line && !blind) {
                return finish(state, `No line came up within ${Math.round(timing.appearMs / 1000)} s: the scene may be waiting on `
                    + "something a click does not skip (a timed pause, a video, an input the scene asks for).");
            }
            const from = state;
            await game.advance();
            if (blind) {
                await clock.sleep(timing.blindPauseMs);
                advanced += 1;
                state = readOrNull();
                continue;
            }
            let moved = await waitUntil(
                game,
                next => movedOn(from, next) || completedInPlace(from, next),
                timing.moveMs,
                clock,
                timing,
                deadline,
            );
            if (moved === undefined) {
                // A click can be swallowed - one that lands as a scene comes up after timed waits, say,
                // while the engine is not yet taking input. A click the engine took leaves this line
                // (its dialog state is settled at once), so the same line still on screen, whole and
                // unchanged, means the click went nowhere, and one more cannot skip a line.
                const still = readOrNull();
                if (still?.inGame && still.line?.complete && still.choices === null && lineKey(still) === lineKey(from)) {
                    await game.advance();
                    moved = await waitUntil(game, next => movedOn(from, next), timing.moveMs, clock, timing, deadline);
                }
            }
            if (moved === undefined) {
                return finish(game.read(),
                    `The game did not move on after the click (waited ${Math.round((timing.moveMs * 2) / 1000)} s and clicked twice): `
                    + "it may be waiting on something a click does not skip (a timed pause longer than that, a video, an input "
                    + "the scene asks for), or the story has nothing after this line. playtest_screenshot shows where it is; "
                    + "call playtest_advance again once a timed pause has had time to run.",
                );
            }
            if (!movedOn(from, moved) && completedInPlace(from, moved)) {
                // The click finished the typing - the earlier completing click was swallowed, or the line
                // was still typing when the step began. Still the same line: not a step, click again.
                state = moved;
                continue;
            }
            advanced += 1;
            state = await settleLine(game, lineKey(from), clock, timing, deadline, { appearMs: timing.appearMs, typingMs: timing.typingMs });
            last = state ?? last;
        }
        return finish(state);
    } catch (error) {
        return finish(readOrNull(), error instanceof Error ? error.message : String(error));
    }
}

/** The engine's stage capture, bounded, with what was waiting named when it runs out. */
export async function captureWithin(
    capture: () => Promise<string | null>,
    clock: PlaytestClock,
    budgetMs: number = DEV_MODE_AGENT_BUDGET_MS.capture - 1000,
): Promise<RequestStatus<DevModeAgentResult>> {
    // Counted for the length of the capture: it is the one thing that tells "the window is not
    // drawing" (the capture waits on a frame) from "the capture is slow or stuck on its own".
    let frames = 0;
    let counting = true;
    const tick = () => {
        frames += 1;
        if (counting) {
            clock.requestFrame(tick);
        }
    };
    clock.requestFrame(tick);
    const timedOut = Symbol("timedOut");
    try {
        const png = await Promise.race([capture(), clock.sleep(budgetMs).then(() => timedOut)]);
        if (png === timedOut) {
            const seconds = Math.round(budgetMs / 1000);
            return {
                success: false,
                code: DevModeAgentErrorCode.captureTimeout,
                error: frames === 0
                    ? `The game's stage capture did not finish within ${seconds} s: it waits on an animation frame, and the Dev Mode `
                        + "window drew none in that time (minimised, or on a desktop that is not showing). Bring the window into view, "
                        + "or call playtest_stop and then playtest_start, and take the screenshot again."
                    : `The game's stage capture did not finish within ${seconds} s although the window was drawing. Take the `
                        + "screenshot again; if it keeps failing, console_read shows what the Dev Mode window reported.",
            };
        }
        return { success: true, data: { kind: "capture", png: (png as string | null) ?? "", source: "engine" } };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
        counting = false;
    }
}

/**
 * One play-test action, start to answer. `getControls` is read at every act rather than once,
 * because the game app republishes its controls whenever its session is remounted (a start, a
 * reload) and an advance must not keep clicking a session that has gone.
 */
export async function runAgentDriveAction(
    getControls: () => GameAppTestControls | null,
    action: DevModeAgentAction,
    clock: PlaytestClock,
    timing: PlaytestTiming = PLAYTEST_TIMING,
): Promise<RequestStatus<DevModeAgentResult>> {
    if (action.kind === "capture") {
        const controls = getControls();
        // No controls yet means nothing to capture yet: an empty answer, and main photographs the
        // window instead.
        return captureWithin(() => (controls ? controls.capture() : Promise.resolve(null)), clock);
    }

    // The game app publishes its controls once a story could be started; a request that arrives
    // before then waits a little for them, so a call right after a launch is not lost.
    let controls = getControls();
    if (!controls && (action.kind === "advance" || action.settle)) {
        const end = clock.now() + timing.firstAppearMs;
        while (!controls && clock.now() < end) {
            await clock.sleep(timing.pollMs * 4);
            controls = getControls();
        }
    }
    if (!controls) {
        if (action.kind === "state") {
            return { success: true, data: { kind: "state", state: toAgentGameState(null) } };
        }
        return {
            success: false,
            code: DevModeAgentErrorCode.starting,
            error: "The game in the Dev Mode window is still starting; try again in a moment.",
        };
    }

    const live = (): GameAppTestControls => {
        const current = getControls();
        if (!current) {
            throw new Error("The game in the Dev Mode window stopped while it was being driven.");
        }
        return current;
    };
    const game: PlaytestGame = {
        advance: () => live().advance(),
        choose: index => live().choose(index),
        // No controls is a place the game passes through (a quit to a page remounts the session),
        // not an error: the read says so and the waits above wait it out.
        read: () => getControls()?.readState() ?? null,
    };

    if (action.kind === "state") {
        try {
            const state = action.settle
                ? await settleLine(game, null, clock, timing, clock.now() + DEV_MODE_AGENT_BUDGET_MS.state - 1000, {
                    appearMs: timing.firstAppearMs,
                    typingMs: timing.typingMs,
                })
                : game.read();
            return { success: true, data: { kind: "state", state: toAgentGameState(state) } };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    const outcome = await advanceLines(game, { steps: action.steps, choice: action.choice }, clock, timing);
    return {
        success: true,
        data: {
            kind: "advance",
            advanced: outcome.advanced,
            ...(outcome.error ? { error: outcome.error } : {}),
            ...(outcome.ending ? { ending: outcome.ending } : {}),
            state: toAgentGameState(outcome.state),
        },
    };
}
