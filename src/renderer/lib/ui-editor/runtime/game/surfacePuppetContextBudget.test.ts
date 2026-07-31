import { afterEach, describe, expect, it, vi } from "vitest";
import {
    SURFACE_PUPPET_CONTEXT_BUDGET,
    __resetSurfacePuppetContextBudget,
    claimSurfacePuppetContext,
    isSurfacePuppetContextGranted,
    releaseSurfacePuppetContext,
    subscribeSurfacePuppetContexts,
    surfacePuppetContextClaims,
    surfacePuppetContextsDenied,
    surfacePuppetContextsGranted,
} from "./surfacePuppetContextBudget";

function claimMany(count: number, prefix = "w"): string[] {
    const keys = Array.from({ length: count }, (_, index) => `${prefix}${index}`);
    for (const key of keys) {
        claimSurfacePuppetContext(key);
    }
    return keys;
}

afterEach(() => {
    __resetSurfacePuppetContextBudget();
});

describe("surface puppet WebGL context budget", () => {
    it("stays under the ceiling this Electron build actually has", () => {
        // The probe that produced 16 is documented in the module header. The budget is deliberately
        // under it, leaving room for the description probe, the character-editor preview, Dev Mode
        // stage puppets, and a backend that keeps more than one context per model.
        expect(SURFACE_PUPPET_CONTEXT_BUDGET).toBeLessThan(16);
        expect(SURFACE_PUPPET_CONTEXT_BUDGET).toBeGreaterThan(1);
    });

    it("grants up to the budget and denies the rest", () => {
        const keys = claimMany(SURFACE_PUPPET_CONTEXT_BUDGET + 3);

        expect(surfacePuppetContextsGranted()).toBe(SURFACE_PUPPET_CONTEXT_BUDGET);
        expect(surfacePuppetContextsDenied()).toBe(3);
        for (const [index, key] of keys.entries()) {
            expect(isSurfacePuppetContextGranted(key)).toBe(index < SURFACE_PUPPET_CONTEXT_BUDGET);
        }
    });

    it("keeps the first claimants rather than the newest", () => {
        // The opposite of what Chromium does on its own. Past the ceiling Chromium evicts the oldest
        // context, so the models an author opened first are the ones that go blank - which reads as a
        // corrupt project. First-come keeps them and refuses the newcomer instead.
        claimMany(SURFACE_PUPPET_CONTEXT_BUDGET);
        claimSurfacePuppetContext("latecomer");

        expect(isSurfacePuppetContextGranted("w0")).toBe(true);
        expect(isSurfacePuppetContextGranted("latecomer")).toBe(false);
    });

    it("promotes the earliest waiter when a lease is released", () => {
        claimMany(SURFACE_PUPPET_CONTEXT_BUDGET);
        claimSurfacePuppetContext("waiting-a");
        claimSurfacePuppetContext("waiting-b");
        expect(isSurfacePuppetContextGranted("waiting-a")).toBe(false);

        // A widget scrolled off the canvas, or emptied by the author.
        releaseSurfacePuppetContext("w2");

        expect(isSurfacePuppetContextGranted("waiting-a")).toBe(true);
        expect(isSurfacePuppetContextGranted("waiting-b")).toBe(false);
        expect(surfacePuppetContextsGranted()).toBe(SURFACE_PUPPET_CONTEXT_BUDGET);
    });

    it("ignores a repeated claim so a re-render cannot re-queue a widget", () => {
        // Were this not idempotent, every render of a denied widget would push it further back and
        // every render of a granted one would drop it to the tail - so which models draw would
        // flicker with each keystroke in the inspector.
        claimMany(SURFACE_PUPPET_CONTEXT_BUDGET);
        claimSurfacePuppetContext("w0");
        claimSurfacePuppetContext("w0");

        expect(surfacePuppetContextClaims()).toHaveLength(SURFACE_PUPPET_CONTEXT_BUDGET);
        expect(isSurfacePuppetContextGranted("w0")).toBe(true);
    });

    it("notifies subscribers when the grant set changes, and survives a throwing one", () => {
        const thrower = vi.fn(() => { throw new Error("subscriber's own problem"); });
        const listener = vi.fn();
        const unsubscribeThrower = subscribeSurfacePuppetContexts(thrower);
        const unsubscribe = subscribeSurfacePuppetContexts(listener);

        claimSurfacePuppetContext("a");
        releaseSurfacePuppetContext("a");

        expect(thrower).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribeThrower();
        unsubscribe();
        claimSurfacePuppetContext("b");
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("does nothing when releasing a key it never granted", () => {
        claimSurfacePuppetContext("a");
        releaseSurfacePuppetContext("never-claimed");
        expect(surfacePuppetContextClaims()).toEqual(["a"]);
    });
});
