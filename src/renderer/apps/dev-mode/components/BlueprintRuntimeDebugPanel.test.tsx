// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { DevModeReadOnlyContext } from "../devModeReadOnly";
import { BlueprintRuntimeDebugPanel, DEFAULT_OUTPUT_LOG_LEVELS } from "./BlueprintRuntimeDebugPanel";

afterEach(cleanup);

const snapshot = new Map();
const debug = { snapshot: () => [], subscribe: () => () => undefined } as unknown as DebugBridge;
const scopeBridge = {
    getSurfaceStore: () => ({ getSnapshot: () => snapshot, subscribe: () => () => undefined }),
    getGlobalSnapshot: () => snapshot,
    subscribeGlobals: () => () => undefined,
} as unknown as ScopeStoreBridge;
const widgetRuntimeStore = {
    getSnapshot: () => ({ hoverTargetIds: new Set(), activePointerId: null, focusedId: null, variantOverrides: new Map() }),
    subscribe: () => () => undefined,
} as unknown as WidgetRuntimeStateStore;

describe("BlueprintRuntimeDebugPanel during an agent hold", () => {
    it("closes an open safe-area menu when the session becomes read-only", () => {
        const setSafeAreaId = vi.fn();
        const panel = (readOnly: boolean) => <DevModeReadOnlyContext.Provider value={readOnly}>
            <BlueprintRuntimeDebugPanel
                debug={debug}
                blueprintDocument={{ blueprints: {} } as BlueprintDocument}
                uiDocument={{ surfaces: [], elements: {} } as unknown as UIDocument}
                activeSurfaceId="main"
                scopeBridge={scopeBridge}
                widgetRuntimeStore={widgetRuntimeStore}
                projectPath={null}
                outputLogLevels={DEFAULT_OUTPUT_LOG_LEVELS}
                setOutputLogLevels={() => undefined}
                onHighlightElement={() => undefined}
                safeAreaId={null}
                setSafeAreaId={setSafeAreaId}
            />
        </DevModeReadOnlyContext.Provider>;
        const view = render(panel(false));
        fireEvent.click(screen.getByRole("button", { name: "Safe area" }));
        expect(screen.getByRole("menu")).toBeTruthy();
        view.rerender(panel(true));
        expect(screen.queryByRole("menu")).toBeNull();
        expect(setSafeAreaId).not.toHaveBeenCalled();
    });
});
