import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, useReducedMotion } from "motion/react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    type UIDocument,
    type UISurface,
    type UIElement,
    getUIComponentLink,
    isUIElementFlowLayoutChild,
} from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
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
import { shouldHoldCurrentSurfaceUntilEnterComplete } from "@/lib/ui-editor/runtime/surface/surfaceTransitionPlan";

export type SurfaceBlueprintBindingContext = {
    blueprintDocument: BlueprintDocument;
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
};

/**
 * Shared element-tree renderer for editor preview and Dev Mode runtime (same layout / registry semantics).
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
    const [, setBindingTick] = useState(0);
    const valueRuntime = useMemo(
        () => new BlueprintValueRuntimeStore(() => setBindingTick(tick => tick + 1)),
        [surface.id, hostAdapter.blueprintRuntime?.runtimeScopeId],
    );

    useEffect(() => () => valueRuntime.dispose(), [valueRuntime]);

    useEffect(() => {
        if (!blueprintBindingContext) {
            return;
        }
        valueRuntime.sync({
            document,
            surface,
            blueprintDocument: blueprintBindingContext.blueprintDocument,
            hostAdapter,
        });
    }, [blueprintBindingContext, document, hostAdapter, surface, valueRuntime]);

    useEffect(() => {
        if (!blueprintBindingContext) {
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

    return <>{renderSurfaceElementTreeWithValueRuntime(props, valueRuntime)}</>;
}

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
        valueRuntime,
        [],
    );

    return (
        <WidgetRuntimeScopeProvider runtimeScopeId={hostAdapter.blueprintRuntime?.runtimeScopeId ?? null}>
            {tree}
        </WidgetRuntimeScopeProvider>
    );
}

function NestedSurfacePlaceholder({ label }: { label: string }) {
    return (
        <div className="flex h-full w-full items-center justify-center bg-black/20 px-3 text-center text-xs text-gray-400">
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
        onPrepaintReady,
        onEnterComplete,
    } = props;
    const [, setBindingTick] = useState(0);
    const { document, targetSurface } = runtimeInput;
    const [, setRuntimePatchRenderTick] = useState(0);
    const widgetRuntimeStore = useWidgetRuntimeStateStore();
    const hostAdapter = useMemo(
        () => nestedSurfaceRuntime?.createHostAdapter?.(runtimeInput) ?? parentHostAdapter,
        [nestedSurfaceRuntime, parentHostAdapter, runtimeInput],
    );
    const bindingContext = useMemo(
        () => nestedSurfaceRuntime?.createBindingContext?.(runtimeInput) ?? null,
        [nestedSurfaceRuntime, runtimeInput],
    );
    const widgetRuntimePatches = nestedSurfaceRuntime?.getWidgetRuntimePatches?.(runtimeInput);

    useEffect(() => {
        const store = bindingContext?.surfaceState;
        if (!store) {
            return undefined;
        }
        return store.subscribe(() => {
            setBindingTick(tick => tick + 1);
        });
    }, [bindingContext?.surfaceState]);

    useEffect(() => {
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
            resolveExit={resolveExit}
            onPrepaintReady={onPrepaintReady}
            onEnterComplete={onEnterComplete}
        >
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

function ComponentInstancePlaceholder({ label }: { label: string }) {
    return (
        <div className="flex h-full w-full items-center justify-center border border-dashed border-white/20 bg-black/20 px-3 text-center text-xs text-gray-400">
            {label}
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
}): ReactNode | null {
    const link = getUIComponentLink(input.instanceElement);
    if (!link) {
        return null;
    }
    const component = input.document.components?.find(item => item.id === link.componentId);
    if (!component) {
        return <ComponentInstancePlaceholder label="Missing component" />;
    }
    if (input.componentPath.includes(component.id)) {
        return <ComponentInstancePlaceholder label="Component loop blocked" />;
    }
    const root = component.elements[component.rootElementId];
    if (!root) {
        return <ComponentInstancePlaceholder label="Component root missing" />;
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
    const componentInstanceKey = input.instanceKey
        ? `${input.instanceKey}\0component:${input.instanceElement.id}`
        : `component:${input.instanceElement.id}`;
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
                    input.valueRuntime,
                    [...input.componentPath, component.id],
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
    valueRuntime: BlueprintValueRuntimeStore | null = null,
    componentPath: string[] = [],
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
                valueRuntime,
                componentPath,
            );
        })
        .filter((node): node is ReactNode => node !== null);
    };

    const children = resolved.type === "nl.list" || resolved.type === "nl.slider" ? [] : renderChildren();

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
                  />
              ),
              instanceKey,
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
            interactive={editorChrome}
            useAppearanceInspectorPreview={useAppearanceInspectorPreview}
            listItemScope={listItemScope ?? null}
            instanceKey={instanceKey}
        >
            {hostAdapter.blueprintRuntime ? (
                <BlueprintWidgetInitLifecycle
                    surfaceId={surface.id}
                    elementId={resolved.id}
                    elementType={resolved.type}
                    behavior={resolved.behavior}
                    initBinding={resolved.behavior?.events?.init}
                    hostAdapter={hostAdapter}
                    componentId={componentId}
                    listItemScope={listItemScope}
                    instanceKey={instanceKey || undefined}
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
