/**
 * Making the player's pad shake.
 *
 * # The two motors
 *
 * A `mapping === "standard"` pad carries two eccentric rotating masses, one in each grip:
 *
 *  - `strongMagnitude` - the large, low-frequency motor in the LEFT grip. Deep and heavy: an engine,
 *    an earthquake, a door slammed somewhere below.
 *  - `weakMagnitude` - the small, high-frequency motor in the RIGHT grip. Light and buzzing: a tap on
 *    the shoulder, a phone on a table.
 *
 * They are two sensations at once, not one sensation at two levels, which is why a rumble is a pair.
 *
 * # One call is one envelope
 *
 * `playEffect("dual-rumble", …)` takes a duration and one magnitude per motor. There is no curve and
 * no repeat, so a pattern that pulses twice is two rows - the rhythm is legible on the page instead of
 * hidden in a composer the pad cannot play.
 *
 * # Silence is the answer that is never wrong
 *
 * No pad connected, a pad that is not standard-mapping, an engine with no actuator, a `playEffect`
 * that rejects: every one of those is silent, and none of them throws into the story. A machine that
 * cannot shake is not an error surface - the author did nothing wrong by writing the row.
 *
 * # Why the wait is ours and not the promise's
 *
 * `playEffect` resolves when the effect completes, but a rejected or superseded effect leaves a promise
 * that never settles on some engines. So {@link playGamepadRumble} waits on its own timer and treats
 * the promise as fire-and-forget, which also makes the wait interruptible: an abort - a rollback, a
 * load, a scene left - stops the pad rather than letting it shake on over a picture that is gone.
 *
 * Comments in English per project convention.
 */

import type { StoryRumbleShape } from "@shared/types/story";

type Actuator = {
    playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
    reset?: () => Promise<unknown>;
};

/** Where the pads come from. A seam for tests; the game reads the window's navigator. */
export type GamepadSource = () => readonly (Gamepad | null)[];

function navigatorPads(): readonly (Gamepad | null)[] {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
        return [];
    }
    return navigator.getGamepads() ?? [];
}

/** Every connected standard-mapping pad, the same set `gamepadState` reads buttons from. */
function standardPads(source: GamepadSource): Gamepad[] {
    return source().filter((pad): pad is Gamepad => Boolean(pad && pad.mapping === "standard"));
}

/**
 * The actuator of a pad, typed loosely on purpose: `vibrationActuator` is younger than most DOM
 * typings, and missing it is a supported outcome rather than a bug.
 */
function actuatorOf(pad: Gamepad): Actuator | null {
    const actuator = (pad as { vibrationActuator?: unknown }).vibrationActuator;
    return actuator && typeof actuator === "object" ? (actuator as Actuator) : null;
}

/** Play one effect and swallow whatever comes back - see the module comment on the timer. */
function fire(actuator: Actuator, params: Record<string, number>): void {
    try {
        const result = actuator.playEffect?.("dual-rumble", params);
        if (result && typeof (result as Promise<unknown>).catch === "function") {
            (result as Promise<unknown>).catch(() => {
                // An unsupported effect, a pad that went away mid-rumble, a superseded effect: all
                // silence, and none of it may reach the story.
            });
        }
    } catch {
        // A throw rather than a rejection is the same silence.
    }
}

/**
 * Start a rumble and, when asked, wait for it to finish.
 *
 * Every connected standard pad is shaken: a player with two pads in reach is one player, and guessing
 * which one they are holding is a guess with no upside.
 *
 * Without `wait` it returns at once - a rumble accompanies what is on screen rather than delaying it -
 * but it still stops the pad when `signal` aborts before the rumble would have ended.
 */
export async function playGamepadRumble(
    shape: StoryRumbleShape,
    options: { signal?: AbortSignal; wait?: boolean; source?: GamepadSource } = {},
): Promise<void> {
    const source = options.source ?? navigatorPads;
    if (options.signal?.aborted) {
        return;
    }
    const params = {
        startDelay: 0,
        duration: Math.max(0, shape.durationMs),
        strongMagnitude: shape.strongMagnitude,
        weakMagnitude: shape.weakMagnitude,
    };
    for (const pad of standardPads(source)) {
        const actuator = actuatorOf(pad);
        if (actuator) {
            fire(actuator, params);
        }
    }
    if (params.duration <= 0) {
        return;
    }
    if (!options.wait) {
        stopOnAbort(params.duration, source, options.signal);
        return;
    }
    await new Promise<void>(resolve => {
        const signal = options.signal;
        const onAbort = (): void => {
            clearTimeout(timer);
            stopGamepadRumble(source);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, params.duration);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Stop the pad if the story moves away before the rumble would have ended on its own. The listener is
 * dropped once it would have, so a long scene does not collect one watcher per row.
 */
function stopOnAbort(durationMs: number, source: GamepadSource, signal: AbortSignal | undefined): void {
    if (!signal) {
        return;
    }
    const onAbort = (): void => {
        clearTimeout(timer);
        stopGamepadRumble(source);
    };
    const timer = setTimeout(() => signal.removeEventListener("abort", onAbort), durationMs);
    signal.addEventListener("abort", onAbort, { once: true });
}

/**
 * End every rumble now.
 *
 * `reset` is the API's own stop; a zero-magnitude effect follows it for an actuator that does not have
 * one, since some engines only ever accept a new effect, never a silence.
 */
export function stopGamepadRumble(source: GamepadSource = navigatorPads): void {
    for (const pad of standardPads(source)) {
        const actuator = actuatorOf(pad);
        if (!actuator) {
            continue;
        }
        if (typeof actuator.reset === "function") {
            try {
                const result = actuator.reset();
                if (result && typeof (result as Promise<unknown>).catch === "function") {
                    (result as Promise<unknown>).catch(() => undefined);
                }
            } catch {
                // Fall through to the zero effect below.
            }
        }
        fire(actuator, { startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0 });
    }
}
