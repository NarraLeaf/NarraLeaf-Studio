import { describe, expect, it } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    initialNavigationState,
    reduceNavigation,
    type NavigationState,
} from "./navigationMachine";
import type { AppNavEntry } from "../types";

let seq = 0;

function makeEntry(surfaceId: string, waitForExit = false): AppNavEntry {
    seq += 1;
    const key = `${surfaceId}:${seq}`;
    return {
        key,
        runtimeScopeId: key,
        sessionKey: "session-1",
        surfaceId,
        direction: "forward",
        waitForExit,
        props: {},
        presentation: "appPage",
    };
}

type AnimationPartial = {
    enter?: "fade" | "none";
    exit?: "fade" | "none";
    enterDurationSeconds?: number;
    exitDurationSeconds?: number;
    exitBlocking?: boolean;
};

function makeSurface(id: string, animation: AnimationPartial = {}): UISurface {
    return {
        id,
        kind: "appSurface",
        settings: {
            pageAnimation: {
                enter: animation.enter ?? "fade",
                exit: animation.exit ?? "fade",
                enterDurationSeconds: animation.enterDurationSeconds ?? 0.2,
                exitDurationSeconds: animation.exitDurationSeconds ?? 0.2,
                enterDirection: "auto",
                exitDirection: "auto",
                enterAngleDegrees: 0,
                exitAngleDegrees: 0,
                exitBlocking: animation.exitBlocking ?? false,
            },
        },
    } as unknown as UISurface;
}

function resetTo(entry: AppNavEntry): NavigationState {
    return reduceNavigation(initialNavigationState, { type: "RESET", initialEntry: entry }).state;
}

