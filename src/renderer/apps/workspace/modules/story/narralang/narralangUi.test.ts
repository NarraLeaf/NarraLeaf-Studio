import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AppInfo } from "@shared/types/app";
import type { ExperimentalState } from "@shared/types/experimental";

/**
 * The gate the whole NarraLang integration hangs from.
 *
 * Every surface it hides - two context menu rows, a palette command, the scene tab's script toggle -
 * asks this one function, so the two answers that matter are whether an ordinary launch gets none of
 * them and whether the documented flags get all of them. Read through the app info rather than by
 * stubbing the state, because the chain from what the main process resolved to what a window acts on
 * is the part that could go wrong quietly: a window that never received the mode answers the same as
 * one launched without it.
 */
let info: AppInfo | null = null;

vi.mock("@/lib/renderApp", () => ({
    getAppInfo: () => {
        if (!info) {
            throw new Error("App info not found");
        }
        return info;
    },
}));

const { narralangUiEnabled } = await import("./narralangUi");

const state = (partial: Partial<ExperimentalState>): ExperimentalState => ({
    enabled: false,
    conditions: [],
    unknownConditionFlags: [],
    ...partial,
});

describe("narralangUiEnabled", () => {
    beforeEach(() => {
        info = null;
    });

    it("is off for a launch that asked for nothing", () => {
        info = { version: "0.0.0", experimental: state({}) };
        expect(narralangUiEnabled()).toBe(false);
    });

    it("is on when experimental mode carries the condition", () => {
        info = { version: "0.0.0", experimental: state({ enabled: true, conditions: ["narralang"] }) };
        expect(narralangUiEnabled()).toBe(true);
    });

    it("stays off when the condition flag was given without the mode", () => {
        // Two switches on purpose; see `@shared/types/experimental`.
        info = { version: "0.0.0", experimental: state({ enabled: false, conditions: ["narralang"] }) };
        expect(narralangUiEnabled()).toBe(false);
    });

    it("stays off for another condition, and for a window with no app info at all", () => {
        info = { version: "0.0.0", experimental: state({ enabled: true, conditions: ["debuggable-build"] }) };
        expect(narralangUiEnabled()).toBe(false);

        info = null;
        expect(narralangUiEnabled()).toBe(false);
    });
});
