import { useEffect, useMemo, useState, type ReactNode } from "react";
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
    sessionError: string | null;
    onDismissSessionError: () => void;
};

const staticDevHostAdapter = (surface: UISurface): UIHostAdapter => ({
    host: surface.host,
    effects: {
        runEffect: () => {},
    },
});

const noopHostAdapter: UIHostAdapter = {
    host: "app",
    effects: { runEffect: () => {} },
};

function SessionErrorBanner(props: {
    sessionError: string | null;
    onDismissSessionError: () => void;
}): ReactNode {
    const { sessionError, onDismissSessionError } = props;
    if (!sessionError) {
        return null;
    }
    return (
        <div className="shrink-0 border-b border-red-900/60 bg-red-950/80 px-3 py-2 text-xs text-red-100">
            <div className="flex items-start justify-between gap-2">
                <pre className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug">
                    {sessionError}
                </pre>
                <button
                    type="button"
                    className="shrink-0 rounded border border-red-700/80 px-2 py-0.5 text-[11px] text-red-100 hover:bg-red-900/50"
                    onClick={onDismissSessionError}
                >
                    Dismiss
                </button>
            </div>
        </div>
    );
}

export function DevModeContent(props: DevModeContentProps) {
    const {
        bundle,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        onDismissSessionError,
    } = props;
    const bpCore = useDevModeBlueprintRuntime(bundle);
    const [navStack, setNavStack] = useState<string[]>([]);
    const [widgetPatches, setWidgetPatches] = useState<Record<string, DevModeWidgetRuntimePatch>>({});

    useEffect(() => {
        if (surface?.id) {
            setNavStack([surface.id]);
            setWidgetPatches({});
        }
    }, [surface?.id, bundle?.revision, bundle?.bundleId]);

    const document: UIDocument | null = bundle?.ui.uidoc ?? null;

    const activeSurface = useMemo((): UISurface | null => {
        if (!bundle || !surface || !document) {
            return null;
        }
        const activeSurfaceId = navStack.length > 0 ? navStack[navStack.length - 1]! : surface.id;
        return document.surfaces.find(s => s.id === activeSurfaceId) ?? surface;
    }, [bundle, surface, document, navStack]);

    const widgetRuntimeStore = useMemo(
        () => new WidgetRuntimeStateStore(),
        [activeSurface?.id ?? "", bundle?.revision ?? 0, bundle?.bundleId ?? ""],
    );

    const hostApi = useMemo(() => {
        if (!bpCore || !document || !activeSurface) {
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
    }, [bpCore, document, activeSurface, widgetRuntimeStore]);

    const hostAdapter = useMemo((): UIHostAdapter => {
        if (!activeSurface) {
            return noopHostAdapter;
        }
        if (!bpCore || !hostApi || !bundle) {
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

    if (!bundle) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Waiting for Dev Mode payload...
                </div>
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Surface not found: {surfaceId}
                </div>
            </div>
        );
    }

    if (!activeSurface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
                    Surface not available
                </div>
            </div>
        );
    }

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

    const uidoc = bundle.ui.uidoc;

    return (
        <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
            <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
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
                                document={uidoc}
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
        </div>
    );
}