describe("navigationMachine", () => {
    it("RESET installs the initial entry as stack and visible set", () => {
        const entry = makeEntry("home");
        const state = resetTo(entry);
        expect(state.navStack).toEqual([entry]);
        expect(state.visibleEntries).toEqual([entry]);
        expect(state.presenceMode).toBe("sync");
        expect(state.direction).toBe("forward");
    });

    it("OPEN (sync, non-blocking exit) stacks the entry and marks the underlay pending", () => {
        const home = makeEntry("home");
        const state = resetTo(home);
        const next = makeEntry("settings");
        const { state: opened, transition } = reduceNavigation(state, {
            type: "OPEN",
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        expect(opened.navStack).toEqual([home, next]);
        expect(opened.presenceMode).toBe("sync");
        // Incoming layer first, outgoing behind it until its prepaint finishes.
        expect(opened.visibleEntries.map(e => e.key)).toEqual([next.key, home.key]);
        expect(opened.pendingUnderlayReadyKey).toBe(next.key);
        expect(opened.pendingWaitEntry).toBeNull();
        expect(transition).toEqual({ durationMs: 200, waitForEnter: true, waitForExit: true });

        // Prepaint of the incoming layer drops the outgoing underlay.
        const { state: settled } = reduceNavigation(opened, { type: "PREPAINT_READY", entryKey: next.key });
        expect(settled.visibleEntries.map(e => e.key)).toEqual([next.key]);
        expect(settled.pendingUnderlayReadyKey).toBeNull();
    });

    it("OPEN with a blocking exit waits for all layers to exit before showing the new entry", () => {
        const home = makeEntry("home");
        const state = resetTo(home);
        const next = makeEntry("settings", true);
        const { state: opened, transition } = reduceNavigation(state, {
            type: "OPEN",
            fromSurface: makeSurface("home", { exitBlocking: true }),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        expect(opened.presenceMode).toBe("wait");
        expect(opened.visibleEntries).toEqual([]);
        expect(opened.pendingWaitEntry).toBe(next);
        // exit (200ms) + enter (200ms) run in sequence in wait mode.
        expect(transition?.durationMs).toBe(400);

        const { state: exited } = reduceNavigation(opened, { type: "ALL_EXITED" });
        expect(exited.presenceMode).toBe("sync");
        expect(exited.visibleEntries).toEqual([next]);
        expect(exited.pendingWaitEntry).toBeNull();
    });

    it("OPEN with zero exit duration holds the outgoing layer until the enter completes", () => {
        const home = makeEntry("home");
        const state = resetTo(home);
        const next = makeEntry("settings");
        const { state: opened } = reduceNavigation(state, {
            type: "OPEN",
            fromSurface: makeSurface("home", { exit: "none" }),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        expect(opened.visibleEntries.map(e => ({ key: e.key, exitBehind: e.exitBehind }))).toEqual([
            { key: home.key, exitBehind: true },
            { key: next.key, exitBehind: undefined },
        ]);
        expect(opened.pendingRemoveAfterEnterKey).toBe(next.key);
        expect(opened.pendingUnderlayReadyKey).toBeNull();

        const { state: entered } = reduceNavigation(opened, { type: "ENTER_COMPLETE", entryKey: next.key });
        expect(entered.visibleEntries.map(e => e.key)).toEqual([next.key]);
        expect(entered.pendingRemoveAfterEnterKey).toBeNull();
    });

    it("ENTER_COMPLETE for a non-active entry is ignored", () => {
        const home = makeEntry("home");
        const state = resetTo(home);
        const next = makeEntry("settings");
        const { state: opened } = reduceNavigation(state, {
            type: "OPEN",
            fromSurface: makeSurface("home", { exit: "none" }),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        const { state: unchanged } = reduceNavigation(opened, { type: "ENTER_COMPLETE", entryKey: home.key });
        expect(unchanged).toBe(opened);
    });

    it("OPEN while hidden for the game shows only the overlay entry", () => {
        const home = makeEntry("home");
        const state = resetTo(home);
        const overlay = makeEntry("pause");
        const { state: opened, transition } = reduceNavigation(state, {
            type: "OPEN",
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("pause"),
            currentHiddenForGame: true,
            reducedMotion: false,
            createNextEntry: () => overlay,
        });
        expect(opened.visibleEntries).toEqual([overlay]);
        expect(opened.pendingUnderlayReadyKey).toBeNull();
        // Only the enter animation counts when the outgoing stack is hidden.
        expect(transition?.durationMs).toBe(200);
        expect(transition?.waitForExit).toBe(false);
    });

    it("CLOSE pops the stack with back direction and no transition on a root stack", () => {
        const home = makeEntry("home");
        const rootOnly = reduceNavigation(resetTo(home), {
            type: "CLOSE",
            fromSurface: makeSurface("home"),
            targetSurface: null,
            targetHiddenForGame: false,
            reducedMotion: false,
        });
        expect(rootOnly.state.navStack).toEqual([home]);
        expect(rootOnly.transition).toBeUndefined();

        const next = makeEntry("settings");
        const { state: opened } = reduceNavigation(resetTo(home), {
            type: "OPEN",
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        const { state: closed, transition } = reduceNavigation(opened, {
            type: "CLOSE",
            fromSurface: makeSurface("settings"),
            targetSurface: makeSurface("home"),
            targetHiddenForGame: false,
            reducedMotion: false,
        });
        expect(closed.direction).toBe("back");
        expect(closed.navStack).toHaveLength(1);
        expect(closed.navStack[0]?.surfaceId).toBe("home");
        expect(transition).toBeDefined();
    });

    it("HIDE_ALL_FOR_GAME clears visible entries and pending transition bookkeeping", () => {
        const home = makeEntry("home");
        const next = makeEntry("settings");
        const { state: opened } = reduceNavigation(resetTo(home), {
            type: "OPEN",
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        const { state: hidden } = reduceNavigation(opened, { type: "HIDE_ALL_FOR_GAME" });
        expect(hidden.visibleEntries).toEqual([]);
        expect(hidden.pendingUnderlayReadyKey).toBeNull();
        expect(hidden.pendingWaitEntry).toBeNull();
        expect(hidden.pendingRemoveAfterEnterKey).toBeNull();
        expect(hidden.presenceMode).toBe("sync");
        // The stack itself is preserved (entries come back after Quit Game).
        expect(hidden.navStack).toEqual(opened.navStack);
    });

    it("reduced motion collapses transitions to zero duration", () => {
        const home = makeEntry("home");
        const next = makeEntry("settings");
        const { transition } = reduceNavigation(resetTo(home), {
            type: "OPEN",
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: true,
            createNextEntry: () => next,
        });
        expect(transition?.durationMs).toBe(0);
    });
});
