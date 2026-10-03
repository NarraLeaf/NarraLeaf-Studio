import { describe, expect, it } from "vitest";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import type { UIDocument, UISurface } from "./document";
import {
    entrySurfacePointerMisses,
    isEntrySurface,
    resolveEntrySurfaceId,
    resolveLaunchEntrySurface,
} from "./entrySurface";

/**
 * The one rule every launcher and every label reads the entry page with. Each case is a document a
 * project can really be holding: one that never moved its entry, one that did, one whose pointer lost
 * its page in a merge, and one that lost its main page after the entry moved away from it.
 */

function page(id: string): UISurface {
    return { id, name: id, host: "app", kind: "appSurface", designSize: { width: 1, height: 1 }, rootElementId: `${id}-root` };
}

function gameUi(id: string): UISurface {
    return {
        id,
        name: id,
        host: "player",
        kind: "stageSurface",
        designSize: { width: 1, height: 1 },
        rootElementId: `${id}-root`,
        mount: { kind: "slot", slotId: "dialog" },
    };
}

function doc(surfaces: UISurface[], entrySurfaceId?: string): Pick<UIDocument, "surfaces" | "entrySurfaceId"> {
    return { surfaces, ...(entrySurfaceId === undefined ? {} : { entrySurfaceId }) };
}

describe("the entry page", () => {
    it("is the main page when the document names none, wherever that page sits in the list", () => {
        expect(resolveEntrySurfaceId(doc([gameUi("dialog"), page("settings"), page(MAIN_APP_SURFACE_ID)])))
            .toBe(MAIN_APP_SURFACE_ID);
    });

    it("is the page the document names", () => {
        const moved = doc([page(MAIN_APP_SURFACE_ID), page("splash")], "splash");
        expect(resolveEntrySurfaceId(moved)).toBe("splash");
        expect(isEntrySurface(moved, "splash")).toBe(true);
        expect(isEntrySurface(moved, MAIN_APP_SURFACE_ID)).toBe(false);
    });

    it("falls back past a pointer that names no page, and says the pointer missed", () => {
        const stale = doc([page("settings"), page(MAIN_APP_SURFACE_ID)], "deleted-in-a-merge");
        expect(resolveEntrySurfaceId(stale)).toBe(MAIN_APP_SURFACE_ID);
        expect(entrySurfacePointerMisses(stale)).toBe(true);
        expect(entrySurfacePointerMisses(doc([page(MAIN_APP_SURFACE_ID)]))).toBe(false);
    });

    it("never lands on a Game UI, even one the pointer names", () => {
        const pointedAtGameUi = doc([gameUi("dialog"), page("settings")], "dialog");
        expect(resolveEntrySurfaceId(pointedAtGameUi)).toBe("settings");
        expect(entrySurfacePointerMisses(pointedAtGameUi)).toBe(true);
        expect(resolveEntrySurfaceId(doc([gameUi("dialog")]))).toBeUndefined();
    });

    it("is the first page once the main page is gone and nothing is named", () => {
        expect(resolveEntrySurfaceId(doc([gameUi("dialog"), page("splash"), page("title")]))).toBe("splash");
    });

    it("fills a launch entry that names no page, and keeps one that does", () => {
        const moved = doc([page(MAIN_APP_SURFACE_ID), page("splash")], "splash");
        expect(resolveLaunchEntrySurface({ kind: "surface" as const }, moved)).toEqual({ kind: "surface", surfaceId: "splash" });
        expect(resolveLaunchEntrySurface({ kind: "surface" as const, surfaceId: MAIN_APP_SURFACE_ID }, moved))
            .toEqual({ kind: "surface", surfaceId: MAIN_APP_SURFACE_ID });
        expect(resolveLaunchEntrySurface({ kind: "story" as const, storyId: "s", sceneId: "c" }, moved))
            .toEqual({ kind: "story", storyId: "s", sceneId: "c", surfaceId: "splash" });
    });
});
