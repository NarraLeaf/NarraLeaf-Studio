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
    type DevModeAgentIssue,
    type DevModeAgentResult,
} from "@shared/types/devMode";
import type { RequestStatus } from "@shared/types/ipcEvents";
import {
    actOnElement,
    browserInputEnvironment,
    describeDrawnElement,
    describeKnownKeys,
    gameCentre,
    isPointerKey,
    keyEventInit,
    listDrawnSurfaces,
    PlaytestPointer,
    pressKey,
    resolveInputTarget,
    type InputEnvironment,
} from "./agentPlaytestInput";

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
    /** The least a pointer or key act waits before reading what it did: a press is answered asynchronously. */
    inputMinMs: 300,
    /** How long what is on screen has to hold still after a pointer or key act before it is read. */
    inputQuietMs: 500,
    /** The most a pointer or key act waits for the screen to settle (a page transition, a fade). */
    inputMaxMs: 4000,
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
        ...(state.waitingForClick ? { waitingForClick: true } : {}),
        ...(state.pausedBy ? { pausedBy: { ...state.pausedBy } } : {}),
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
    if (from.waitingForClick !== next.waitingForClick) {
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
    if (!state.inGame || state.choices !== null || state.waitingForClick) {
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
 * Wait (bounded) for the game to come to rest, the way {@link settleLine} needs it: up to `appearMs`
 * for a line, a menu or the story leaving - and longer while the story is visibly holding on
 * something of its own. A timed `/wait` gets its own length on top, and a `/video` the story waits
 * out gets as long as the call allows: neither is a game that is stuck, and a 10 s window used to
 * call a scene that ended on `/wait 3`, a video and an `/ending` stuck on every call, never reaching
 * the ending.
 */
async function waitForStop(
    game: PlaytestGame,
    leftKey: string | null,
    appearMs: number,
    clock: PlaytestClock,
    timing: PlaytestTiming,
    deadline: number,
): Promise<GameAppTestState | null> {
    let end = Math.min(clock.now() + appearMs, deadline);
    let pausedSince: string | null = null;
    for (;;) {
        const state = game.read();
        if (reachedStop(state, leftKey)) {
            return state;
        }
        const pause = state?.inGame ? state.pausedBy : null;
        const key = pause ? JSON.stringify(pause) : null;
        if (pause && key !== pausedSince) {
            // Measured from when the pause is first seen, once per pause: a timed wait gets its own
            // length plus the usual window, a video the whole call.
            pausedSince = key;
            end = pause.kind === "video"
                ? deadline
                : Math.min(Math.max(end, clock.now() + pause.ms + appearMs), deadline);
        }
        if (clock.now() >= end) {
            return state;
        }
        await clock.sleep(timing.pollMs);
    }
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
        state = await waitForStop(game, leftKey, options.appearMs, clock, timing, deadline);
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

/** Why an advance stopped with no line on screen, as specifically as the game can say. */
function noLineMessage(state: GameAppTestState, timing: PlaytestTiming): string {
    const pause = state.pausedBy;
    if (pause?.kind === "video") {
        return "A video is playing and the story waits for it to end; it had not ended when this call ran out of time. "
            + "Call playtest_advance again to keep waiting, or skip it as a player can with playtest_key {key:\"Space\"} "
            + "(or a click on the stage).";
    }
    if (pause?.kind === "timed") {
        return `The story is in a timed wait (/wait ${Math.round(pause.ms / 100) / 10} s) that had not finished. `
            + "Call playtest_advance again once it has had time to run.";
    }
    return `No line came up within ${Math.round(timing.appearMs / 1000)} s: the scene may be waiting on `
        + "something a click does not skip (an input the scene asks for, a blueprint that has not answered).";
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
    request: { steps: number; choice?: number; endingsSeen?: number },
    clock: PlaytestClock,
    timing: PlaytestTiming = PLAYTEST_TIMING,
    budgetMs: number = DEV_MODE_AGENT_BUDGET_MS.advance - 2000,
): Promise<PlaytestAdvanceOutcome> {
    const deadline = clock.now() + budgetMs;
    let advanced = 0;
    // Endings the window had already told an agent about. One that ran between two calls - the
    // story held on a video past the last call's budget and then ended - is reported by the next
    // call, rather than lost behind "no story is running".
    let endingsBefore: number | null = request.endingsSeen ?? null;
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
        if (state && endingsBefore !== null && state.endings < endingsBefore) {
            // A fresh game app counts from zero again.
            endingsBefore = 0;
        }
        if (!state || !state.inGame) {
            last = state;
            if (state && reachedEnding(state)) {
                // Said as what happened: the story reached its ending since the last call.
                return finish(state);
            }
            return finish(state, NOT_IN_GAME_MESSAGE);
        }
        endingsBefore ??= state.endings;
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
                if (state?.inGame && !state.line && !state.choices && state.pausedBy) {
                    // Out of time while the story holds on something of its own: say what.
                    return finish(state, noLineMessage(state, timing));
                }
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
            if (!state.line && state.waitingForClick) {
                // A `/wait click` row: the story is stopped until the player clicks, with no line on
                // screen. The click a player makes is one step, like reading on past a line.
                const waiting = state;
                await game.advance();
                let released = await waitUntil(game, next => !next || !next.waitingForClick || movedOn(waiting, next), timing.moveMs, clock, timing, deadline);
                if (released === undefined) {
                    await game.advance();
                    released = await waitUntil(game, next => !next || !next.waitingForClick || movedOn(waiting, next), timing.moveMs, clock, timing, deadline);
                }
                if (released === undefined) {
                    return finish(game.read(), "The game is waiting for a click (a `/wait click` row) and two clicks on the stage did not "
                        + "release it. Try playtest_click on the element the scene expects, or playtest_key {key:\"Enter\"}.");
                }
                advanced += 1;
                state = await settleLine(game, null, clock, timing, deadline, { appearMs: timing.appearMs, typingMs: timing.typingMs });
                last = state ?? last;
                continue;
            }
            if (!state.line && !blind) {
                return finish(state, noLineMessage(state, timing));
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

// ---------------------------------------------------------------------------------------------
// Pointer and key acts
// ---------------------------------------------------------------------------------------------

/** How a pointer or key act reaches the game; the browser's DOM in Dev Mode, a stand-in under test. */
export type PlaytestInputOptions = {
    /** The game as the input module reads it, or null when it has no root yet. */
    environment?: (controls: GameAppTestControls) => InputEnvironment | null;
    /** Where the pointer rests between acts; one per window. */
    pointer?: PlaytestPointer;
    /**
     * The errors and warnings the window has reported in this run, newest first - what its issue
     * strip counts. Attached to every answer that says where the game is, so an agent hears about a
     * warning the author can see.
     */
    readIssues?: () => DevModeAgentIssue[];
    /** What the window remembers between calls; one per window. */
    memory?: PlaytestMemory;
};

/**
 * What a window remembers between an agent's calls: the endings it has already reported. An ending
 * reached while no call was running - the story held on a video past the last call's budget, then
 * ended - is the next call's to report.
 */
export type PlaytestMemory = { endingsReported: number | null };

const windowMemory: PlaytestMemory = { endingsReported: null };

const windowPointer = new PlaytestPointer();

function browserEnvironmentOf(controls: GameAppTestControls): InputEnvironment | null {
    const root = controls.readGameRoot();
    return root ? browserInputEnvironment(root, controls.readUiDocument()) : null;
}

type ScreenReading = { state: DevModeAgentGameState; surfaces: string[] };

function readScreen(getControls: () => GameAppTestControls | null, environment: PlaytestInputOptions["environment"]): ScreenReading {
    const controls = getControls();
    if (!controls) {
        return { state: toAgentGameState(null), surfaces: [] };
    }
    const env = (environment ?? browserEnvironmentOf)(controls);
    return { state: toAgentGameState(controls.readState()), surfaces: env ? listDrawnSurfaces(env) : [] };
}

function screenKey(reading: ScreenReading): string {
    const { state } = reading;
    return JSON.stringify([
        state.ready, state.inGame, state.entries, state.page, state.line, state.choices, reading.surfaces,
    ]);
}

/**
 * Wait (bounded) for the screen to hold still after an act: at least `inputMinMs`, then until nothing
 * on it - the surfaces drawn, the page, the line, the menu - has changed for `inputQuietMs`, or
 * `inputMaxMs` has passed. A press opens a page through a transition and runs its graph
 * asynchronously, so what is on screen the instant after the click is not what the click did.
 */
async function settleScreen(
    read: () => ScreenReading,
    clock: PlaytestClock,
    timing: PlaytestTiming,
): Promise<ScreenReading> {
    const start = clock.now();
    let last = read();
    let lastKey = screenKey(last);
    let stableSince = start;
    for (;;) {
        await clock.sleep(timing.pollMs * 2);
        const now = clock.now();
        const next = read();
        const key = screenKey(next);
        if (key !== lastKey) {
            last = next;
            lastKey = key;
            stableSince = now;
        }
        if (now - start >= timing.inputMinMs && now - stableSince >= timing.inputQuietMs) {
            return last;
        }
        if (now - start >= timing.inputMaxMs) {
            return last;
        }
    }
}

function quoted(names: readonly string[]): string {
    return names.map(name => `"${name}"`).join(", ");
}

/** What an act changed on screen, one phrase each, for the agent that cannot see it. */
export function describeScreenChange(before: ScreenReading, after: ScreenReading): string[] {
    const changed: string[] = [];
    const opened = after.surfaces.filter(name => !before.surfaces.includes(name));
    const closed = before.surfaces.filter(name => !after.surfaces.includes(name));
    if (opened.length > 0) {
        changed.push(`now showing ${quoted(opened)}`);
    }
    if (closed.length > 0) {
        changed.push(`no longer showing ${quoted(closed)}`);
    }
    const was = before.state;
    const is = after.state;
    if (!was.inGame && is.inGame) {
        changed.push("a story started");
    } else if (was.inGame && !is.inGame) {
        changed.push("the story was left");
    } else if (is.inGame && is.entries !== was.entries) {
        changed.push("a story was entered again (a load or a restart)");
    }
    if (is.page !== was.page && is.page) {
        changed.push(`the page on screen is now "${is.page}"`);
    }
    const lineKey = (line: DevModeAgentGameState["line"]) => (line ? `${line.speaker ?? ""}\u0000${line.text}` : null);
    if (lineKey(is.line) !== lineKey(was.line) && is.line) {
        changed.push(`the line on screen is now ${is.line.speaker ?? "narration"}: "${is.line.text}"`);
    }
    if (!was.choices && is.choices) {
        changed.push("a choice menu came up");
    } else if (was.choices && !is.choices) {
        changed.push("the choice menu closed");
    }
    return changed;
}

async function runInputAction(
    getControls: () => GameAppTestControls | null,
    controls: GameAppTestControls,
    action: Extract<DevModeAgentAction, { kind: "pointer" | "key" }>,
    clock: PlaytestClock,
    timing: PlaytestTiming,
    input: PlaytestInputOptions,
): Promise<RequestStatus<DevModeAgentResult>> {
    const environmentOf = input.environment ?? browserEnvironmentOf;
    const pointer = input.pointer ?? windowPointer;
    const env = environmentOf(controls);
    if (!env) {
        return {
            success: false,
            code: DevModeAgentErrorCode.starting,
            error: "The game in the Dev Mode window has not drawn anything yet; try again in a moment.",
        };
    }
    const refuse = (message: string): RequestStatus<DevModeAgentResult> => ({
        success: false,
        code: DevModeAgentErrorCode.inputTarget,
        error: message,
    });
    const before = readScreen(getControls, environmentOf);
    let did: string;
    if (action.kind === "pointer") {
        const resolved = resolveInputTarget(env, { element: action.element, surface: action.surface, index: action.index });
        if (resolved.kind === "refused") {
            return refuse(resolved.message);
        }
        const outcome = actOnElement(env, pointer, resolved.target, action.gesture, action.at);
        if (outcome.kind === "refused") {
            return refuse(outcome.message);
        }
        const verb = action.gesture === "click" ? "Clicked" : "Pointed at";
        did = `${verb} ${describeDrawnElement(outcome.target)}.`;
    } else if (isPointerKey(action.key)) {
        const centre = gameCentre(env);
        if (!centre) {
            return refuse("The game has no box on screen to aim at.");
        }
        pointer.moveTo(centre.node, centre.x, centre.y);
        if (action.key === "rightClick") {
            pointer.press(2);
            did = "Right-clicked the middle of the game.";
        } else {
            pointer.wheel(action.key === "wheelUp" ? -100 : 100);
            did = `Turned the wheel ${action.key === "wheelUp" ? "up" : "down"} one notch over the middle of the game.`;
        }
    } else {
        const init = keyEventInit(action.key);
        if (!init) {
            return refuse(`"${action.key}" is not a key playtest_key presses. Keys: ${describeKnownKeys()}.`);
        }
        pressKey(env, init, action.shift === true);
        did = `Pressed ${action.shift ? "Shift+" : ""}${action.key}.`;
    }
    const after = await settleScreen(() => readScreen(getControls, environmentOf), clock, timing);
    return {
        success: true,
        data: {
            kind: "input",
            did,
            surfaces: after.surfaces,
            changed: describeScreenChange(before, after),
            state: after.state,
        },
    };
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
    input: PlaytestInputOptions = {},
): Promise<RequestStatus<DevModeAgentResult>> {
    const result = await runAgentDriveActionInner(getControls, action, clock, timing, input);
    if (!result.success || result.data.kind === "capture" || !input.readIssues) {
        return result;
    }
    let issues: DevModeAgentIssue[] = [];
    try {
        issues = input.readIssues();
    } catch {
        // The list is a courtesy; an answer about where the game is must not fail on it.
    }
    return issues.length > 0 ? { success: true, data: { ...result.data, issues } } : result;
}

async function runAgentDriveActionInner(
    getControls: () => GameAppTestControls | null,
    action: DevModeAgentAction,
    clock: PlaytestClock,
    timing: PlaytestTiming,
    input: PlaytestInputOptions,
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
    if (!controls && (action.kind === "advance" || action.kind === "pointer" || action.kind === "key" || action.settle)) {
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

    if (action.kind === "pointer" || action.kind === "key") {
        try {
            return await runInputAction(getControls, controls, action, clock, timing, input);
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
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
        if (action.baseline) {
            (input.memory ?? windowMemory).endingsReported = game.read()?.endings ?? 0;
        }
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

    const memory = input.memory ?? windowMemory;
    const outcome = await advanceLines(
        game,
        { steps: action.steps, choice: action.choice, ...(memory.endingsReported !== null ? { endingsSeen: memory.endingsReported } : {}) },
        clock,
        timing,
    );
    const endedAt = outcome.state ?? game.read();
    if (endedAt) {
        memory.endingsReported = endedAt.endings;
    }
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
