import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AppLayout } from "@/lib/components/layout";
import { getInterface } from "@/lib/app/bridge";
import { WindowAppType } from "@shared/types/window";
import type { DevModeBundle, DevModeEntry } from "@shared/types/devMode";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { FixedAspectRatioContainer } from "narraleaf-react";

type DevModeState = {
    entry: DevModeEntry | null;
    bundle: DevModeBundle | null;
};

export function DevModeApp() {
    const [state, setState] = useState<DevModeState>({ entry: null, bundle: null });
    const pendingBundleRef = useRef<DevModeBundle | null>(null);
    const rendererRegistry = useMemo(() => new ElementRendererRegistry(BuiltinElementRenderers), []);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        let active = true;
        getInterface().getWindowProps<WindowAppType.DevMode>().then(result => {
            if (!active || !result.success) {
                return;
            }
            setState(prev => ({
                ...prev,
                entry: result.data.entry,
            }));
        });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const payloadToken = getInterface().devMode.onPayloadUpdate(({ bundle }) => {
            pendingBundleRef.current = bundle;
            setState(prev => (prev.bundle ? prev : { ...prev, bundle }));
        });
        const reloadToken = getInterface().devMode.onControlReload(() => {
            if (!pendingBundleRef.current) {
                return;
            }
            const nextBundle = pendingBundleRef.current;
            pendingBundleRef.current = null;
            setState(prev => ({
                ...prev,
                bundle: nextBundle,
            }));
            void tryRollbackStoryState();
        });
        return () => {
            payloadToken.cancel();
            reloadToken.cancel();
        };
    }, []);

    const surfaceId = useMemo(() => {
        if (state.entry?.kind === "surface") {
            return state.entry.surfaceId;
        }
        return MAIN_APP_SURFACE_ID;
    }, [state.entry]);

    const surface = useMemo(() => {
        if (!state.bundle) {
            return null;
        }
        return state.bundle.ui.uidoc.surfaces.find(surf => surf.id === surfaceId) ?? null;
    }, [state.bundle, surfaceId]);

    const handleAspectUpdate = useCallback((metrics: { scale: number }) => {
        setScale(prev => (prev === metrics.scale ? prev : metrics.scale));
    }, []);

    const content = useMemo(() => {
        if (!state.bundle) {
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
        const aspectRatio = surface.designSize.width / surface.designSize.height;
        const baseWidth = surface.designSize.width;
        const baseHeight = surface.designSize.height;
        return (
            <div className="h-full w-full min-h-0 overflow-hidden">
                <FixedAspectRatioContainer
                    aspectRatio={aspectRatio}
                    baseWidth={baseWidth}
                    className="overflow-hidden"
                    debounceMs={0}
                    onUpdate={handleAspectUpdate}
                >
                    <div
                        style={{
                            width: baseWidth,
                            height: baseHeight,
                            transform: `scale(${scale})`,
                            transformOrigin: "top left",
                        }}
                    >
                        {renderSurfaceFromDocument(state.bundle.ui.uidoc, surfaceId, rendererRegistry)}
                    </div>
                </FixedAspectRatioContainer>
            </div>
        );
    }, [handleAspectUpdate, rendererRegistry, scale, state.bundle, surface, surfaceId]);

    return (
        <AppLayout title="Dev Mode" iconSrc="/favicon.ico">
            <div className="h-full w-full min-h-0 bg-[#0f1115] overflow-hidden">
                {content}
            </div>
        </AppLayout>
    );
}

async function tryRollbackStoryState(): Promise<void> {
    return;
}

function renderSurfaceFromDocument(
    document: UIDocument,
    surfaceId: string,
    rendererRegistry: ElementRendererRegistry,
): ReactNode {
    const surface = document.surfaces.find(surf => surf.id === surfaceId);
    if (!surface) {
        return (
            <div className="text-sm text-gray-400">
                Surface not found: {surfaceId}
            </div>
        );
    }
    const rootElementId = resolveSurfaceRootElementId(document, surface.id);
    if (!rootElementId) {
        return null;
    }
    const rootElement = document.elements[rootElementId];
    if (!rootElement) {
        return null;
    }

    const hostAdapter: UIHostAdapter = {
        host: surface.host,
        effects: {
            runEffect: () => {},
        },
    };

    const surfaceStyle: CSSProperties = {
        position: "relative",
        width: surface.designSize.width,
        height: surface.designSize.height,
        overflow: "hidden",
        backgroundColor: surface.settings?.backgroundColor ?? "#ffffff",
    };

    return (
        <div
            className="ui-editor-surface rounded-md border border-white/10 shadow-xl"
            data-ui-surface-id={surface.id}
            data-ui-surface-kind={surface.kind}
            style={surfaceStyle}
        >
            {renderElementTree(rootElement, document, surface, hostAdapter, rendererRegistry)}
        </div>
    );
}

function renderElementTree(
    element: UIElement,
    document: UIDocument,
    surface: UISurface,
    hostAdapter: UIHostAdapter,
    rendererRegistry: ElementRendererRegistry,
): ReactNode {
    if (element.layout.visible === false) {
        return null;
    }

    const children = element.childrenIds
        .map(childId => {
            const childElement = document.elements[childId];
            if (!childElement) {
                return null;
            }
            return renderElementTree(childElement, document, surface, hostAdapter, rendererRegistry);
        })
        .filter((node): node is ReactNode => node !== null);

    const renderer = rendererRegistry.get(element.type);
    const content = renderer
        ? renderer.render({ element, document, surface, hostAdapter, children })
        : renderFallback(element, children);

    const styleOverrides = extractStyleOverrides(element);
    return (
        <EditorNodeWrapper
            key={element.id}
            element={element}
            layout={element.layout}
            isRoot={element.parentId === null}
            styleOverrides={styleOverrides}
        >
            {content}
        </EditorNodeWrapper>
    );
}

function renderFallback(element: UIElement, children: ReactNode[]): ReactNode {
    if (children.length > 0) {
        return <>{children}</>;
    }
    const label = element.name ?? element.type;
    return (
        <div className="flex items-center justify-center w-full h-full text-[11px] text-white/60 border border-dashed border-white/40">
            {label}
        </div>
    );
}

function extractStyleOverrides(element: UIElement): CSSProperties | undefined {
    const style = element.style;
    if (!style) {
        return undefined;
    }
    const overrides: CSSProperties = {};
    for (const [key, value] of Object.entries(style)) {
        if (typeof value === "number" || typeof value === "string") {
            (overrides as Record<string, string | number>)[key] = value;
        }
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export default DevModeApp;
