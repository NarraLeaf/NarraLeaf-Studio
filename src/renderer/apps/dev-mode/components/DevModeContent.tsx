import { useEffect, useMemo, useState } from "react";
import { FixedAspectRatioContainer } from "narraleaf-react";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UISurface, UIDocument } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { DevModeSurfaceRenderer } from "./DevModeSurfaceRenderer";
import { BlueprintRuntimeDebugPanel } from "./BlueprintRuntimeDebugPanel";
import { useDevModeBlueprintRuntime } from "../hooks/useDevModeBlueprintRuntime";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
};

const staticDevHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
    effects: {
        runEffect: () => {},
    },
});

export function DevModeContent(props: DevModeContentProps) {
    const { bundle, surface, surfaceId, rendererRegistry, scale, handleAspectUpdate } = props;
    const bpCore = useDevModeBlueprintRuntime(bundle);
    const [navStack, setNavStack] = useState<string[]>([]);
    const [widgetPatches, setWidgetPatches] = useState<Record<string, DevModeWidgetRuntimePatch>>({});

    useEffect(() => {
        if (surface?.id) {
            setNavStack([surface.id]);
            setWidgetPatches({});
        }
    }, [surface?.id, bundle?.revision, bundle?.bundleId]);

    if (!bundle) {
        return (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                Waiting for Dev Mode payload...
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                Surface not found: {surfaceId}
            </div>
        );
    }

    const document: UIDocument = bundle.ui.uidoc;
    const activeSurfaceId =
        navStack.length > 0 ? navStack[navStack.length - 1]! : surface.id;
    const activeSurface = document.surfaces.find(s => s.id === activeSurfaceId) ?? surface;

    const widgetRuntimeStore = useMemo(
        () => new WidgetRuntimeStateStore(),
        [activeSurface.id, bundle.revision, bundle.bundleId],
    );

    const hostApi = useMemo(() => {
        if (!bpCore) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document,
            scope: bpCore.scopeBridge,
            activeSurfaceId: activeSurface.id,
            emit: e => bpCore.debug.emit(e),
            onOpenSurface: id => {
                setNavStack(prev => [...prev, id]);
            },
            onCloseLayer: () => {
                setNavStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
            },
            onWidgetPatch: (elementId, patch) => {
                setWidgetPatches(prev => ({
                    ...prev,
                    [elementId]: { ...prev[elementId], ...patch },
                }));
            },
            widgetRuntimeStore,
        });
    }, [bpCore, document, activeSurface.id, widgetRuntimeStore]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!bpCore || !hostApi) {
            return staticDevHostAdapter(activeSurface);
        }
        return createDevModeBlueprintHostAdapter({
            bundle,
            surface: activeSurface,
            scopeBridge: bpCore.scopeBridge,
            debug: bpCore.debug,
            hostApi,
        });
    }, [bundle, activeSurface, bpCore, hostApi]);

    const aspectRatio = activeSurface.designSize.width / activeSurface.designSize.height;
    const baseWidth = activeSurface.designSize.width;
    const baseHeight = activeSurface.designSize.height;

    const bindingContext =
        bpCore != null
            ? {
                  blueprintDocument: bundle.ui.localBlueprints,
                  surfaceState: bpCore.scopeBridge.getSurfaceStore(activeSurface.id),
                  debug: bpCore.debug,
                  coalescer: bpCore.bindingDebugCoalescer,
              }
            : null;

    return (
        <div className="flex h-full w-full min-h-0 overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1">
                <FixedAspectRatioContainer
                    aspectRatio={aspectRatio}
                    baseWidth={baseWidth}
                    className="overflow-hidden"
                    debounceMs={0}
                    onUpdate={handleAspectUpdate}
                >
                    <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                        <DevModeSurfaceRenderer
                            document={document}
                            surface={activeSurface}
                            rendererRegistry={rendererRegistry}
                            scale={scale}
                            hostAdapter={hostAdapter}
                            blueprintBindingContext={bindingContext}
                            widgetRuntimePatches={widgetPatches}
                        />
                    </WidgetRuntimeStateProvider>
                </FixedAspectRatioContainer>
            </div>
            {bpCore ? <BlueprintRuntimeDebugPanel debug={bpCore.debug} /> : null}
        </div>
    );
}
