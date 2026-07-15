import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT,
    blueprintKeyboardBindingMatchesEvent,
    collectBlueprintEventHeadNodeIdsForDispatch,
    collectGlobalEventHeadNodeIdsForDispatch,
    collectSurfaceEventHeadNodeIdsForDispatch,
    formatBlueprintKeyboardBinding,
    formatBlueprintKeyboardBindingFromEvent,
    parseBlueprintKeyboardBinding,
} from "./graph";

describe("blueprint keyboard bindings", () => {
    it("formats legacy key names and captured keyboard combos", () => {
        expect(formatBlueprintKeyboardBinding("escape")).toBe("Escape");
        expect(formatBlueprintKeyboardBinding("spacebar")).toBe("Space");
        expect(formatBlueprintKeyboardBinding("ctrl+shift+s")).toBe("Ctrl+Shift+S");
        expect(formatBlueprintKeyboardBindingFromEvent({ key: "s", ctrlKey: true, shiftKey: true })).toBe(
            "Ctrl+Shift+S",
        );
        expect(formatBlueprintKeyboardBindingFromEvent({ key: "Control", ctrlKey: true })).toBe("Ctrl");
    });

    it("parses modifier bindings without duplicating the modifier key", () => {
        expect(parseBlueprintKeyboardBinding("Ctrl")).toMatchObject({
            key: "control",
            ctrlKey: true,
            hasExplicitModifiers: true,
        });
        expect(formatBlueprintKeyboardBinding("Ctrl+Shift")).toBe("Ctrl+Shift");
    });

    it("matches legacy single-key bindings without requiring modifier state", () => {
        expect(blueprintKeyboardBindingMatchesEvent("escape", { key: "Escape", ctrlKey: true })).toBe(true);
        expect(blueprintKeyboardBindingMatchesEvent("escape", { key: "Enter", ctrlKey: true })).toBe(false);
    });

    it("matches explicit keyboard combos by key and modifier state", () => {
        expect(blueprintKeyboardBindingMatchesEvent("Ctrl+S", { key: "s", ctrlKey: true })).toBe(true);
        expect(blueprintKeyboardBindingMatchesEvent("Ctrl+S", { key: "s", ctrlKey: false })).toBe(false);
        expect(blueprintKeyboardBindingMatchesEvent("Ctrl+S", { key: "s", ctrlKey: true, shiftKey: true })).toBe(
            false,
        );
    });
});

describe("blueprint event head dispatch resolution", () => {
    it("matches new surface event heads", () => {
        const nodes = {
            before: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT },
            after: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER },
            right: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK },
            unmount: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT },
        };

        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "beforeSurfaceExit")).toEqual(["before"]);
        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "afterSurfaceEnter")).toEqual(["after"]);
        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "rightClick")).toEqual(["right"]);
        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "unmount")).toEqual([]);
    });

    it("matches mounted widget lifecycle event heads", () => {
        const nodes = {
            before: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT },
            after: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER },
            unmount: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT },
        };

        expect(collectBlueprintEventHeadNodeIdsForDispatch(nodes, "beforeSurfaceExit", "nl.button")).toEqual(["before"]);
        expect(collectBlueprintEventHeadNodeIdsForDispatch(nodes, "afterSurfaceEnter", "nl.button")).toEqual(["after"]);
        expect(collectBlueprintEventHeadNodeIdsForDispatch(nodes, "unmount", "nl.button")).toEqual(["unmount"]);
        expect(collectBlueprintEventHeadNodeIdsForDispatch(nodes, "unmount", "nl.root")).toEqual([]);
    });

    it("filters game preference change heads by the selected preference key", () => {
        const nodes = {
            any: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED },
            bgm: {
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
                params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY]: "bgmVolume" },
            },
            voice: {
                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
                params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY]: "voiceVolume" },
            },
            unconfigured: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED },
        };

        // Global and surface owners both host the shared gamePreferenceChanged event.
        expect(collectGlobalEventHeadNodeIdsForDispatch(nodes, "gamePreferenceChanged", { key: "bgmVolume" })).toEqual([
            "any",
            "bgm",
        ]);
        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "gamePreferenceChanged", { key: "voiceVolume" })).toEqual(
            ["any", "voice"],
        );
        // A preference key with no matching specific head still fires the wildcard head.
        expect(collectGlobalEventHeadNodeIdsForDispatch(nodes, "gamePreferenceChanged", { key: "skip" })).toEqual([
            "any",
        ]);
    });

    it("dispatches the fullscreen change head to both global and surface owners", () => {
        const nodes = {
            fs: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED },
            boot: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT },
        };

        expect(collectGlobalEventHeadNodeIdsForDispatch(nodes, "windowFullscreenChanged", { isFullscreen: true }))
            .toEqual(["fs"]);
        expect(collectSurfaceEventHeadNodeIdsForDispatch(nodes, "windowFullscreenChanged", { isFullscreen: false }))
            .toEqual(["fs"]);
        // The head carries no inspector filter, so it fires regardless of payload.
        expect(collectGlobalEventHeadNodeIdsForDispatch(nodes, "windowFullscreenChanged")).toEqual(["fs"]);
    });
});
