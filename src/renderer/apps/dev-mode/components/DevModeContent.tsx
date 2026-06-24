import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { FixedAspectRatioContainer } from "narraleaf-react";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UISurface, UIDocument } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { NestedSurfaceRuntime } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { DevModeSurfaceRenderer } from "./DevModeSurfaceRenderer";
import { BlueprintRuntimeDebugPanel } from "./BlueprintRuntimeDebugPanel";
import { useDevModeBlueprintRuntime } from "../hooks/useDevModeBlueprintRuntime";
import { createDevModeBlueprintHostApi, type DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { createDevModeBlueprintHostAdapter } from "@/lib/ui-editor/runtime/hostAdapters/devModeBlueprintHostAdapter";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { dispatchSurfaceBlueprintEvent, dispatchGlobalBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";
import { getInterface } from "@/lib/app/bridge";
import {
    getPageAnimationDurationMs,
    resolvePageAnimationMotion,
    type PageAnimationNavigationDirection,
} from "@/lib/ui-editor/runtime/pageAnimation";

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

type DevModeNavEntry = {
    key: string;
    surfaceId: string;
    direction: PageAnimationNavigationDirection;
};

type DevModeBlueprintRuntimeCore = NonNullable<ReturnType<typeof useDevModeBlueprintRuntime>>;

type SurfaceStateAccessors = {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
};

function keyboardBlueprintPayload(event: KeyboardEvent): Record<string, unknown> {
    return {
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
    };
}

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

function DevModeSurfaceLifecycleLayer(props: {
    bpCore: DevModeBlueprintRuntimeCore | null;
    bundle: DevModeBundle;
    surface: UISurface;
    hostAdapter: UIHostAdapter;
    lifecycleRef: MutableRefObject<SurfaceLifecycleManager>;
    makeStateAccessors: (surfaceId: string) => SurfaceStateAccessors | null;
    children: ReactNode;
}) {
    const { bpCore, bundle, surface, hostAdapter, lifecycleRef, makeStateAccessors, children } = props;

    useEffect(() => {
        if (!bpCore || !hostAdapter.blueprintRuntime) {
            return;
        }
        const shouldInit = lifecycleRef.current.onSurfaceEnter(surface.id);
        if (!shouldInit) {
            return;
        }
        const acc = makeStateAccessors(surface.id);
        if (!acc) {
            return;
        }
        void dispatchSurfaceBlueprintEvent({
            blueprintDocument: bundle.ui.localBlueprints,
            surfaceId: surface.id,
            runtimeScopeId: surface.id,
            eventName: "surfaceInit",
            hostAdapter,
            debug: bpCore.debug,
            getSurfaceState: acc.get,
            setSurfaceState: acc.set,
        });
    }, [bpCore, bundle, hostAdapter, lifecycleRef, makeStateAccessors, surface.id]);

    useEffect(() => {
        if (!bpCore || !hostAdapter.blueprintRuntime) {
            return undefined;
        }
        const surfaceToUnmount = surface.id;
        return () => {
            const acc = makeStateAccessors(surfaceToUnmount);
            if (!acc) {
                return;
            }
            void dispatchSurfaceBlueprintEvent({
                blueprintDocument: bundle.ui.localBlueprints,
                surfaceId: surfaceToUnmount,
                runtimeScopeId: surfaceToUnmount,
                eventName: "surfaceUnmount",
                hostAdapter,
                debug: bpCore.debug,
                getSurfaceState: acc.get,
                setSurfaceState: acc.set,
            });
        };
    }, [bpCore, bundle, hostAdapter, makeStateAccessors, surface.id]);

    return <>{children}</>;
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
    const prefersReducedMotion = useReducedMotion();
    const [navStack, setNavStack] = useState<DevModeNavEntry[]>([]);
    const navEntrySeqRef = useRef(0);
    const activeNavKeyRef = useRef<string | null>(null);
    const activeSurfaceRef = useRef<UISurface | null>(null);
    const transitionWaitRef = useRef<{
        resolve: (() => void) | null;
        timeoutId: ReturnType<typeof setTimeout> | null;
        enterDone: boolean;
        exitDone: boolean;
    }>({ resolve: null, timeoutId: null, enterDone: true, exitDone: true });
    const [widgetPatchesByScope, setWidgetPatchesByScope] = useState<Record<string, Record<string, DevModeWidgetRuntimePatch>>>({});
    const widgetPatchesByScopeRef = useRef(widgetPatchesByScope);
    const hostAdapterRef = useRef<UIHostAdapter | null>(null);
    const [devtoolsMenuOpen, setDevtoolsMenuOpen] = useState(false);
    const [blueprintPanelOpen, setBlueprintPanelOpen] = useState(false);
    const devtoolsFabRef = useRef<HTMLButtonElement>(null);
    const devtoolsMenuRef = useRef<HTMLDivElement>(null);
    const persistenceProjectRef = useMemo<BlueprintPersistenceProjectRef | null>(() => {
        if (!projectPath) {
            return null;
        }
        const rawIdentifier = bundle?.meta?.projectIdentifier;
        const projectIdentifier =
            typeof rawIdentifier === "string" && rawIdentifier.trim() ? rawIdentifier.trim() : undefined;
        return {
            projectIdentifier,
            projectPath,
        };
    }, [bundle?.meta?.projectIdentifier, projectPath]);

    useEffect(() => {
        if (surface?.id) {
            navEntrySeqRef.current += 1;
            setNavStack([
                {
                    key: `${surface.id}:${navEntrySeqRef.current}`,
                    surfaceId: surface.id,
                    direction: "forward",
                },
            ]);
            setWidgetPatchesByScope({});
        }
    }, [surface?.id, bundle?.revision, bundle?.bundleId]);

    useEffect(() => {
        widgetPatchesByScopeRef.current = widgetPatchesByScope;
    }, [widgetPatchesByScope]);

    useEffect(() => {
        if (!bpCore) {
            setDevtoolsMenuOpen(false);
            setBlueprintPanelOpen(false);
        }
    }, [bpCore]);

    useEffect(() => {
        if (!bpCore) {
            return undefined;
        }
        if (!persistenceProjectRef) {
            bpCore.scopeBridge.setPersistenceAdapter(null);
            return undefined;
        }
        const projectRef = persistenceProjectRef;
        bpCore.scopeBridge.setPersistenceAdapter({
            getAll: async () => {
                const result = await getInterface().blueprintPersistence.getAll(projectRef);
                if (!result.success) {
                    throw new Error(result.error ?? "Failed to read Blueprint persistent values");
                }
                return result.data.values;
            },
            getValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.getValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to read Blueprint persistent value "${key}"`);
                }
                return result.data.value;
            },
            setValue: async (key: string, value: unknown) => {
                const result = await getInterface().blueprintPersistence.setValue(projectRef, key, value);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to write Blueprint persistent value "${key}"`);
                }
            },
            removeValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.removeValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to remove Blueprint persistent value "${key}"`);
                }
            },
        });
        return () => {
            bpCore.scopeBridge.setPersistenceAdapter(null);
        };
    }, [bpCore, persistenceProjectRef]);

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

    const activeEntry = navStack.length > 0 ? navStack[navStack.length - 1]! : null;
    const activeSurface = useMemo((): UISurface | null => {
        if (!bundle || !surface || !uiDocument) {
            return null;
        }
        const activeSurfaceId = activeEntry?.surfaceId ?? surface.id;
        return uiDocument.surfaces.find(s => s.id === activeSurfaceId) ?? surface;
    }, [activeEntry?.surfaceId, bundle, surface, uiDocument]);

    useEffect(() => {
        activeNavKeyRef.current = activeEntry?.key ?? null;
        activeSurfaceRef.current = activeSurface;
    }, [activeEntry?.key, activeSurface]);

    const widgetRuntimeStore = useMemo(
        () => new WidgetRuntimeStateStore(),
        [activeSurface?.id ?? "", bundle?.revision ?? 0, bundle?.bundleId ?? ""],
    );

    const completeTransitionWait = useCallback(() => {
        const pending = transitionWaitRef.current;
        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        const resolve = pending.resolve;
        transitionWaitRef.current = { resolve: null, timeoutId: null, enterDone: true, exitDone: true };
        resolve?.();
    }, []);

    const tryCompleteTransitionWait = useCallback(() => {
        const pending = transitionWaitRef.current;
        if (pending.resolve && pending.enterDone && pending.exitDone) {
            completeTransitionWait();
        }
    }, [completeTransitionWait]);

    const beginTransitionWait = useCallback(
        (durationMs: number): Promise<void> => {
            completeTransitionWait();
            if (durationMs <= 0) {
                return Promise.resolve();
            }
            return new Promise(resolve => {
                const timeoutId = setTimeout(() => {
                    completeTransitionWait();
                }, durationMs + 120);
                transitionWaitRef.current = {
                    resolve,
                    timeoutId,
                    enterDone: false,
                    exitDone: false,
                };
            });
        },
        [completeTransitionWait],
    );

    const markActiveEnterComplete = useCallback(
        (entryKey: string) => {
            if (entryKey !== activeNavKeyRef.current) {
                return;
            }
            transitionWaitRef.current.enterDone = true;
            tryCompleteTransitionWait();
        },
        [tryCompleteTransitionWait],
    );

    const markExitComplete = useCallback(() => {
        transitionWaitRef.current.exitDone = true;
        tryCompleteTransitionWait();
    }, [tryCompleteTransitionWait]);

    const estimateTransitionDuration = useCallback(
        (from: UISurface | null, to: UISurface | null): number => {
            const reduced = prefersReducedMotion === true;
            return Math.max(
                getPageAnimationDurationMs(from?.settings?.pageAnimation, "exit", reduced),
                getPageAnimationDurationMs(to?.settings?.pageAnimation, "enter", reduced),
            );
        },
        [prefersReducedMotion],
    );

    const createNavEntry = useCallback((surfaceId: string, direction: PageAnimationNavigationDirection): DevModeNavEntry => {
        navEntrySeqRef.current += 1;
        return {
            key: `${surfaceId}:${navEntrySeqRef.current}`,
            surfaceId,
            direction,
        };
    }, []);

    const openSurfaceWithTransition = useCallback(
        (nextSurfaceId: string): Promise<void> => {
            const target = uiDocument?.surfaces.find(s => s.id === nextSurfaceId) ?? null;
            const wait = beginTransitionWait(estimateTransitionDuration(activeSurfaceRef.current, target));
            setNavStack(prev => [...prev, createNavEntry(nextSurfaceId, "forward")]);
            return wait;
        },
        [beginTransitionWait, createNavEntry, estimateTransitionDuration, uiDocument?.surfaces],
    );

    const closeLayerWithTransition = useCallback((): Promise<void> => {
        const currentStack = navStack;
        if (currentStack.length <= 1) {
            return Promise.resolve();
        }
        const nextEntry = currentStack[currentStack.length - 2]!;
        const target = uiDocument?.surfaces.find(s => s.id === nextEntry.surfaceId) ?? null;
        const wait = beginTransitionWait(estimateTransitionDuration(activeSurfaceRef.current, target));
        setNavStack(prev => {
            if (prev.length <= 1) {
                return prev;
            }
            const next = prev.slice(0, -1);
            const top = next[next.length - 1]!;
            next[next.length - 1] = { ...top, direction: "back" };
            return next;
        });
        return wait;
    }, [beginTransitionWait, estimateTransitionDuration, navStack, uiDocument?.surfaces]);

    const hostApi = useMemo(() => {
        if (!bpCore || !uiDocument || !activeSurface) {
            return null;
        }
        const runtimeScopeId = activeSurface.id;
        return createDevModeBlueprintHostApi({
            document: uiDocument,
            scope: bpCore.scopeBridge,
            activeSurfaceId: activeSurface.id,
            runtimeScopeId,
            emit: e => bpCore.debug.emit(e),
            onOpenSurface: openSurfaceWithTransition,
            onCloseLayer: closeLayerWithTransition,
            onWidgetPatch: (elementId, patch) => {
                setWidgetPatchesByScope(prev => ({
                    ...prev,
                    [runtimeScopeId]: {
                        ...(prev[runtimeScopeId] ?? {}),
                        [elementId]: {
                            ...(prev[runtimeScopeId]?.[elementId] ?? {}),
                            ...patch,
                        },
                    },
                }));
            },
            onElementFlush: (elementId, payload) => {
                void hostAdapterRef.current?.blueprintRuntime?.dispatchElementBlueprintEvent(
                    elementId,
                    "flush",
                    payload,
                );
            },
            widgetRuntimeStore,
        });
    }, [bpCore, uiDocument, activeSurface, openSurfaceWithTransition, closeLayerWithTransition, widgetRuntimeStore]);

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
            runtimeScopeId: activeSurface.id,
            scopeBridge: bpCore.scopeBridge,
            debug: bpCore.debug,
            hostApi,
        });
    }, [bundle, activeSurface, bpCore, hostApi]);

    useEffect(() => {
        hostAdapterRef.current = hostAdapter;
    }, [hostAdapter]);

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

    useEffect(() => {
        if (!bpCore || !bundle || !activeSurface || !hostAdapter.blueprintRuntime) {
            return undefined;
        }

        const dispatchKeyboardEvent = (eventName: "keyDown" | "keyUp", event: KeyboardEvent) => {
            const acc = makeStateAccessors(activeSurface.id);
            if (!acc) {
                return;
            }
            const eventPayload = keyboardBlueprintPayload(event);
            void (async () => {
                await dispatchGlobalBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    eventName,
                    eventPayload,
                    hostAdapter,
                    debug: bpCore.debug,
                    getSurfaceState: acc.get,
                    setSurfaceState: acc.set,
                });
                await dispatchSurfaceBlueprintEvent({
                    blueprintDocument: bundle.ui.localBlueprints,
                    surfaceId: activeSurface.id,
                    runtimeScopeId: activeSurface.id,
                    eventName,
                    eventPayload,
                    hostAdapter,
                    debug: bpCore.debug,
                    getSurfaceState: acc.get,
                    setSurfaceState: acc.set,
                });
            })();
        };

        const onKeyDown = (event: KeyboardEvent) => dispatchKeyboardEvent("keyDown", event);
        const onKeyUp = (event: KeyboardEvent) => dispatchKeyboardEvent("keyUp", event);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [activeSurface, bpCore, bundle, hostAdapter, makeStateAccessors]);

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

    const nestedSurfaceRuntime = useMemo<NestedSurfaceRuntime | undefined>(() => {
        if (!bpCore || !bundle || !uiDocument) {
            return undefined;
        }
        const globalReader = {
            get: (key: string) => bpCore.scopeBridge.globalGet(key),
            subscribe: (listener: () => void) => bpCore.scopeBridge.subscribeGlobals(listener),
        };
        return {
            createHostAdapter: input => {
                const runtimeScopeId = input.runtimeScopeId;
                let nestedHostAdapter: UIHostAdapter | null = null;
                const hostApi = createDevModeBlueprintHostApi({
                    document: uiDocument,
                    scope: bpCore.scopeBridge,
                    activeSurfaceId: input.targetSurface.id,
                    runtimeScopeId,
                    frameParams: input.params,
                    onFrameEmit: async (eventName, data) => {
                        await input.parentHostAdapter.blueprintRuntime?.dispatchElementBlueprintEvent(
                            input.frameElement.id,
                            "pageEvent",
                            { event: eventName, data },
                        );
                    },
                    emit: e => bpCore.debug.emit(e),
                    onOpenSurface: openSurfaceWithTransition,
                    onCloseLayer: closeLayerWithTransition,
                    onWidgetPatch: (elementId, patch) => {
                        setWidgetPatchesByScope(prev => ({
                            ...prev,
                            [runtimeScopeId]: {
                                ...(prev[runtimeScopeId] ?? {}),
                                [elementId]: {
                                    ...(prev[runtimeScopeId]?.[elementId] ?? {}),
                                    ...patch,
                                },
                            },
                        }));
                    },
                    onElementFlush: (elementId, payload) => {
                        void nestedHostAdapter?.blueprintRuntime?.dispatchElementBlueprintEvent(
                            elementId,
                            "flush",
                            payload,
                        );
                    },
                    widgetRuntimeStore,
                });
                nestedHostAdapter = createDevModeBlueprintHostAdapter({
                    bundle,
                    surface: input.targetSurface,
                    runtimeScopeId,
                    scopeBridge: bpCore.scopeBridge,
                    debug: bpCore.debug,
                    hostApi,
                });
                return nestedHostAdapter;
            },
            createBindingContext: input => ({
                blueprintDocument: bundle.ui.localBlueprints,
                surfaceState: bpCore.scopeBridge.getSurfaceStore(input.runtimeScopeId),
                debug: bpCore.debug,
                coalescer: bpCore.bindingDebugCoalescer,
                globalState: globalReader,
            }),
            mountSurface: input => {
                const acc = makeStateAccessors(input.runtimeScopeId);
                if (!acc) {
                    return undefined;
                }
                if (lifecycleRef.current.onSurfaceEnter(input.runtimeScopeId)) {
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: bundle.ui.localBlueprints,
                        surfaceId: input.targetSurface.id,
                        runtimeScopeId: input.runtimeScopeId,
                        eventName: "surfaceInit",
                        hostAdapter: input.hostAdapter,
                        debug: bpCore.debug,
                        getSurfaceState: acc.get,
                        setSurfaceState: acc.set,
                    });
                }
                return () => {
                    void dispatchSurfaceBlueprintEvent({
                        blueprintDocument: bundle.ui.localBlueprints,
                        surfaceId: input.targetSurface.id,
                        runtimeScopeId: input.runtimeScopeId,
                        eventName: "surfaceUnmount",
                        hostAdapter: input.hostAdapter,
                        debug: bpCore.debug,
                        getSurfaceState: acc.get,
                        setSurfaceState: acc.set,
                    });
                };
            },
            getWidgetRuntimePatches: input => widgetPatchesByScopeRef.current[input.runtimeScopeId] ?? {},
        };
    }, [
        bpCore,
        bundle,
        closeLayerWithTransition,
        makeStateAccessors,
        openSurfaceWithTransition,
        uiDocument,
        widgetRuntimeStore,
    ]);

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

    const globalStateReader = bpCore
        ? {
              get: (key: string) => bpCore.scopeBridge.globalGet(key),
              subscribe: (listener: () => void) => bpCore.scopeBridge.subscribeGlobals(listener),
          }
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
    const activeDirection = activeEntry?.direction ?? "forward";
    const reducedMotion = prefersReducedMotion === true;
    const activePageMotion = resolvePageAnimationMotion({
        settings: activeSurface.settings?.pageAnimation,
        navigationDirection: activeDirection,
        reducedMotion,
    });
    const pageMotionVariants = {
        initial: (direction: PageAnimationNavigationDirection) =>
            resolvePageAnimationMotion({
                settings: activeSurface.settings?.pageAnimation,
                navigationDirection: direction,
                reducedMotion,
            }).initial,
        animate: activePageMotion.animate,
        exit: (direction: PageAnimationNavigationDirection) => ({
            ...resolvePageAnimationMotion({
                settings: activeSurface.settings?.pageAnimation,
                navigationDirection: direction,
                reducedMotion,
            }).exit,
            pointerEvents: "none",
        }),
    };

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
                        <div className="relative h-full w-full overflow-hidden">
                            <AnimatePresence
                                custom={activeDirection}
                                initial={false}
                                onExitComplete={markExitComplete}
                            >
                                <motion.div
                                    key={activeEntry?.key ?? activeSurface.id}
                                    custom={activeDirection}
                                    className="absolute inset-0 flex items-center justify-center"
                                    variants={pageMotionVariants}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    transition={activePageMotion.transition}
                                    onAnimationComplete={() => markActiveEnterComplete(activeEntry?.key ?? activeSurface.id)}
                                >
                                    <DevModeSurfaceLifecycleLayer
                                        bpCore={bpCore}
                                        bundle={bundle}
                                        surface={activeSurface}
                                        hostAdapter={hostAdapter}
                                        lifecycleRef={lifecycleRef}
                                        makeStateAccessors={makeStateAccessors}
                                    >
                                        <WidgetRuntimeStateProvider externalStore={widgetRuntimeStore}>
                                            <DevModeSurfaceRenderer
                                                document={uidoc}
                                                surface={activeSurface}
                                                rendererRegistry={rendererRegistry}
                                                scale={scale}
                                                hostAdapter={hostAdapter}
                                                blueprintBindingContext={bindingContext}
                                                widgetRuntimePatches={widgetPatchesByScope[activeSurface.id] ?? {}}
                                                nestedSurfaceRuntime={nestedSurfaceRuntime}
                                            />
                                        </WidgetRuntimeStateProvider>
                                    </DevModeSurfaceLifecycleLayer>
                                </motion.div>
                            </AnimatePresence>
                        </div>
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
