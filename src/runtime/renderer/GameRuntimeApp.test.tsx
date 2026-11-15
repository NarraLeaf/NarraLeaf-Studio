// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import type { GameAppFrameContext, GameAppHost } from "@/lib/ui-editor/runtime/app/GameAppHost";
import type { GameCrashReportRequest, GameRuntimePackV1, GameRuntimePreloadBridge } from "@shared/types/gameRuntime";

const runtime = vi.hoisted(() => ({
    bridge: null as GameRuntimePreloadBridge | null,
    host: null as GameAppHost | null,
    renderFrame: null as ((context: GameAppFrameContext) => ReactElement) | null,
    bootColors: null as { background: string; accent: string } | null,
}));

vi.mock("@/lib/i18n", () => ({
    translate: (key: string) => key,
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/ui-editor/runtime/gameRuntimeBridge", () => ({
    getGameRuntimeBridge: () => runtime.bridge,
}));
vi.mock("@/lib/ui-editor/runtime/app/GameApp", () => ({
    GameApp: ({ host, renderFrame }: {
        host: GameAppHost;
        renderFrame: (context: GameAppFrameContext) => ReactElement;
    }) => {
        runtime.host = host;
        runtime.renderFrame = renderFrame;
        return null;
    },
}));
vi.mock("@/lib/ui-editor/runtime/ElementRendererRegistry", () => ({
    ElementRendererRegistry: class {},
}));
vi.mock("@/lib/ui-editor/runtime/builtin", () => ({ BuiltinElementRenderers: [] }));
vi.mock("@/lib/ui-editor/runtime/plugins/runtimePluginHostController", () => ({
    RuntimePluginHostController: class {
        host = {};
        bindShellEvents() { return () => undefined; }
    },
}));
vi.mock("./surfaceResourcePreload", () => ({
    preloadRuntimePackAssets: async ({ onFirstSurfaceSettled }: { onFirstSurfaceSettled: () => void }) => {
        onFirstSurfaceSettled();
        return {
            assetIds: [], firstSurfaceAssetIds: [], loaded: 0, firstSurfaceLoaded: 0,
            failed: [], firstSurfaceFailed: [], firstSurfaceComplete: true, timedOut: false,
        };
    },
}));
vi.mock("./RuntimeBootScreen", () => ({
    RuntimeBootBackdrop: () => null,
    RuntimeBootScreen: (props: { background: string; accent: string }) => {
        runtime.bootColors = props;
        return null;
    },
}));

import { GameRuntimeApp } from "./GameRuntimeApp";
import { RuntimeCrashBoundary } from "./RuntimeCrashBoundary";
import { claimAutomaticRestart, clearAutomaticRestarts, setRuntimeCrashPolicy } from "./crashPolicy";
import { resetRuntimeBootProgress } from "./bootProgress";
import { clearStoryPosition, recordStoryRow, recordStoryScene } from "@/lib/ui-editor/runtime/app/lastStoryPosition";

function pack(): GameRuntimePackV1 {
    return {
        entry: { kind: "surface", surfaceId: "title" },
        assets: { items: {} },
        bundle: {
            bundleId: "game", revision: 1,
            ui: {
                uidoc: {
                    surfaces: [{ id: "title", name: "Title", host: "app", kind: "appSurface" }],
                    elements: {},
                },
            },
        },
    } as unknown as GameRuntimePackV1;
}

function bridge(readPack: () => Promise<GameRuntimePackV1>) {
    return { readPack, log: vi.fn(), assetUrl: (id: string) => id } as unknown as GameRuntimePreloadBridge;
}

