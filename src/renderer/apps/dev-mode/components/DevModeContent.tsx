import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
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
import { dispatchSurfaceBlueprintEvent, dispatchGlobalBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    projectPath: string | null;
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
});

const noopHostAdapter: UIHostAdapter = {
    host: "app",
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
        projectPath,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        onDismissSessionError,
    } = props;
    const uiDocument: UIDocument | null = bundle?.ui.uidoc ?? null;
    const bpCore = useDevModeBlueprintRuntime(bundle);
    const [navStack, setNavStack] = useState<string[]>([]);
    const [widgetPatches, setWidgetPatches] = useState<Record<string, DevModeWidgetRuntimePatch>>({});
    const [devtoolsMenuOpen, setDevtoolsMenuOpen] = useState(false);
    const [blueprintPanelOpen, setBlueprintPanelOpen] = useState(false);
    const devtoolsFabRef = useRef<HTMLButtonElement>(null);
    const devtoolsMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (surface?.id) {
            setNavStack([surface.id]);
            setWidgetPatches({});
        }
    }, [surface?.id, bundle?.revision, bundle?.bundleId]);

    useEffect(() => {
        if (!bpCore) {
            setDevtoolsMenuOpen(false);
            setBlueprintPanelOpen(false);
        }
    }, [bpCore]);

    useEffect(() => {
        if (!devtoolsMenuOpen) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target as Node;
            if (devtoolsFabRef.current?.contains(t)) {
                return;
            }
            if (devtoolsMenuRef.current?.contains(t)) {
                return;
            }
            setDevtoolsMenuOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [devtoolsMenuOpen]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            if (devtoolsMenuOpen) {
                setDevtoolsMenuOpen(false);
                e.preventDefault();
                return;
            }
            if (blueprintPanelOpen) {
                setBlueprintPanelOpen(false);
                e.preventDefault();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [devtoolsMenuOpen, blueprintPanelOpen]);

    const activeSurface = useMemo((): UISurface | null => {
        if (!bundle || !surface || !uiDocument) {
            return null;
        }
        const activeSurfaceId = navStack.length > 0 ? navStack[navStack.length - 1]! : surface.id;
        return uiDocument.surfaces.find(s => s.id === activeSurfaceId) ?? surface;
    }, [bundle, surface, uiDocument, navStack]);

    const widgetRuntimeStore = useMemo(
        () => new WidgetRuntimeStateStore(),
        [activeSurface?.id ?? "", bundle?.revision ?? 0, bundle?.bundleId ?? ""],
    );

    const hostApi = useMemo(() => {
        if (!bpCore || !uiDocument || !activeSurface) {
            return null;
        }
        return createDevModeBlueprintHostApi({
            document: uiDocument,
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
    }, [bpCore, uiDocument, activeSurface, widgetRuntimeStore]);

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

    const makeStateAccessors = useCallback(
        (sid: string) => {
            if (!bpCore) {
                return null;
            }
            const store = bpCore.scopeBridge.getSurfaceStore(sid);
            return {
                get: (key: string) => store.get(key),
                set: (key: string, value: unknown) => store.set(key, value),
            };
        },
        [bpCore],
    );

    const lifecycleRef = useRef<SurfaceLifecycleManager>(new SurfaceLifecycleManager());
    const appBootFiredRef = useRef<string | null>(null);

    // Reset lifecycle tracking on new session
    useEffect(() => {
        lifecycleRef.current.reset();
        appBootFiredRef.current = null;
    }, [bundle?.bundleId, bundle?.revision]);

    // Dispatch globalMain appBoot once when runtime becomes available
    useEffect(() => {
        if (!bpCore || !bundle || !hostAdapter.blueprintRuntime) {
            return;
        }
        const sig = `${bundle.bundleId}:${bundle.revision}`;
        if (appBootFiredRef.current === sig) {
            return;
        }
        appBootFiredRef.current = sig;
        const acc = makeStateAccessors(surface?.id ?? "");
        if (!acc) {
            return;
        }
        void dispatchGlobalBlueprintEvent({
            blueprintDocument: bundle.ui.localBlueprints,
            eventName: "appBoot",
            hostAdapter,
            debug: bpCore.debug,
            getSurfaceState: acc.get,
            setSurfaceState: acc.set,
        });
    }, [bpCore, bundle, hostAdapter, makeStateAccessors, surface?.id]);

    // Dispatch surfaceMain surfaceInit when the active surface changes (first visit only)
    useEffect(() => {
        if (!bpCore || !bundle || !activeSurface || !hostAdapter.blueprintRuntime) {
            return;
        }
        const shouldInit = lifecycleRef.current.onSurfaceEnter(activeSurface.id);
        if (!shouldInit) {
            return;
        }
        const acc = makeStateAccessors(activeSurface.id);
        if (!acc) {
            return;
        }
        void dispatchSurfaceBlueprintEvent({
            blueprintDocument: bundle.ui.localBlueprints,
            surfaceId: activeSurface.id,
            eventName: "surfaceInit",
            hostAdapter,
            debug: bpCore.debug,
            getSurfaceState: acc.get,
            setSurfaceState: acc.set,
        });
    }, [bpCore, bundle, activeSurface, hostAdapter, makeStateAccessors]);

    // Dispatch surfaceMain surfaceUnmount when a page leaves the active runtime.
    useEffect(() => {
        if (!bpCore || !bundle || !activeSurface || !hostAdapter.blueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = activeSurface.id;
        return () => {
            const acc = makeStateAccessors(surfaceToUnmount);
            if (!acc) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                surfaceId: surfaceToUnmount,
                eventName: "surfaceUnmount",
                hostAdapter,
                debug: bpCore.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
            });
        };
    }, [bpCore, bundle, activeSurface, hostAdapter, makeStateAccessors]);

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

    const globalStateReader = bpCore
        ? { get: (key: string) => bpCore.scopeBridge.globalGet(key) }
        : undefined;

    const bindingContext =
        bpCore != null
            ? {
                  blueprintDocument: bundle.ui.localBlueprints,
                  surfaceState: bpCore.scopeBridge.getSurfaceStore(activeSurface.id),
                  debug: bpCore.debug,
                  coalescer: bpCore.bindingDebugCoalescer,
                  globalState: globalStateReader,
              }
            : null;

    const uidoc = uiDocument!;

    return (
        <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
            <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
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

                <AnimatePresence>
                    {bpCore && blueprintPanelOpen ? (
                        <motion.div
                            key="blueprint-devtools"
                            role="complementary"
                            aria-label="Blueprint DevTools"
                            className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-[min(100%,380px)] max-w-full flex-col overflow-hidden border-l border-white/10 bg-[#0d0f11] shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                            initial={{ x: "100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "100%" }}
                            transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <BlueprintRuntimeDebugPanel
                                debug={bpCore.debug}
                                blueprintDocument={bundle.ui.localBlueprints}
                                uiDocument={uidoc}
                                activeSurfaceId={activeSurface.id}
                                scopeBridge={bpCore.scopeBridge}
                                widgetRuntimeStore={widgetRuntimeStore}
                                projectPath={projectPath}
                                className="h-full min-h-0 w-full border-l-0"
                            />
                        </motion.div>
                    ) : null}
                </AnimatePresence>

                {bpCore ? (
                    <div className="pointer-events-none absolute inset-0 z-40">
                        <div className="pointer-events-auto absolute bottom-3 left-3">
                            <div className="relative flex w-11 flex-col items-start">
                                {devtoolsMenuOpen ? (
                                    <div
                                        ref={devtoolsMenuRef}
                                        role="menu"
                                        aria-label="Preview debug tools"
                                        className="absolute bottom-full left-0 z-10 mb-2 w-[min(15rem,calc(100vw-1.5rem))] rounded-md border border-white/10 bg-[#0b0d12] py-1 shadow-lg"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            aria-pressed={blueprintPanelOpen}
                                            className={`flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                                blueprintPanelOpen
                                                    ? "bg-white/15 text-white"
                                                    : "text-gray-400 hover:bg-white/10 hover:text-white"
                                            }`}
                                            onClick={() => {
                                                setBlueprintPanelOpen(prev => !prev);
                                                setDevtoolsMenuOpen(false);
                                            }}
                                        >
                                            <span
                                                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                                aria-hidden
                                            >
                                                {blueprintPanelOpen ? (
                                                    <Check className="h-3.5 w-3.5 text-primary" />
                                                ) : null}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">Blueprint DevTools</span>
                                        </button>
                                    </div>
                                ) : null}
                                <button
                                    ref={devtoolsFabRef}
                                    type="button"
                                    className="pointer-events-auto flex h-11 w-11 shrink-0 cursor-default items-center justify-center rounded-full border border-white/15 bg-[#0b0d12] shadow-md outline-none ring-white/20 transition-colors duration-150 hover:border-white/22 hover:bg-[#151a24] hover:shadow-lg focus-visible:ring-2"
                                    aria-label={devtoolsMenuOpen ? "Close preview debug tools menu" : "Open preview debug tools menu"}
                                    aria-expanded={devtoolsMenuOpen}
                                    aria-haspopup="menu"
                                    onClick={() => setDevtoolsMenuOpen(prev => !prev)}
                                >
                                    <img src="/favicon.ico" alt="" className="h-7 w-7 rounded-full" draggable={false} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
