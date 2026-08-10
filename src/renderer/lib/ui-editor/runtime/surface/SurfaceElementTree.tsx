import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import {
    type UIDocument,
    type UISurface,
    type UIElement,
    getUIComponentLink,
    isUIElementFlowLayoutChild,
    resolveUIComponentParams,
} from "@shared/types/ui-editor/document";
import { buildUIComponentInstanceKey } from "@shared/types/ui-editor/componentInstanceKey";
import { isListLikeWidgetType, type UIListItemScope } from "@shared/types/ui-editor/list";
import { UI_SWITCH_ELEMENT_TYPE } from "@shared/types/ui-editor/switch";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { mergeElementWithBlueprintBindings } from "@/lib/ui-editor/blueprint-runtime/BindingEvaluator";
import {
    BlueprintValueRuntimeStore,
    mergeElementWithBlueprintValues,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintValueRuntimeStore";
import type { BlueprintStateReader } from "@/lib/workspace/services/ui-editor/blueprint/fieldEvaluation";
import type { SurfaceStateStore } from "@/lib/ui-editor/blueprint-runtime/SurfaceStateStore";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { renderUnknownWidgetTypeContent } from "@/lib/ui-editor/runtime/unknownWidgetTypeUi";
import { BlueprintWidgetInitLifecycle } from "@/lib/ui-editor/runtime/surface/BlueprintWidgetInitLifecycle";
import {
    useWidgetRuntimeStateStore,
    WidgetRuntimeScopeProvider,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { getUIFrameWidgetProps } from "@shared/types/ui-editor/frame";
import {
    getPageAnimationDurationMs,
    resolvePageAnimationMotion,
    shouldBlockPageAnimationExit,
} from "@/lib/ui-editor/runtime/pageAnimation";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { SurfaceAnimationLayer } from "@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer";
import { SurfaceBackgroundImageLayer } from "@/lib/ui-editor/runtime/surface/SurfaceBackgroundImageLayer";
import { shouldHoldCurrentSurfaceUntilEnterComplete } from "@/lib/ui-editor/runtime/surface/surfaceTransitionPlan";

export type SurfaceBlueprintBindingContext = {
    blueprintDocument: BlueprintDocument;
    /** M-VAR: persistent variable registry table, baked into the bundle (for blueprint value graphs that read persistent vars). */
    persistentVariables: PersistentVariableRuntimeTable;
    surfaceState: SurfaceStateStore;
    debug: DebugBridge;
    coalescer: BindingDebugCoalescer;
    globalState?: BlueprintStateReader & { subscribe?: (listener: () => void) => () => void };
};

export type NestedSurfaceRuntimeInput = {
    document: UIDocument;
    parentSurface: UISurface;
    targetSurface: UISurface;
    frameElement: UIElement;
    params: Record<string, unknown>;
    instanceKey: string;
    parentHostAdapter: UIHostAdapter;
    runtimeScopeId: string;
    surfacePath: string[];
};

type VisibleNestedSurfaceRuntimeInput = NestedSurfaceRuntimeInput & {
    exitBehind?: boolean;
};

export type NestedSurfaceRuntime = {
    createRuntimeScopeId?(input: Omit<NestedSurfaceRuntimeInput, "runtimeScopeId">): string;
    createHostAdapter?(input: NestedSurfaceRuntimeInput): UIHostAdapter;
    createBindingContext?(input: NestedSurfaceRuntimeInput): SurfaceBlueprintBindingContext | null;
    mountSurface?(input: NestedSurfaceRuntimeInput & { hostAdapter: UIHostAdapter }): void | (() => void);
    getWidgetRuntimePatches?(input: NestedSurfaceRuntimeInput): Record<string, DevModeWidgetRuntimePatch> | undefined;
};

export type SurfaceLifecycleSignals = {
    beforeSurfaceExit: number;
    afterSurfaceEnter: number;
};

export type SurfaceElementTreeProps = {
    document: UIDocument;
    surface: UISurface;
    rootElement: UIElement;
    rendererRegistry: ElementRendererRegistry;
    hostAdapter: UIHostAdapter;
    /** Editor canvas: resolve appearance variant from inspector cache. */
    useAppearanceInspectorPreview?: boolean;
    blueprintBindingContext?: SurfaceBlueprintBindingContext | null;
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    surfacePath?: string[];
    editorChrome?: boolean;
    interactive?: boolean;
    keyboardInteractive?: boolean;
    surfaceLifecycleSignals?: SurfaceLifecycleSignals;
    blueprintLifecycleReady?: boolean;
    /**
     * Set by hosts whose `document` is a snapshot nothing can edit under them - the game runtime,
     * whose uidoc comes out of a compiled bundle and is replaced wholesale (a new object) when that
     * bundle is. It is what licenses {@link SurfaceElementTreeContent} to treat prop identity as the
     * whole truth and reuse the tree it built last time.
     *
     * The editor canvas must NOT set it: `UIDocumentService.mutateDocument` edits the document
     * object in place and re-emits the *same* reference, so identity there says nothing about
     * content and a memoised tree would simply stop showing edits.
     */
    staticDocument?: boolean;
    /**
     * Counter the host bumps when a store it subscribes to *on this tree's behalf* has changed -
     * `GameSurfaceRenderer` watches the surface-state store and the widget runtime patches for
     * exactly that reason. It has to be a prop because what those stores change is read during the
     * tree walk rather than passed in, so nothing else here would tell the memo they moved.
     */
    hostRenderTick?: number;
};

/**
 * Shared element-tree renderer for editor preview and Dev Mode runtime (same layout / registry semantics).
 *
 * **Not a component in practice: callers invoke it directly** (`SurfaceElementTree({...})`), and its
 * own tests read the returned tree. So it must stay hook-free - the brand palette is subscribed one
 * level down, in `EditorNodeWrapper`, which is a real component and wraps every element.
 */
export function SurfaceElementTree(props: SurfaceElementTreeProps): ReactNode {
    if (props.blueprintBindingContext) {
        return <SurfaceValueRuntimeBoundary {...props} />;
    }
    return renderSurfaceElementTreeWithValueRuntime(props, null);
}

function SurfaceValueRuntimeBoundary(props: SurfaceElementTreeProps) {
    const {
        document,
        surface,
        hostAdapter,
        blueprintBindingContext,
    } = props;
    // Kept as a value, not a write-only tick setter: it is the only thing that can tell the memo
    // below that the value runtime handed out different values for the same document.
    const [bindingTick, setBindingTick] = useState(0);
    const runtimeScopeId = hostAdapter.blueprintRuntime?.runtimeScopeId ?? null;
    /**
     * The store is built by an effect rather than by `useMemo`, because `dispose()` is terminal:
     * a disposed store answers every `sync` / `ensureElementValue` with an early return and has no
     * way back. `React.StrictMode` - on in every unpackaged build, see `renderApp.tsx` - mounts,
     * tears down, and mounts again, and that second mount re-runs the effects against the *same*
     * instance the first mount captured. A memoized store would be killed by the throwaway
     * teardown and then synced while dead, so nothing on the surface would ever resolve and
     * nothing would say so. Letting the effect own the instance means the remount gets a live one.
     */
    const [valueRuntime, setValueRuntime] = useState<BlueprintValueRuntimeStore | null>(null);

    useEffect(() => {
        const store = new BlueprintValueRuntimeStore(() => setBindingTick(tick => tick + 1));
        setValueRuntime(store);
        return () => {
            store.dispose();
            setValueRuntime(current => (current === store ? null : current));
        };
    }, [runtimeScopeId, surface.id]);

    useEffect(() => {
        if (!blueprintBindingContext || !valueRuntime) {
            return;
        }
        valueRuntime.sync({
            document,
            surface,
            blueprintDocument: blueprintBindingContext.blueprintDocument,
            persistentVariables: blueprintBindingContext.persistentVariables,
            hostAdapter,
        });
    }, [blueprintBindingContext, document, hostAdapter, surface, valueRuntime]);

    useEffect(() => {
        if (!blueprintBindingContext || !valueRuntime) {
            return undefined;
        }
        const onStateChanged = () => {
            valueRuntime.refreshAll();
            setBindingTick(tick => tick + 1);
        };
        const disposers = [
            blueprintBindingContext.surfaceState.subscribe(onStateChanged),
            blueprintBindingContext.globalState?.subscribe?.(onStateChanged),
        ].filter((dispose): dispose is () => void => Boolean(dispose));
        return () => {
            disposers.forEach(dispose => dispose());
        };
    }, [blueprintBindingContext, valueRuntime]);

    return <SurfaceElementTreeContent {...props} valueRuntime={valueRuntime} bindingTick={bindingTick} />;
}

type SurfaceElementTreeContentProps = SurfaceElementTreeProps & {
    valueRuntime: BlueprintValueRuntimeStore | null;
    /** See {@link SurfaceValueRuntimeBoundary}: the value runtime's own "I changed" counter. */
    bindingTick: number;
};

function areSurfaceElementTreeInputsEqual(
    previous: SurfaceElementTreeContentProps,
    next: SurfaceElementTreeContentProps,
): boolean {
    // Only a host that promised its document is a snapshot may be told "nothing changed" - see
    // `staticDocument`. Everyone else falls through to a plain re-render, exactly as before.
    if (next.staticDocument !== true) {
        return false;
    }
    const previousKeys = Object.keys(previous) as (keyof SurfaceElementTreeContentProps)[];
    const nextKeys = Object.keys(next) as (keyof SurfaceElementTreeContentProps)[];
    if (previousKeys.length !== nextKeys.length) {
        return false;
    }
    return nextKeys.every(key => Object.is(previous[key], next[key]));
}

/**
 * Building the element tree is the most expensive thing a surface does, and almost none of the
 * re-renders that reach it change what it produces.
 *
 * One page switch renders this ~33 times (measured in Dev Mode on a 16-element page): navigation
 * state settling, prepaint and interaction readiness, lifecycle signal bumps and each layer's own
 * transition state all land here, and every one of them used to walk every element, re-run the
 * binding merge and rebuild every `EditorNodeWrapper` - to produce a tree identical to the last one.
 *
 * The comparison is `React.memo`'s own, over *all* props rather than a hand-kept list, so a prop
 * added to {@link SurfaceElementTreeProps} later cannot quietly fall out of it. What it cannot see
 * is a store read during the walk; those have to announce themselves through `bindingTick` /
 * `hostRenderTick`.
 */
const SurfaceElementTreeContent = memo(function SurfaceElementTreeContent(
    props: SurfaceElementTreeContentProps,
): ReactNode {
    return renderSurfaceElementTreeWithValueRuntime(props, props.valueRuntime);
}, areSurfaceElementTreeInputsEqual);

function renderSurfaceElementTreeWithValueRuntime(
    props: SurfaceElementTreeProps,
    valueRuntime: BlueprintValueRuntimeStore | null,
): ReactNode {
    const {
        document,
        surface,
        rootElement,
        rendererRegistry,
        hostAdapter,
        useAppearanceInspectorPreview,
        blueprintBindingContext,
        widgetRuntimePatches,
    } = props;
    const editorChrome = props.editorChrome ?? true;
    const tree = renderElementTree(
        rootElement,
        document,
        surface,
        hostAdapter,
        rendererRegistry,
        useAppearanceInspectorPreview === true,
        blueprintBindingContext ?? null,
        widgetRuntimePatches,
        null,
        "",
        props.nestedSurfaceRuntime,
        props.surfacePath ?? [surface.id],
        editorChrome,
        props.interactive ?? true,
        props.keyboardInteractive ?? props.interactive ?? true,
        valueRuntime,
        [],
        props.surfaceLifecycleSignals,
        props.blueprintLifecycleReady ?? true,
    );

    return (
        <WidgetRuntimeScopeProvider runtimeScopeId={hostAdapter.blueprintRuntime?.runtimeScopeId ?? null}>
            {tree}
        </WidgetRuntimeScopeProvider>
    );
}

function NestedSurfacePlaceholder({ label }: { label: string }) {
    return (
        <div className="flex h-full w-full items-center justify-center bg-fill-subtle px-3 text-center text-xs text-fg-muted">
            {label}
        </div>
    );
}

function defaultFrameRuntimeScopeId(input: Omit<NestedSurfaceRuntimeInput, "runtimeScopeId">): string {
    const parentScope =
        input.parentHostAdapter.blueprintRuntime?.runtimeScopeId ??
        input.parentHostAdapter.blueprintRuntime?.surfaceId ??
        input.parentSurface.id;
    const instancePart = input.instanceKey ? `:${input.instanceKey}` : "";
    return `${parentScope}/frame:${input.frameElement.id}${instancePart}->${input.targetSurface.id}`;
}

function NestedSurfaceRenderer(props: {
    document: UIDocument;
    parentSurface: UISurface;
    targetSurfaceId: string | null;
    frameElement: UIElement;
    params: Record<string, unknown>;
    instanceKey: string;
    rendererRegistry: ElementRendererRegistry;
    parentHostAdapter: UIHostAdapter;
    useAppearanceInspectorPreview: boolean;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    surfacePath: string[];
    parentInteractive: boolean;
    parentKeyboardInteractive: boolean;
}) {
    const {
        document,
        parentSurface,
        targetSurfaceId,
        frameElement,
        params,
        instanceKey,
        rendererRegistry,
        parentHostAdapter,
        useAppearanceInspectorPreview,
        nestedSurfaceRuntime,
        surfacePath,
        parentInteractive,
        parentKeyboardInteractive,
    } = props;
    const prefersReducedMotion = useReducedMotion();
    const surfacePathKey = surfacePath.join("\0");
    const targetSurface = targetSurfaceId ? document.surfaces.find(surface => surface.id === targetSurfaceId) : undefined;
    const invalidLabel = targetSurfaceId && !targetSurface
        ? "Missing Page"
        : targetSurface && targetSurface.kind !== "appSurface"
            ? "Target is not a Page"
            : targetSurface && surfacePath.includes(targetSurface.id)
              ? "Page loop blocked"
              : null;

    const runtimeBaseInput = useMemo<Omit<NestedSurfaceRuntimeInput, "runtimeScopeId"> | null>(() => {
        if (invalidLabel || !targetSurface) {
            return null;
        }
        return {
            document,
            parentSurface,
            targetSurface,
            frameElement,
            params,
            instanceKey,
            parentHostAdapter,
            surfacePath,
        };
    }, [
        document,
        frameElement,
        instanceKey,
        invalidLabel,
        params,
        parentHostAdapter,
        parentSurface,
        surfacePathKey,
        targetSurface,
    ]);

    const runtimeScopeId = useMemo(() => {
        if (!runtimeBaseInput) {
            return "";
        }
        return nestedSurfaceRuntime?.createRuntimeScopeId?.(runtimeBaseInput) ?? defaultFrameRuntimeScopeId(runtimeBaseInput);
    }, [nestedSurfaceRuntime, runtimeBaseInput]);

    const runtimeInput = useMemo<NestedSurfaceRuntimeInput | null>(() => {
        if (!runtimeBaseInput || !runtimeScopeId) {
            return null;
        }
        return { ...runtimeBaseInput, runtimeScopeId };
    }, [runtimeBaseInput, runtimeScopeId]);

    const frameAnimation = getUIFrameWidgetProps(frameElement).animation;
    const reducedMotion = prefersReducedMotion === true || !parentHostAdapter.blueprintRuntime;
    const [visibleInputs, setVisibleInputs] = useState<VisibleNestedSurfaceRuntimeInput[]>(() =>
        runtimeInput ? [runtimeInput] : []
    );
    const [presenceMode, setPresenceMode] = useState<"sync" | "wait">("sync");
    const visibleInputsRef = useRef(visibleInputs);
    const pendingWaitInputRef = useRef<NestedSurfaceRuntimeInput | null>(null);
    const pendingUnderlayReadyKeyRef = useRef<string | null>(null);
    const pendingRemoveAfterEnterKeyRef = useRef<string | null>(null);

    useEffect(() => {
        visibleInputsRef.current = visibleInputs;
    }, [visibleInputs]);

    useEffect(() => {
        if (!runtimeInput) {
            pendingWaitInputRef.current = null;
            pendingUnderlayReadyKeyRef.current = null;
            pendingRemoveAfterEnterKeyRef.current = null;
            setPresenceMode("sync");
            setVisibleInputs([]);
            return;
        }
        const currentInput = visibleInputsRef.current[visibleInputsRef.current.length - 1] ?? null;
        if (!currentInput) {
            pendingWaitInputRef.current = null;
            pendingUnderlayReadyKeyRef.current = null;
            pendingRemoveAfterEnterKeyRef.current = null;
            setPresenceMode("sync");
            setVisibleInputs([runtimeInput]);
            return;
        }
        if (currentInput.runtimeScopeId === runtimeInput.runtimeScopeId) {
            setVisibleInputs(prev => prev.map(input =>
                input.runtimeScopeId === runtimeInput.runtimeScopeId ? runtimeInput : input
            ));
            return;
        }

        const exitSettings = frameAnimation ?? currentInput.targetSurface.settings?.pageAnimation;
        const enterSettings = frameAnimation ?? runtimeInput.targetSurface.settings?.pageAnimation;
        const waitForExit = shouldBlockPageAnimationExit(exitSettings, reducedMotion);
        const exitDurationMs = getPageAnimationDurationMs(exitSettings, "exit", reducedMotion);
        const enterDurationMs = getPageAnimationDurationMs(enterSettings, "enter", reducedMotion);
        const holdCurrentUntilEnterComplete = shouldHoldCurrentSurfaceUntilEnterComplete({
            waitForExit,
            hasCurrentSurface: true,
            exitDurationMs,
            enterDurationMs,
        });
        pendingWaitInputRef.current = waitForExit ? runtimeInput : null;
        pendingUnderlayReadyKeyRef.current =
            waitForExit || holdCurrentUntilEnterComplete ? null : runtimeInput.runtimeScopeId;
        pendingRemoveAfterEnterKeyRef.current = holdCurrentUntilEnterComplete ? runtimeInput.runtimeScopeId : null;
        setPresenceMode(waitForExit ? "wait" : "sync");
        setVisibleInputs(
            waitForExit
                ? []
                : holdCurrentUntilEnterComplete
                    ? [{ ...currentInput, exitBehind: true }, runtimeInput]
                    : [runtimeInput, currentInput],
        );
    }, [frameAnimation, reducedMotion, runtimeInput]);

    const handleLayerPrepaintReady = (runtimeScopeId: string) => {
        if (pendingUnderlayReadyKeyRef.current !== runtimeScopeId) {
            return;
        }
        pendingUnderlayReadyKeyRef.current = null;
        setVisibleInputs(prev => prev.filter(input => input.runtimeScopeId === runtimeScopeId));
    };

    const handleLayerEnterComplete = (runtimeScopeId: string) => {
        if (pendingRemoveAfterEnterKeyRef.current !== runtimeScopeId) {
            return;
        }
        pendingRemoveAfterEnterKeyRef.current = null;
        setVisibleInputs(prev => prev.filter(input => input.runtimeScopeId === runtimeScopeId));
    };

    const handleExitComplete = () => {
        const pendingInput = pendingWaitInputRef.current;
        if (!pendingInput) {
            return;
        }
        pendingWaitInputRef.current = null;
        setPresenceMode("sync");
        setVisibleInputs([pendingInput]);
    };

    if (invalidLabel) {
        return <NestedSurfacePlaceholder label={invalidLabel} />;
    }

    if (!runtimeInput && targetSurfaceId) {
        return <NestedSurfacePlaceholder label="Page preview unavailable" />;
    }

    return (
        <AnimatePresence custom="forward" initial={false} mode={presenceMode} onExitComplete={handleExitComplete}>
            {visibleInputs.map((visibleInput, layerIndex) => (
                <NestedSurfaceInstance
                    key={visibleInput.runtimeScopeId}
                    runtimeInput={visibleInput}
                    layerIndex={layerIndex}
                    rendererRegistry={rendererRegistry}
                    parentHostAdapter={parentHostAdapter}
                    useAppearanceInspectorPreview={useAppearanceInspectorPreview}
                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                    surfacePath={surfacePath}
                    reducedMotion={reducedMotion}
                    active={visibleInput.runtimeScopeId === runtimeInput?.runtimeScopeId}
                    parentInteractive={parentInteractive}
                    parentKeyboardInteractive={parentKeyboardInteractive}
                    onPrepaintReady={handleLayerPrepaintReady}
                    onEnterComplete={handleLayerEnterComplete}
                />
            ))}
        </AnimatePresence>
    );
}

function NestedSurfaceInstance(props: {
    runtimeInput: VisibleNestedSurfaceRuntimeInput;
    layerIndex: number;
    rendererRegistry: ElementRendererRegistry;
    parentHostAdapter: UIHostAdapter;
    useAppearanceInspectorPreview: boolean;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    surfacePath: string[];
    reducedMotion: boolean;
    active: boolean;
    parentInteractive: boolean;
    parentKeyboardInteractive: boolean;
    onPrepaintReady: (runtimeScopeId: string) => void;
    onEnterComplete: (runtimeScopeId: string) => void;
}) {
    const {
        runtimeInput,
        layerIndex,
        rendererRegistry,
        parentHostAdapter,
        useAppearanceInspectorPreview,
        nestedSurfaceRuntime,
        surfacePath,
        reducedMotion,
        active,
        parentInteractive,
        parentKeyboardInteractive,
        onPrepaintReady,
        onEnterComplete,
    } = props;
    const [, setBindingTick] = useState(0);
    const [prepaintReady, setPrepaintReady] = useState(false);
    const [surfaceInteractive, setSurfaceInteractive] = useState(false);
    const [surfaceLifecycleSignals, setSurfaceLifecycleSignals] = useState<SurfaceLifecycleSignals>({
        beforeSurfaceExit: 0,
        afterSurfaceEnter: 0,
    });
    const surfaceTransitionStateRef = useRef({ isEntering: true, isExiting: false });
    const { document, targetSurface } = runtimeInput;
    const [, setRuntimePatchRenderTick] = useState(0);
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const effectiveInteractive = parentInteractive && active && surfaceInteractive;
    const effectiveKeyboardInteractive = parentKeyboardInteractive && active && prepaintReady;
    const hostAdapter = useMemo(() => {
        const getSurfaceTransitionState = () => surfaceTransitionStateRef.current;
        const nestedHostAdapter = nestedSurfaceRuntime?.createHostAdapter?.(runtimeInput);
        if (nestedHostAdapter) {
            if (nestedHostAdapter.blueprintRuntime) {
                nestedHostAdapter.blueprintRuntime.getSurfaceTransitionState = getSurfaceTransitionState;
            }
            return nestedHostAdapter;
        }
        if (parentHostAdapter.blueprintRuntime) {
            return {
                ...parentHostAdapter,
                blueprintRuntime: {
                    ...parentHostAdapter.blueprintRuntime,
                    getSurfaceTransitionState,
                },
            };
        }
        return parentHostAdapter;
    }, [nestedSurfaceRuntime, parentHostAdapter, runtimeInput]);
    const bindingContext = useMemo(
        () => nestedSurfaceRuntime?.createBindingContext?.(runtimeInput) ?? null,
        [nestedSurfaceRuntime, runtimeInput],
    );
    const widgetRuntimePatches = nestedSurfaceRuntime?.getWidgetRuntimePatches?.(runtimeInput);
    const dispatchSurfaceTransitionEvent = (eventName: "beforeSurfaceExit" | "afterSurfaceEnter") => {
        surfaceTransitionStateRef.current =
            eventName === "beforeSurfaceExit"
                ? { isEntering: false, isExiting: true }
                : { isEntering: false, isExiting: false };
        void hostAdapter.blueprintRuntime?.dispatchSurfaceBlueprintEvent?.(eventName);
        setSurfaceLifecycleSignals(prev => ({
            ...prev,
            [eventName]: prev[eventName] + 1,
        }));
    };

    const handleBeforeExit = (runtimeScopeId: string) => {
        if (runtimeScopeId !== runtimeInput.runtimeScopeId) {
            return;
        }
        setSurfaceInteractive(false);
        widgetRuntimeStore?.clearInteractionStateForScope(runtimeInput.runtimeScopeId);
        dispatchSurfaceTransitionEvent("beforeSurfaceExit");
    };

    const handleEnterComplete = (runtimeScopeId: string) => {
        if (runtimeScopeId === runtimeInput.runtimeScopeId) {
            dispatchSurfaceTransitionEvent("afterSurfaceEnter");
            setSurfaceInteractive(active);
        }
        onEnterComplete(runtimeScopeId);
    };

    const handlePrepaintReady = (runtimeScopeId: string) => {
        if (runtimeScopeId === runtimeInput.runtimeScopeId) {
            setPrepaintReady(true);
        }
        onPrepaintReady(runtimeScopeId);
    };

    useEffect(() => {
        if (active) {
            return;
        }
        setSurfaceInteractive(false);
        widgetRuntimeStore?.clearInteractionStateForScope(runtimeInput.runtimeScopeId);
    }, [active, runtimeInput.runtimeScopeId, widgetRuntimeStore]);

    useEffect(() => {
        if (parentInteractive) {
            return;
        }
        widgetRuntimeStore?.clearInteractionStateForScope(runtimeInput.runtimeScopeId);
    }, [parentInteractive, runtimeInput.runtimeScopeId, widgetRuntimeStore]);

    useEffect(() => {
        const store = bindingContext?.surfaceState;
        if (!store) {
            return undefined;
        }
        return store.subscribe(() => {
            setBindingTick(tick => tick + 1);
        });
    }, [bindingContext?.surfaceState]);

    useLayoutEffect(() => {
        if (!widgetRuntimeStore) {
            return undefined;
        }
        return widgetRuntimeStore.subscribeRuntimePatches(() => {
            setRuntimePatchRenderTick(tick => tick + 1);
        });
    }, [widgetRuntimeStore]);

    useEffect(() => nestedSurfaceRuntime?.mountSurface?.({ ...runtimeInput, hostAdapter }), [
        hostAdapter,
        nestedSurfaceRuntime,
        runtimeInput,
    ]);

    const rootElementId = targetSurface.rootElementId;
    const rootElement = document.elements[rootElementId];
    if (!rootElement) {
        return <NestedSurfacePlaceholder label="Page root missing" />;
    }

    const frameAnimation = getUIFrameWidgetProps(runtimeInput.frameElement).animation;
    const animationSettings = frameAnimation ?? targetSurface.settings?.pageAnimation;
    const animationMotion = resolvePageAnimationMotion({
        settings: animationSettings,
        navigationDirection: "forward",
        reducedMotion,
    });
    const resolveExit = () => resolvePageAnimationMotion({
        settings: animationSettings,
        navigationDirection: "forward",
        reducedMotion,
    }).exit;
    const surfaceStyle: CSSProperties = {
        position: "relative",
        width: targetSurface.designSize.width,
        height: targetSurface.designSize.height,
        overflow: "hidden",
        backgroundColor: getSurfaceBackgroundColor(targetSurface),
    };

    return (
        <SurfaceAnimationLayer
            prepaintKey={runtimeInput.runtimeScopeId}
            direction="forward"
            pageMotion={animationMotion}
            className="ui-editor-surface"
            surfaceId={targetSurface.id}
            surfaceKind={targetSurface.kind}
            style={surfaceStyle}
            contentStyle={{ width: "100%", height: "100%" }}
            presentZIndex={10 + layerIndex}
            exitZIndex={runtimeInput.exitBehind ? 0 : 30 + layerIndex}
            interactive={effectiveInteractive}
            resolveExit={resolveExit}
            onPrepaintReady={handlePrepaintReady}
            onBeforeExit={handleBeforeExit}
            onEnterComplete={handleEnterComplete}
        >
            <SurfaceBackgroundImageLayer surface={targetSurface} />
            <SurfaceElementTree
                document={document}
                surface={targetSurface}
                rootElement={rootElement}
                rendererRegistry={rendererRegistry}
                hostAdapter={hostAdapter}
                useAppearanceInspectorPreview={useAppearanceInspectorPreview}
                blueprintBindingContext={bindingContext}
                widgetRuntimePatches={widgetRuntimePatches}
                nestedSurfaceRuntime={nestedSurfaceRuntime}
                surfacePath={[...surfacePath, targetSurface.id]}
                editorChrome={Boolean(parentHostAdapter.blueprintRuntime)}
                interactive={effectiveInteractive}
                keyboardInteractive={effectiveKeyboardInteractive}
                surfaceLifecycleSignals={surfaceLifecycleSignals}
            />
        </SurfaceAnimationLayer>
    );
}

function applyWidgetRuntimePatches(element: UIElement, patches: Record<string, DevModeWidgetRuntimePatch>): UIElement {
    const patch = patches[element.id];
    if (!patch) {
        return element;
    }
    const next: UIElement = {
        ...element,
        layout: { ...element.layout },
        props: { ...(element.props ?? {}) },
    };
    if (patch.visible !== undefined) {
        next.layout.visible = patch.visible;
    }
    if (patch.layout) {
        next.layout = {
            ...next.layout,
            ...patch.layout,
        };
    }
    if (patch.enabled !== undefined) {
        (next.props as Record<string, unknown>).interactionDisabled = !patch.enabled;
    }
    if (element.type === "nl.frame" && patch.frame) {
        const props = next.props as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(patch.frame, "targetSurfaceId")) {
            props.targetSurfaceId = patch.frame.targetSurfaceId ?? null;
        }
        if (patch.frame.params !== undefined) {
            props.params = patch.frame.params;
        }
    }
    return next;
}

function cloneElementRenderSnapshot(element: UIElement): UIElement {
    return {
        ...element,
        childrenIds: [...element.childrenIds],
        layout: { ...element.layout },
        props: element.props ? { ...element.props } : undefined,
        style: element.style ? { ...element.style } : undefined,
        behavior: element.behavior ? { ...element.behavior } : undefined,
        valueBindings: element.valueBindings ? { ...element.valueBindings } : undefined,
        extra: element.extra ? { ...element.extra } : undefined,
    };
}

function ComponentInstancePlaceholder({ message }: { message: string }) {
    return (
        <div className="flex h-full w-full items-center justify-center border border-dashed border-edge-strong bg-fill-subtle px-3 text-center text-xs text-fg-muted">
            {message}
        </div>
    );
}

function renderLinkedComponentInstanceContent(input: {
    instanceElement: UIElement;
    document: UIDocument;
    hostAdapter: UIHostAdapter;
    rendererRegistry: ElementRendererRegistry;
    useAppearanceInspectorPreview: boolean;
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    instanceKey: string;
    componentPath: string[];
    valueRuntime: BlueprintValueRuntimeStore | null;
    surfaceLifecycleSignals?: SurfaceLifecycleSignals;
    blueprintLifecycleReady?: boolean;
    interactive?: boolean;
    keyboardInteractive?: boolean;
}): ReactNode | null {
    const link = getUIComponentLink(input.instanceElement);
    if (!link) {
        return null;
    }
    const component = input.document.components?.find(item => item.id === link.componentId);
    if (!component) {
        return <ComponentInstancePlaceholder message="Missing component" />;
    }
    if (input.componentPath.includes(component.id)) {
        return <ComponentInstancePlaceholder message="Component loop blocked" />;
    }
    const root = component.elements[component.rootElementId];
    if (!root) {
        return <ComponentInstancePlaceholder message="Component root missing" />;
    }

    const rootWidth = Math.max(1, Math.abs(root.layout.width));
    const rootHeight = Math.max(1, Math.abs(root.layout.height));
    const instanceWidth = Math.max(1, Math.abs(input.instanceElement.layout.width));
    const instanceHeight = Math.max(1, Math.abs(input.instanceElement.layout.height));
    const virtualSurface: UISurface = {
        id: `component:${component.id}`,
        name: component.name,
        host: "app",
        kind: "appSurface",
        designSize: { width: rootWidth, height: rootHeight },
        rootElementId: root.id,
    };
    const rootSnapshot: UIElement = {
        ...cloneElementRenderSnapshot(root),
        parentId: null,
        layout: {
            ...root.layout,
            x: 0,
            y: 0,
        },
    };
    const virtualDocument: UIDocument = {
        ...input.document,
        surfaces: [virtualSurface],
        elements: {
            ...input.document.elements,
            ...component.elements,
            [root.id]: rootSnapshot,
        },
    };
    const componentInstanceKey = buildUIComponentInstanceKey(input.instanceKey, input.instanceElement.id);
    // The one point that holds both the instance element and the document, so the one point that can
    // answer "what does THIS placement supply". Everything below runs the shared definition and can
    // only be handed the answer. A component that declares nothing passes null rather than an empty
    // map, so the dispatch options of content without params are byte-for-byte what they were.
    const resolvedParams = resolveUIComponentParams(component, link);
    const componentParams = Object.keys(resolvedParams).length > 0 ? resolvedParams : null;
    const viewportStyle: CSSProperties = {
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
    };
    const contentStyle: CSSProperties = {
        position: "absolute",
        left: 0,
        top: 0,
        width: rootWidth,
        height: rootHeight,
        transform: `scale(${instanceWidth / rootWidth}, ${instanceHeight / rootHeight})`,
        transformOrigin: "top left",
        pointerEvents: "none",
    };
    return (
        <div style={viewportStyle}>
            <div style={contentStyle}>
                {renderElementTree(
                    rootSnapshot,
                    virtualDocument,
                    virtualSurface,
                    input.hostAdapter,
                    input.rendererRegistry,
                    input.useAppearanceInspectorPreview,
                    null,
                    input.widgetRuntimePatches,
                    null,
                    componentInstanceKey,
                    input.nestedSurfaceRuntime,
                    [virtualSurface.id],
                    false,
                    input.interactive ?? true,
                    input.keyboardInteractive ?? input.interactive ?? true,
                    input.valueRuntime,
                    [...input.componentPath, component.id],
                    input.surfaceLifecycleSignals,
                    input.blueprintLifecycleReady ?? true,
                    componentParams,
                )}
            </div>
        </div>
    );
}

function renderElementTree(
    element: UIElement,
    document: UIDocument,
    surface: UISurface,
    hostAdapter: UIHostAdapter,
    rendererRegistry: ElementRendererRegistry,
    useAppearanceInspectorPreview: boolean,
    blueprintBindingContext: SurfaceBlueprintBindingContext | null,
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>,
    listItemScope?: UIListItemScope | null,
    instanceKey = "",
    nestedSurfaceRuntime?: NestedSurfaceRuntime,
    surfacePath: string[] = [surface.id],
    editorChrome = true,
    interactive = true,
    keyboardInteractive = interactive,
    valueRuntime: BlueprintValueRuntimeStore | null = null,
    componentPath: string[] = [],
    surfaceLifecycleSignals?: SurfaceLifecycleSignals,
    blueprintLifecycleReady = true,
    /** Resolved params of the component instance this subtree belongs to; null outside one. */
    componentParams: Record<string, string> | null = null,
): ReactNode {
    const componentId = componentPath[componentPath.length - 1];
    const runtimePatch = widgetRuntimePatches?.[element.id];
    const patched = applyWidgetRuntimePatches(element, widgetRuntimePatches ?? {});
    const bound =
        blueprintBindingContext != null
            ? mergeElementWithBlueprintBindings(
                  patched,
                  surface.id,
                  blueprintBindingContext.blueprintDocument,
                  blueprintBindingContext.surfaceState,
                  e => blueprintBindingContext.debug.emit(e),
                  blueprintBindingContext.coalescer,
                  blueprintBindingContext.globalState,
                  listItemScope ?? null,
              )
            : patched;
    const resolved = cloneElementRenderSnapshot(
        mergeElementWithBlueprintValues(bound, surface.id, valueRuntime, listItemScope ?? null, instanceKey)
    );

    if (resolved.layout.visible === false) {
        return null;
    }

    const renderChildren = (options?: {
        childrenIds?: string[];
        listItemScope?: UIListItemScope | null;
        instanceKey?: string;
        elementOverrides?: Record<string, UIElement>;
    }): ReactNode[] => {
        const childIds = options?.childrenIds ?? resolved.childrenIds;
        const childScope = options?.listItemScope === undefined ? listItemScope : options.listItemScope;
        const childInstanceKey = options?.instanceKey ?? instanceKey;
        return childIds.map(childId => {
            const childElement = options?.elementOverrides?.[childId] ?? document.elements[childId];
            if (!childElement) {
                return null;
            }
            return renderElementTree(
                childElement,
                document,
                surface,
                hostAdapter,
                rendererRegistry,
                useAppearanceInspectorPreview,
                blueprintBindingContext,
                widgetRuntimePatches,
                childScope ?? null,
                childInstanceKey,
                nestedSurfaceRuntime,
                surfacePath,
                editorChrome,
                interactive,
                keyboardInteractive,
                valueRuntime,
                componentPath,
                surfaceLifecycleSignals,
                blueprintLifecycleReady,
                componentParams,
            );
        })
        .filter((node): node is ReactNode => node !== null);
    };

    // Widgets that place their own children call `renderChildren` themselves - with slot ids, an
    // instance key and (for the switch) per-part variant overrides - so the tree must not also
    // render them here, or every part would be drawn twice.
    const rendersOwnChildren =
        isListLikeWidgetType(resolved.type)
        || resolved.type === "nl.slider"
        || resolved.type === UI_SWITCH_ELEMENT_TYPE;
    const children = rendersOwnChildren ? [] : renderChildren();

    const renderer = rendererRegistry.get(resolved.type);
    const linkedComponentContent = renderLinkedComponentInstanceContent({
        instanceElement: resolved,
        document,
        hostAdapter,
        rendererRegistry,
        useAppearanceInspectorPreview,
        widgetRuntimePatches,
        nestedSurfaceRuntime,
        instanceKey,
        componentPath,
        valueRuntime,
        surfaceLifecycleSignals,
        blueprintLifecycleReady,
        interactive,
        keyboardInteractive,
    });
    const content = linkedComponentContent ?? (renderer
        ? renderer.render({
              element: resolved,
              document,
              surface,
              hostAdapter,
              children,
              renderChildren,
              renderSurface: options => (
                  <NestedSurfaceRenderer
                      document={document}
                      parentSurface={surface}
                      targetSurfaceId={options.targetSurfaceId}
                      frameElement={options.frameElement}
                      params={options.params ?? {}}
                      instanceKey={options.instanceKey ?? instanceKey}
                      rendererRegistry={rendererRegistry}
                      parentHostAdapter={hostAdapter}
                      useAppearanceInspectorPreview={useAppearanceInspectorPreview}
                      nestedSurfaceRuntime={nestedSurfaceRuntime}
                      surfacePath={surfacePath}
                      parentInteractive={interactive}
                      parentKeyboardInteractive={keyboardInteractive}
                  />
              ),
              instanceKey,
              listItemScope: listItemScope ?? null,
              runtimeData: blueprintBindingContext
                  ? {
                        surfaceState: blueprintBindingContext.surfaceState,
                        globalState: blueprintBindingContext.globalState,
                    }
                  : undefined,
              useAppearanceInspectorPreview,
          })
        : renderUnknownWidgetTypeContent(resolved, children));

    const baseStyleOverrides = extractStyleOverrides(resolved);
    const styleOverrides =
        runtimePatch?.display === false
            ? { ...baseStyleOverrides, display: "none" }
            : baseStyleOverrides;
    const layoutMode =
        resolved.parentId === null
            ? "absolute"
            : isUIElementFlowLayoutChild(document, resolved)
              ? "flow"
              : "absolute";
    return (
        <EditorNodeWrapper
            key={`${resolved.id}${instanceKey ? `:${instanceKey}` : ""}`}
            element={resolved}
            layout={resolved.layout}
            isRoot={resolved.parentId === null}
            layoutMode={layoutMode}
            styleOverrides={styleOverrides}
            hasRuntimeOpacityOverride={Boolean(
                runtimePatch?.layout && Object.prototype.hasOwnProperty.call(runtimePatch.layout, "opacity"),
            )}
            hostAdapter={hostAdapter}
            interactive={editorChrome && interactive}
            keyboardInteractive={editorChrome && keyboardInteractive}
            useAppearanceInspectorPreview={useAppearanceInspectorPreview}
            listItemScope={listItemScope ?? null}
            instanceKey={instanceKey}
            componentParams={componentParams}
        >
            {blueprintLifecycleReady && hostAdapter.blueprintRuntime ? (
                <BlueprintWidgetInitLifecycle
                    surfaceId={surface.id}
                    elementId={resolved.id}
                    elementType={resolved.type}
                    behavior={resolved.behavior}
                    initBinding={resolved.behavior?.events?.init}
                    hostAdapter={hostAdapter}
                    componentId={componentId}
                    componentParams={componentParams}
                    listItemScope={listItemScope}
                    instanceKey={instanceKey || undefined}
                    surfaceLifecycleSignals={surfaceLifecycleSignals}
                />
            ) : null}
            {content}
        </EditorNodeWrapper>
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
