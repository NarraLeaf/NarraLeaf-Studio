import { describe, expect, it } from "vitest";
import {
    initialDialogState,
    requestToBuildConfiguration,
    stateFromRequest,
    stateToRequest,
    toggleFormat,
    togglePlatform,
} from "./buildDialogState";
import type { BuildConfiguration } from "@/lib/workspace/project/configuration";

describe("initialDialogState", () => {
    it("starts a never-built project on the host platform only", () => {
        const state = initialDialogState(null, "macos", "arm64");
        expect(stateToRequest(state).targets.map(t => t.platform)).toEqual(["macos"]);
    });

    it("never seeds a target the host cannot build, even if remembered", () => {
        // Project last built on macOS, reopened on a Windows host.
        const stored: BuildConfiguration = {
            platforms: ["macos", "windows"],
            formats: { macos: ["dmg"], windows: ["nsis"] },
            archs: {},
            outputDir: "",
            compression: "maximum",
            openWhenDone: true,
        };
        const targets = stateToRequest(initialDialogState(stored, "windows", "x64")).targets;
        expect(targets.some(t => t.platform === "macos")).toBe(false);
        expect(targets.some(t => t.platform === "windows")).toBe(true);
    });

    it("defaults the host platform's arch to the host arch", () => {
        const state = initialDialogState(null, "macos", "arm64");
        expect(state.archs.macos).toBe("arm64");
        // Cross builds still default to x64, the broadest player base.
        expect(state.archs.windows).toBe("x64");
    });

    it("prefers a remembered arch over the host default", () => {
        const stored: BuildConfiguration = {
            platforms: ["macos"],
            formats: { macos: ["dmg"] },
            archs: { macos: "universal" },
            outputDir: "",
            compression: "maximum",
            openWhenDone: true,
        };
        expect(initialDialogState(stored, "macos", "arm64").archs.macos).toBe("universal");
    });

    it("keeps web selectable on any host", () => {
        const stored: BuildConfiguration = {
            platforms: ["web"],
            formats: { web: ["zip"] },
            archs: {},
            outputDir: "",
            compression: "maximum",
            openWhenDone: true,
        };
        const targets = stateToRequest(initialDialogState(stored, "windows", "x64")).targets;
        expect(targets.map(t => t.platform)).toEqual(["web"]);
    });
});

describe("stateToRequest", () => {
    it("drops platforms with no formats and trims the output dir", () => {
        let state = initialDialogState(null, "macos", "arm64");
        state = { ...state, outputDir: "  " };
        const request = stateToRequest(state);
        expect(request.targets).toHaveLength(1);
        expect(request.outputDir).toBe("");
    });

    it("carries an arch for desktop targets but never for web", () => {
        let state = initialDialogState(null, "macos", "arm64");
        state = togglePlatform(state, "web", true);
        const request = stateToRequest(state);
        expect(request.targets.find(t => t.platform === "macos")?.arch).toBe("arm64");
        expect(request.targets.find(t => t.platform === "web")).not.toHaveProperty("arch");
    });
});

describe("togglePlatform / toggleFormat", () => {
    it("switching a platform on selects its default formats", () => {
        const state = togglePlatform(initialDialogState(null, "macos", "arm64"), "windows", true);
        expect([...state.formats.windows].sort()).toEqual(["nsis", "zip"]);
    });

    it("switching a platform off clears it entirely", () => {
        const state = togglePlatform(initialDialogState(null, "macos", "arm64"), "macos", false);
        expect(stateToRequest(state).targets).toEqual([]);
    });

    it("toggling a format adds and removes it", () => {
        let state = initialDialogState(null, "macos", "arm64");
        state = toggleFormat(state, "macos", "dir");
        expect(state.formats.macos.has("dir")).toBe(true);
        state = toggleFormat(state, "macos", "dir");
        expect(state.formats.macos.has("dir")).toBe(false);
    });
});

describe("draft round trip", () => {
    it("restores the exact selection a parked draft held", () => {
        let state = initialDialogState(null, "macos", "arm64");
        state = togglePlatform(state, "windows", true);
        state = { ...state, archs: { ...state.archs, windows: "arm64" }, compression: "store", openWhenDone: false };
        const restored = stateFromRequest(stateToRequest(state), "macos", "arm64");
        expect(stateToRequest(restored)).toEqual(stateToRequest(state));
    });
});

describe("requestToBuildConfiguration", () => {
    it("persists archs for desktop targets only", () => {
        let state = initialDialogState(null, "macos", "arm64");
        state = togglePlatform(state, "web", true);
        const config = requestToBuildConfiguration(stateToRequest(state));
        expect(config.archs).toEqual({ macos: "arm64" });
        expect(config.platforms).toContain("web");
    });

    it("round trips back through initialDialogState", () => {
        let state = initialDialogState(null, "macos", "arm64");
        state = { ...state, compression: "store", openWhenDone: false, outputDir: "/tmp/out" };
        const config = requestToBuildConfiguration(stateToRequest(state));
        const reopened = initialDialogState(config, "macos", "arm64");
        expect(stateToRequest(reopened)).toEqual(stateToRequest(state));
    });
});
