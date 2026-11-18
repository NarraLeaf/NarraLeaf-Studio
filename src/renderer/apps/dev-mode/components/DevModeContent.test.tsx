// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevModeBundle, DevModeEntry } from "@shared/types/devMode";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { DevModeReadOnlyContext } from "../devModeReadOnly";
import { DevModeContent } from "./DevModeContent";

const harness = vi.hoisted(() => ({ fastForward: vi.fn(async () => undefined), warmupReady: true }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        devMode: {
            onCloseRequested: () => ({ cancel: () => undefined }),
            onAgentDrive: () => ({ cancel: () => undefined }),
        },
    }),
}));
vi.mock("@/lib/ui-editor/runtime/plugins/runtimePluginHostController", () => ({
    RuntimePluginHostController: class {
        bindShellEvents() { return () => undefined; }
    },
}));
vi.mock("../hooks/useDevModeRuntimePlugins", () => {
    const result = { ready: true, excluded: [], running: [], errors: [] };
    return { useDevModeRuntimePlugins: () => result };
});
vi.mock("./useDevModeInterfaceWarmup", () => ({
    useDevModeInterfaceWarmup: () => ({ ready: harness.warmupReady, loaded: 0, total: 0 }),
}));
vi.mock("@/lib/ui-editor/runtime/game/surfacePuppetHosts", () => ({
    registerDevModePuppetHost: () => () => undefined,
}));
vi.mock("@/lib/ui-editor/runtime/app/GameApp", () => ({
    GameApp: ({ renderFrame, renderOverlays }: {
        renderFrame: (context: unknown) => React.ReactNode;
        renderOverlays: (context: unknown) => React.ReactNode;
    }) => <>{renderFrame({ activeSurface: { designSize: { width: 640, height: 480 } }, children: null })}{renderOverlays({
        core: { debugSession: null, debug: { setVerboseCaptureEnabled: () => undefined }, scopeBridge: {} },
        activeSurface: { id: "main" },
        widgetRuntimeStore: {},
        fastForwardToNextChoice: harness.fastForward,
        storyRuntime: {
            getStoryContext: () => null,
            getActionIdBindings: () => [],
            getCurrentActionId: () => null,
            subscribeCurrentAction: () => () => undefined,
        },
        saves: {},
        composite: {},
    })}</>,
}));
vi.mock("@/lib/ui-editor/runtime/app/StageViewportFrame", () => ({
    StageViewportFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./DevModeSafeAreaOverlay", () => ({
    DevModeSafeAreaOverlay: ({ safeAreaId }: { safeAreaId: string | null }) => (
        <span data-testid="safe-area">{safeAreaId ?? "off"}</span>
    ),
}));
vi.mock("./DevModeWidgetHighlight", () => ({
    DevModeWidgetHighlight: ({ elementId }: { elementId: string | null }) => (
        <span data-testid="widget-highlight">{elementId ?? "off"}</span>
    ),
}));
vi.mock("./BlueprintRuntimeDebugPanel", () => ({
    DEFAULT_OUTPUT_LOG_LEVELS: new Set(["error", "warning", "log"]),
    BlueprintRuntimeDebugPanel: ({ onHighlightElement }: { onHighlightElement: (id: string) => void }) => (
        <button type="button" onClick={() => onHighlightElement("widget")}>Highlight widget</button>
    ),
}));

const surface = {
    id: "main", name: "Main", host: "app", kind: "appSurface",
    designSize: { width: 640, height: 480 }, rootElementId: "root",
} as UISurface;
const bundle = {
    bundleId: "bundle", revision: 1,
    ui: { uidoc: { surfaces: [surface], elements: {} }, localBlueprints: { blueprints: {}, ownerRecords: {} } },
} as unknown as DevModeBundle;

function content(
    currentSurface: UISurface | null = surface,
    entry: DevModeEntry | null = null,
    currentBundle: DevModeBundle = bundle,
) {
    return <DevModeContent
        bundle={currentBundle}
        entry={entry}
        launchRequest={null}
        projectPath={null}
        surface={currentSurface}
        surfaceId="missing"
        rendererRegistry={{} as ElementRendererRegistry}
        scale={1}
        handleAspectUpdate={() => undefined}
        sessionError={null}
        onDismissSessionError={() => undefined}
    />;
}

