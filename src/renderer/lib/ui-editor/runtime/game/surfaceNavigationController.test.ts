import { describe, expect, it } from "vitest";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    createSurfaceNavigationCloseUpdate,
    createSurfaceNavigationOpenUpdate,
    type SurfaceNavigationEntry,
} from "./surfaceNavigationController";

type TestEntry = SurfaceNavigationEntry & {
    runtimeScopeId: string;
};

function surface(
    id: string,
    pageAnimation?: Partial<typeof DEFAULT_UI_PAGE_ANIMATION_SETTINGS>,
): UISurface {
    return {
        id,
        name: id,
        host: "app",
        designSize: { width: 1280, height: 720 },
        settings: {
            pageAnimation: pageAnimation
                ? { ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS, ...pageAnimation }
                : DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
        },
    } as UISurface;
}

function entry(key: string, surfaceId = key): TestEntry {
    return {
        key,
        runtimeScopeId: key,
        surfaceId,
        direction: "forward",
        waitForExit: false,
        props: {},
        presentation: "appPage",
    };
}

describe("surface navigation controller", () => {
    it("opens a non-blocking surface with the incoming page above the current visual", () => {
        const current = entry("a:1", "a");
        const next = entry("b:2", "b");
        const update = createSurfaceNavigationOpenUpdate({
            navStack: [current],
            visibleEntries: [current],
            activeEntry: current,
            fromSurface: surface("a"),
            targetSurface: surface("b"),
            currentHiddenForGame: false,
            createNextEntry: waitForExit => ({ ...next, waitForExit }),
        });

        expect(update.navStack.map(item => item.key)).toEqual(["a:1", "b:2"]);
        expect(update.visibleEntries.map(item => item.key)).toEqual(["b:2", "a:1"]);
        expect(update.surfacePresenceMode).toBe("sync");
        expect(update.pendingWaitEntry).toBeNull();
        expect(update.pendingUnderlayReadyKey).toBe("b:2");
        expect(update.transitionWaitOptions).toEqual({ waitForEnter: true, waitForExit: true });
    });

    it("waits for exit before showing the next surface when the current surface blocks exit", () => {
        const current = entry("a:1", "a");
        const next = entry("b:2", "b");
        const update = createSurfaceNavigationOpenUpdate({
            navStack: [current],
            visibleEntries: [current],
            activeEntry: current,
            fromSurface: surface("a", {
                exit: "fade",
                exitDurationSeconds: 0.25,
                exitBlocking: true,
            }),
            targetSurface: surface("b", {
                enter: "fade",
                enterDurationSeconds: 0.1,
            }),
            currentHiddenForGame: false,
            createNextEntry: waitForExit => ({ ...next, waitForExit }),
        });

        expect(update.visibleEntries).toEqual([]);
        expect(update.surfacePresenceMode).toBe("wait");
        expect(update.pendingWaitEntry?.key).toBe("b:2");
        expect(update.pendingUnderlayReadyKey).toBeNull();
        expect(update.transitionDurationMs).toBe(350);
    });

    it("holds the current surface behind the incoming one until enter completes", () => {
        const current = entry("a:1", "a");
        const next = entry("b:2", "b");
        const update = createSurfaceNavigationOpenUpdate({
            navStack: [current],
            visibleEntries: [current],
            activeEntry: current,
            fromSurface: surface("a"),
            targetSurface: surface("b", {
                enter: "fade",
                enterDurationSeconds: 0.2,
            }),
            currentHiddenForGame: false,
            createNextEntry: waitForExit => ({ ...next, waitForExit }),
        });

        expect(update.visibleEntries.map(item => item.key)).toEqual(["a:1", "b:2"]);
        expect(update.visibleEntries[0]?.exitBehind).toBe(true);
        expect(update.pendingUnderlayReadyKey).toBeNull();
        expect(update.pendingRemoveAfterEnterKey).toBe("b:2");
    });

    it("closes to a game-hidden page without remounting it in the visible stack", () => {
        const first = entry("a:1", "a");
        const top = entry("b:2", "b");
        const update = createSurfaceNavigationCloseUpdate({
            navStack: [first, top],
            fromSurface: surface("b", {
                exit: "fade",
                exitDurationSeconds: 0.2,
            }),
            targetSurface: surface("a"),
            targetHiddenForGame: true,
        });

        expect(update?.navStack.map(item => item.key)).toEqual(["a:1"]);
        expect(update?.navStack[0]?.direction).toBe("back");
        expect(update?.visibleEntries).toEqual([]);
        expect(update?.surfacePresenceMode).toBe("sync");
        expect(update?.transitionWaitOptions).toEqual({ waitForEnter: false, waitForExit: true });
    });
});
