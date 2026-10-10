/**
 * What the `playtest_*` tools tell an agent about the game: where it is, and what to do when the
 * Dev Mode window refuses or does not answer.
 *
 * Kept out of `verifyTools` so the sentences and the readiness rule can be pinned without a window.
 *
 * Comments in English per project convention.
 */

import { DevModeAgentErrorCode, type DevModeAgentGameState } from "@shared/types/devMode";

/** One line of prose about where the game is, for the end of a playtest answer. */
export function describeGameState(state: DevModeAgentGameState): string {
    if (!state.ready) {
        return "The game is still starting.";
    }
    if (!state.inGame) {
        return state.page
            ? `No story is running: the "${state.page}" page is showing.`
            : "No story is running: a page such as the title is showing.";
    }
    if (state.choices) {
        const options = state.choices
            .map((choice, index) => `${index + 1}. ${choice.text}${choice.disabled ? " (disabled)" : ""}`)
            .join("; ");
        return `A choice menu is showing: ${options}. Pick one with playtest_advance {choice}.`;
    }
    if (state.line) {
        const who = state.line.speaker ?? "narration";
        return `Now on - ${who}: "${state.line.text}"${state.line.complete ? "" : " (still typing)"}.`;
    }
    return "No line is showing (the game is between two lines).";
}

/**
 * What a play-test advance did, as the opening of its answer: how many lines it read past, and the
 * ending it reached, when it reached one - said as an outcome, because an ending is where a story is
 * meant to stop.
 */
export function describeAdvance(result: { advanced: number; error?: string; ending?: { name: string | null } }): string {
    const lines = `Read on ${result.advanced} line(s)`;
    const ending = result.ending
        ? result.ending.name ? `reached the ending "${result.ending.name}"` : "reached an ending (it has no name)"
        : null;
    if (ending && result.error) {
        return `${lines}, ${ending}, then stopped: ${result.error}`;
    }
    if (ending) {
        return `${lines} and ${ending}.`;
    }
    return result.error ? `${lines}, then stopped: ${result.error}` : `${lines}.`;
}

/** The same, as data for `structuredContent`. */
export function gameStateData(state: DevModeAgentGameState): Record<string, unknown> {
    return {
        inGame: state.inGame,
        line: state.line,
        choices: state.choices,
        ...(state.inGame ? {} : { page: state.page }),
    };
}

/**
 * What to do about a refused play-test action, by the code main gave it. "Start the game" is said
 * only when the game is not running: a running game that does not answer is a different problem,
 * and an agent told to start it again would just repeat the call that failed.
 */
export function playtestHint(code: string | undefined): string | undefined {
    switch (code) {
        case DevModeAgentErrorCode.notRunning:
            return "Start the game with playtest_start.";
        case DevModeAgentErrorCode.starting:
            return "The game is still loading. Call the tool again in a few seconds.";
        case DevModeAgentErrorCode.noAnswer:
            return "The game is running but its window is not responding. Call playtest_stop, then playtest_start, and go on from there.";
        default:
            // A capture that ran out of time already says what to do; anything else is the game's
            // own refusal, which names its reason.
            return undefined;
    }
}

/**
 * Whether a launch has come up far enough for the next playtest call to act on it.
 *
 * A story launch is up once a story has been entered since the launch began - `entries` past the
 * count read before it, or the game seen out of a story in between (a window reopened counts from
 * zero again) - and a line or a menu is showing. A launch onto a page is up as soon as the game
 * can be driven.
 */
export function launchIsUp(
    state: DevModeAgentGameState,
    launch: { story: boolean; entriesBefore: number; sawOutOfStory: boolean },
): boolean {
    if (!state.ready) {
        return false;
    }
    if (!launch.story) {
        return true;
    }
    const entered = state.inGame && (state.entries !== launch.entriesBefore || launch.sawOutOfStory);
    return entered && (state.line !== null || state.choices !== null);
}
