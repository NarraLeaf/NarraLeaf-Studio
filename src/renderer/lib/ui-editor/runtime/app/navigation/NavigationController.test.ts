import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import { NavigationController } from "./NavigationController";
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

function makeSurface(id: string, exitBlocking = false): UISurface {
    return {
        id,
        kind: "appSurface",
        settings: {
            pageAnimation: {
                enter: "fade",
                exit: "fade",
                enterDurationSeconds: 0.2,
                exitDurationSeconds: 0.2,
                enterDirection: "auto",
                exitDirection: "auto",
                enterAngleDegrees: 0,
                exitAngleDegrees: 0,
                exitBlocking,
            },
        },
    } as unknown as UISurface;
}

async function settled(promise: Promise<void>): Promise<boolean> {
    let done = false;
    void promise.then(() => {
        done = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    return done;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("NavigationController", () => {
    it("resolves open() once both enter and exit are complete", async () => {
        const controller = new NavigationController();
        controller.reset(makeEntry("home"));
        const next = makeEntry("settings");
        const promise = controller.open({
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        expect(await settled(promise)).toBe(false);
        controller.markEnterComplete(next.key);
        expect(await settled(promise)).toBe(false);
        controller.markAllExited();
        expect(await settled(promise)).toBe(true);
    });

    it("resolves open() via the timeout fallback when animation signals never arrive", async () => {
        const controller = new NavigationController();
        controller.reset(makeEntry("home"));
        const next = makeEntry("settings");
        const promise = controller.open({
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        // duration (200ms) + prepaint timeout (900ms) + 180ms padding
        vi.advanceTimersByTime(200 + 900 + 180 + 1);
        expect(await settled(promise)).toBe(true);
    });

    it("ignores enter-complete for entries that are not on top of the stack", async () => {
        const controller = new NavigationController();
        const home = makeEntry("home");
        controller.reset(home);
        const next = makeEntry("settings");
        const promise = controller.open({
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: () => next,
        });
        controller.markEnterComplete(home.key);
        controller.markAllExited();
        expect(await settled(promise)).toBe(false);
        controller.markEnterComplete(next.key);
        expect(await settled(promise)).toBe(true);
    });

    it("close() resolves immediately on a root stack", async () => {
        const controller = new NavigationController();
        controller.reset(makeEntry("home"));
        const promise = controller.close({
            fromSurface: makeSurface("home"),
            targetSurface: null,
            targetHiddenForGame: false,
            reducedMotion: false,
        });
        expect(await settled(promise)).toBe(true);
    });

    it("a new open() settles the previous wait before starting its own", async () => {
        const controller = new NavigationController();
        controller.reset(makeEntry("home"));
        const first = controller.open({
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: waitForExit => makeEntry("settings", waitForExit),
        });
        const second = controller.open({
            fromSurface: makeSurface("settings"),
            targetSurface: makeSurface("credits"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: waitForExit => makeEntry("credits", waitForExit),
        });
        // Re-entrant open: the in-flight wait resolves right away (current behavior).
        expect(await settled(first)).toBe(true);
        expect(await settled(second)).toBe(false);
        vi.advanceTimersByTime(200 + 900 + 180 + 1);
        expect(await settled(second)).toBe(true);
    });

    it("hideAllForGame() settles a pending transition and clears visible entries", async () => {
        const controller = new NavigationController();
        controller.reset(makeEntry("home"));
        const promise = controller.open({
            fromSurface: makeSurface("home"),
            targetSurface: makeSurface("settings"),
            currentHiddenForGame: false,
            reducedMotion: false,
            createNextEntry: waitForExit => makeEntry("settings", waitForExit),
        });
        controller.hideAllForGame();
        expect(await settled(promise)).toBe(true);
        expect(controller.getState().visibleEntries).toEqual([]);
    });

    it("notifies subscribers on state changes only", () => {
        const controller = new NavigationController();
        const listener = vi.fn();
        controller.subscribe(listener);
        controller.reset(makeEntry("home"));
        expect(listener).toHaveBeenCalledTimes(1);
        // Prepaint of an unknown key is a no-op reduction: no notification.
        controller.markPrepaintReady("nope");
        expect(listener).toHaveBeenCalledTimes(1);
    });
});
