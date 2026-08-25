/**
 * Which of the things under the pointer get asked about one input, and where the asking stops.
 *
 * A click lands on a stack, not on a thing: an authored page, and behind it the surfaces the game
 * draws into its own slots. Before this the topmost one simply swallowed it, because that is what
 * one DOM hit test does. A lane is one of those surfaces, and this walks them front to back:
 *
 *  - `none` is never asked. It is not under the pointer as far as input is concerned.
 *  - `pass` is asked, and the walk carries on behind it.
 *  - `capture` is asked and the walk stops there, whether or not anything inside it listened.
 *
 * `capture` is the default (`UI_SURFACE_DEFAULT_INPUT_MODE`), so a document written before any of
 * this existed walks exactly one lane and behaves as it always did.
 *
 * Kept pure and away from the DOM: the ordering rule and the stopping rule are the whole of the
 * routing decision, and a test can drive them with three plain records instead of a mounted game.
 *
 * Comments in English per project convention.
 */

import type { UISurfaceInputMode } from "@shared/types/ui-editor/inputAction";

/**
 * Which host draws a lane.
 *
 * The order between the two is fixed rather than authored: the app page stack is always in front of
 * the stage slots, which is what the composite already paints (`GameApp` puts the surface system
 * over the stage layer). A page that wants input to reach the stage says `input: "pass"`; there is
 * deliberately no cross-host layering number for an author to set, because the two hosts do not
 * share a stacking context and a number that pretended they did would be unimplementable.
 */
export type UIInputLaneHost = "page" | "stageSlot";

const HOST_ORDER: Record<UIInputLaneHost, number> = {
    page: 0,
    stageSlot: 1,
};

export type UIInputLaneDescriptor = {
    /** Stable identity of this lane: the page entry key, or the stage slot id. */
    key: string;
    host: UIInputLaneHost;
    /**
     * Position inside this host's own stack, higher being nearer the player - the page stack's layer
     * index, or the slot's paint order. Only compared against lanes of the same host.
     */
    depth: number;
    input: UISurfaceInputMode;
};

/**
 * The lanes ordered front to back.
 *
 * Stable within one host and one depth, so lanes a caller could not distinguish stay in the order it
 * handed them over.
 */
export function orderInputLanes<T extends UIInputLaneDescriptor>(lanes: readonly T[]): T[] {
    return lanes
        .map((lane, index) => ({ lane, index }))
        .sort((a, b) => {
            const hostDelta = HOST_ORDER[a.lane.host] - HOST_ORDER[b.lane.host];
            if (hostDelta !== 0) {
                return hostDelta;
            }
            const depthDelta = b.lane.depth - a.lane.depth;
            if (depthDelta !== 0) {
                return depthDelta;
            }
            return a.index - b.index;
        })
        .map(entry => entry.lane);
}

/** What one lane did with the input it was asked about. */
export type UIInputLaneStepResult = {
    /**
     * Whether an action fired here and took the input off the walk.
     *
     * An element head firing does not count. Element heads are "I want this", not "this is mine"
     * (see the walk in `devModeBlueprintHostAdapter`), and a lane that stopped the walk because a
     * decorative panel happened to listen would be the ownership rule back under another name. Only
     * a declared action with `consume` says the surface is answering the input.
     */
    consumed: boolean;
};

export type UIInputLaneWalkStop = "capture" | "consume";

/**
 * Whether the input stops at a lane that has just answered, and what stopped it.
 *
 * The whole stopping rule, in one place, because the walk below is not the only thing that applies
 * it: on screen the lanes are found by a DOM hit test rather than by a list, and the surface shell
 * asks this same question about itself as the event goes past. Two spellings of it would drift, and
 * the drift would look like "the mode does nothing on real pages".
 */
export function stopsAtLane(input: UISurfaceInputMode, consumed: boolean): UIInputLaneWalkStop | null {
    if (consumed) {
        return "consume";
    }
    return input === "capture" ? "capture" : null;
}

export type UIInputLaneWalkOutcome<T extends UIInputLaneDescriptor> = {
    /** The lanes that were asked, in the order they were asked. */
    asked: T[];
    /** The lane the walk stopped at, or null when it ran out of lanes. */
    stoppedAt: T | null;
    /** Why it stopped there. */
    stoppedBy: UIInputLaneWalkStop | null;
};

/**
 * Walk the lanes under one input, front to back.
 *
 * `ask` runs one lane's whole answer - its element walk and then its declared actions - and reports
 * only whether an action consumed the input. Sequential and awaited rather than fired in parallel:
 * a lane behind a `pass` lane must see whatever the one in front did to the runtime, and the two
 * ordering rules an author can observe (innermost element first, front lane first) are the same
 * rule seen at two scales.
 */
export async function walkInputLanes<T extends UIInputLaneDescriptor>(
    lanes: readonly T[],
    ask: (lane: T) => Promise<UIInputLaneStepResult> | UIInputLaneStepResult,
): Promise<UIInputLaneWalkOutcome<T>> {
    const asked: T[] = [];
    for (const lane of orderInputLanes(lanes)) {
        if (lane.input === "none") {
            continue;
        }
        asked.push(lane);
        const result = await ask(lane);
        const stoppedBy = stopsAtLane(lane.input, result.consumed);
        if (stoppedBy) {
            return { asked, stoppedAt: lane, stoppedBy };
        }
    }
    return { asked, stoppedAt: null, stoppedBy: null };
}