describe("packaged game startup failures", () => {
    const location = Object.getOwnPropertyDescriptor(window, "location")!;

    beforeEach(() => {
        runtime.bridge = null;
        runtime.host = null;
        runtime.renderFrame = null;
        runtime.bootColors = null;
        clearStoryPosition();
        window.sessionStorage.clear();
        clearAutomaticRestarts();
        resetRuntimeBootProgress();
        setRuntimeCrashPolicy("details");
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        cleanup();
        resetRuntimeBootProgress();
        clearAutomaticRestarts();
        clearStoryPosition();
        Object.defineProperty(window, "location", location);
        vi.restoreAllMocks();
    });

    it("retains the restart count until the game reports its first frame", async () => {
        claimAutomaticRestart(3);
        claimAutomaticRestart(3);
        runtime.bridge = bridge(async () => pack());
        render(<GameRuntimeApp />);

        await waitFor(() => expect(runtime.host?.ready).toBe(true));
        expect(window.sessionStorage.getItem("nl.crash.autoRestarts")).toBe("2");

        act(() => runtime.host?.onBootProgress?.({ phase: "firstFrame", at: 1 }));
        expect(window.sessionStorage.getItem("nl.crash.autoRestarts")).toBeNull();
        expect(claimAutomaticRestart(3)).toBe(true);
    });

    it("draws a visible loading indicator over the entry surface's named colour", async () => {
        const gamePack = pack();
        gamePack.bundle.ui.uidoc.surfaces[0]!.settings = { backgroundColor: "white" };
        runtime.bridge = bridge(async () => gamePack);
        render(<GameRuntimeApp />);

        await waitFor(() => expect(runtime.bootColors).toEqual({ background: "white", accent: "rgb(27 33 41)" }));
    });

    it("waits for the session claim before opening the pack and offers a reload when taken", async () => {
        const readPack = vi.fn(async () => pack());
        let resolveClaim!: (result: "taken") => void;
        const claimSession = () => new Promise<"taken">(resolve => { resolveClaim = resolve; });
        const reload = vi.fn();
        Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
        runtime.bridge = { ...bridge(readPack), claimSession };
        render(<GameRuntimeApp />);

        expect(readPack).not.toHaveBeenCalled();
        await act(async () => { resolveClaim("taken"); });
        expect(screen.getByText("game.session.title")).toBeTruthy();
        expect(readPack).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("game.session.reload"));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("opens the game when the session claim rejects", async () => {
        const readPack = vi.fn(async () => pack());
        runtime.bridge = { ...bridge(readPack), claimSession: async () => { throw new Error("unavailable"); } };
        render(<GameRuntimeApp />);

        await waitFor(() => expect(readPack).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(runtime.host?.ready).toBe(true));
    });

    it("logs a pack read failure through the crash boundary", async () => {
        runtime.bridge = bridge(async () => { throw new Error("pack unavailable"); });
        render(<RuntimeCrashBoundary><GameRuntimeApp /></RuntimeCrashBoundary>);

        await screen.findByText("game.crash.title");
        expect(runtime.bridge.log).toHaveBeenCalledWith("error", expect.stringContaining("pack unavailable"));
    });

    it("shows the localized failure when the preload bridge is absent", async () => {
        render(<RuntimeCrashBoundary><GameRuntimeApp /></RuntimeCrashBoundary>);

        await screen.findByText("game.crash.title");
        expect(screen.getByText(/game.crash.bridgeUnavailable/)).toBeTruthy();
    });

    it("applies the automatic restart policy to a pack read failure", async () => {
        const reload = vi.fn();
        Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
        setRuntimeCrashPolicy("restart");
        runtime.bridge = bridge(async () => { throw new Error("pack unavailable"); });
        render(<RuntimeCrashBoundary><GameRuntimeApp /></RuntimeCrashBoundary>);

        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(window.sessionStorage.getItem("nl.crash.autoRestarts")).toBe("1");
    });

    it("stops restarting when the stage repeatedly fails before its first frame", async () => {
        const reload = vi.fn();
        Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
        setRuntimeCrashPolicy("restart");
        const gamePack = pack();
        gamePack.crash = { policy: "restart" };
        runtime.bridge = bridge(async () => gamePack);

        for (let attempt = 0; attempt < 4; attempt++) {
            runtime.host = null;
            render(<RuntimeCrashBoundary><GameRuntimeApp /></RuntimeCrashBoundary>);
            await waitFor(() => expect(runtime.host?.ready).toBe(true));
            act(() => runtime.host?.stageCrashed?.(new Error("stage failed during boot"), null));
            if (attempt < 3) {
                expect(reload).toHaveBeenCalledTimes(attempt + 1);
                cleanup();
            }
        }

        expect(reload).toHaveBeenCalledTimes(3);
        expect(screen.getByText("game.crash.title")).toBeTruthy();
    });

    it("captures the story position when the stage failure is reported", async () => {
        const saveCrashReport = vi.fn(async (_request: GameCrashReportRequest) => ({ outcome: "written" as const, path: "report.txt" }));
        runtime.bridge = { ...bridge(async () => pack()), saveCrashReport };
        render(<RuntimeCrashBoundary><GameRuntimeApp /></RuntimeCrashBoundary>);
        await waitFor(() => expect(runtime.host?.ready).toBe(true));

        recordStoryScene("Chapter One", "The corridor");
        recordStoryRow("block-7");
        const frame = runtime.renderFrame!({
            activeSurface: { designSize: { width: 1280, height: 720 } },
            children: null,
        } as GameAppFrameContext) as ReactElement<{ onRenderScaleChange: (scale: number) => void }>;

        act(() => {
            frame.props.onRenderScaleChange(2);
            runtime.host?.stageCrashed?.(new Error("stage failed"), "stage stack");
            clearStoryPosition();
        });

        fireEvent.click(screen.getByText("game.crash.saveReport"));
        await waitFor(() => expect(saveCrashReport).toHaveBeenCalledTimes(1));
        expect(saveCrashReport.mock.calls[0][0]).toEqual(expect.objectContaining({
            story: { storyName: "Chapter One", sceneName: "The corridor", rowId: "block-7" },
        }));
    });
});
