import { describe, expect, it } from "vitest";
import { createDeferredWindowShow, type DeferredWindowShowHost } from "./deferredWindowShow";

function host(overrides: Partial<DeferredWindowShowHost> = {}) {
    let shows = 0;
    let closed = false;
    const target: DeferredWindowShowHost & { shows(): number; close(): void } = {
        isClosed: () => closed,
        show: () => {
            shows += 1;
        },
        shows: () => shows,
        close: () => {
            closed = true;
        },
        ...overrides,
    };
    return target;
}

describe("createDeferredWindowShow", () => {
    it("keeps the window off screen while nobody has asked for it", () => {
        const window = host();
        const deferred = createDeferredWindowShow(window);

        deferred.markReady();

        expect(window.shows()).toBe(0);
        expect(deferred.isRevealed()).toBe(false);
    });

    it("shows when the mind is changed after the window is ready", () => {
        const window = host();
        const deferred = createDeferredWindowShow(window);

        deferred.markReady();
        deferred.reveal();

        expect(window.shows()).toBe(1);
    });

    it("shows when the window becomes ready after the mind is changed", () => {
        // The half that a plain `showWhenReady()` cannot do: `ready` is not sticky, so a
        // subscription taken out after it fired would wait for a second one that never comes.
        const window = host();
        const deferred = createDeferredWindowShow(window);

        deferred.reveal();
        expect(window.shows()).toBe(0);

        deferred.markReady();
        expect(window.shows()).toBe(1);
    });

    it("shows once however many times it is asked", () => {
        const window = host();
        const deferred = createDeferredWindowShow(window);

        deferred.markReady();
        deferred.reveal();
        deferred.reveal();
        deferred.markReady();

        expect(window.shows()).toBe(1);
    });

    it("does not show a window that has already gone", () => {
        // The ordinary end of a held-back launcher: the project it was held back for came up, and
        // the launcher was retired. A late reveal must not touch a destroyed window.
        const window = host();
        const deferred = createDeferredWindowShow(window);

        deferred.markReady();
        window.close();
        deferred.reveal();

        expect(window.shows()).toBe(0);
    });
});