beforeEach(() => { harness.fastForward.mockClear(); harness.warmupReady = true; });
afterEach(cleanup);

describe("DevModeContent", () => {
    it("blocks the fast-forward shortcut while an agent holds the session", () => {
        const view = render(<DevModeReadOnlyContext.Provider value>{content()}</DevModeReadOnlyContext.Provider>);
        fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
        expect(harness.fastForward).not.toHaveBeenCalled();

        view.rerender(<DevModeReadOnlyContext.Provider value={false}>{content()}</DevModeReadOnlyContext.Provider>);
        fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
        expect(harness.fastForward).toHaveBeenCalledTimes(1);
    });

    it("reports a missing entry surface once the bundle has arrived", () => {
        render(content(null));
        expect(screen.getByText("Surface not available")).toBeTruthy();
    });

    it("hides an existing safe-area overlay during a hold and restores it afterward", () => {
        const entry = { kind: "surface", surfaceId: "main", safeAreaId: "iphone-14" } as DevModeEntry;
        const view = render(<DevModeReadOnlyContext.Provider value={false}>{content(surface, entry)}</DevModeReadOnlyContext.Provider>);
        expect(screen.getByTestId("safe-area").textContent).toBe("iphone-14");
        view.rerender(<DevModeReadOnlyContext.Provider value>{content(surface, entry)}</DevModeReadOnlyContext.Provider>);
        expect(screen.getByTestId("safe-area").textContent).toBe("off");
        view.rerender(<DevModeReadOnlyContext.Provider value={false}>{content(surface, entry)}</DevModeReadOnlyContext.Provider>);
        expect(screen.getByTestId("safe-area").textContent).toBe("iphone-14");
    });

    it("hides the widget highlight while an agent holds the session", () => {
        const view = render(<DevModeReadOnlyContext.Provider value={false}>{content()}</DevModeReadOnlyContext.Provider>);
        fireEvent.click(screen.getByRole("button", { name: "Open preview debug tools menu" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Interface" }));
        fireEvent.click(screen.getByRole("button", { name: "Highlight widget" }));
        expect(screen.getByTestId("widget-highlight").textContent).toBe("widget");
        view.rerender(<DevModeReadOnlyContext.Provider value>{content()}</DevModeReadOnlyContext.Provider>);
        expect(screen.getByTestId("widget-highlight").textContent).toBe("off");
    });

    it.each([
        ["white", "white", "27, 33, 41"],
        ["khaki", "khaki", "27, 33, 41"],
        ["rebeccapurple", "rebeccapurple", "255, 255, 255"],
        ["#fff8f0", "rgb(255, 248, 240)", "27, 33, 41"],
        ["#0a090d", "rgb(10, 9, 13)", "255, 255, 255"],
    ])("draws visible loading progress on %s", (backgroundColor, paintedBackground, ink) => {
        harness.warmupReady = false;
        const entrySurface = { ...surface, settings: { backgroundColor } } as UISurface;
        render(content(entrySurface));
        const progress = screen.getByRole("progressbar");
        expect(progress.parentElement?.parentElement?.style.backgroundColor).toBe(paintedBackground);
        expect(progress.getAttribute("style")).toContain(ink);
        expect(progress.firstElementChild?.getAttribute("style")).toContain(ink);
    });

    it("resolves a named brand colour through the Dev Mode loading screen", () => {
        harness.warmupReady = false;
        const entrySurface = { ...surface, settings: { backgroundColor: "nlbrand:pageBackground" } } as UISurface;
        const branded = { ...bundle, brand: [{ id: "pageBackground", value: "whitesmoke" }] } as DevModeBundle;
        render(content(entrySurface, null, branded));
        const progress = screen.getByRole("progressbar");
        expect(progress.parentElement?.parentElement?.style.backgroundColor).toBe("whitesmoke");
        expect(progress.getAttribute("style")).toContain("27, 33, 41");
        expect(progress.firstElementChild?.getAttribute("style")).toContain("27, 33, 41");
    });
});
