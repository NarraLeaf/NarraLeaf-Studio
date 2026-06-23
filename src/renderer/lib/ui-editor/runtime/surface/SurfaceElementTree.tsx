import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { type UIDocument, type UISurface, type UIElement, isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
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
import { WidgetRuntimeScopeProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";

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
    const [, setBindingTick] = useState(0);
    const surfacePathKey = surfacePath.join("\0");
    const targetSurface = document.surfaces.find(surface => surface.id === targetSurfaceId);
    const invalidLabel = !targetSurfaceId
        ? "Select a Page"
        : !targetSurface
          ? "Missing Page"
          : targetSurface.kind !== "appSurface"
            ? "Target is not a Page"
            : surfacePath.includes(targetSurface.id)
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

    const hostAdapter = useMemo(
        () => (runtimeInput ? nestedSurfaceRuntime?.createHostAdapter?.(runtimeInput) ?? parentHostAdapter : parentHostAdapter),
        [nestedSurfaceRuntime, parentHostAdapter, runtimeInput],
    );
    const bindingContext = useMemo(
        () => (runtimeInput ? nestedSurfaceRuntime?.createBindingContext?.(runtimeInput) ?? null : null),
        [nestedSurfaceRuntime, runtimeInput],
    );
    const widgetRuntimePatches = useMemo(
        () => (runtimeInput ? nestedSurfaceRuntime?.getWidgetRuntimePatches?.(runtimeInput) : undefined),
        [nestedSurfaceRuntime, runtimeInput],
    );

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
        if (!runtimeInput) {
            return undefined;
        }
        return nestedSurfaceRuntime?.mountSurface?.({ ...runtimeInput, hostAdapter });
    }, [hostAdapter, nestedSurfaceRuntime, runtimeInput]);

    if (invalidLabel) {
        return <NestedSurfacePlaceholder label={invalidLabel} />;
    }

    const rootElementId = targetSurface!.rootElementId;
    const rootElement = document.elements[rootElementId];
    if (!rootElement) {
        return <NestedSurfacePlaceholder label="Page root missing" />;
    }

    const surfaceStyle: CSSProperties = {
        position: "relative",
        width: targetSurface!.designSize.width,
        height: targetSurface!.designSize.height,
        overflow: "hidden",
        backgroundColor: targetSurface!.settings?.backgroundColor ?? "#ffffff",
    };

    return (
        <div
            className="ui-editor-surface"
            data-ui-surface-id={targetSurface!.id}
            data-ui-surface-kind={targetSurface!.kind}
            style={surfaceStyle}
        >
            <SurfaceElementTree
                document={document}
                surface={targetSurface!}
                rootElement={rootElement}
                rendererRegistry={rendererRegistry}
                hostAdapter={hostAdapter}
                useAppearanceInspectorPreview={useAppearanceInspectorPreview}
                blueprintBindingContext={bindingContext}
                widgetRuntimePatches={widgetRuntimePatches}
                nestedSurfaceRuntime={nestedSurfaceRuntime}
                surfacePath={[...surfacePath, targetSurface!.id]}
                editorChrome={Boolean(parentHostAdapter.blueprintRuntime)}
            />
        </div>
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
    if (patch.enabled !== undefined) {
        (next.props as Record<string, unknown>).interactionDisabled = !patch.enabled;
    }
    return next;
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
): ReactNode {
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
    const resolved = mergeElementWithBlueprintValues(bound, surface.id, valueRuntime, listItemScope ?? null, instanceKey);

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
            );
        })
        .filter((node): node is ReactNode => node !== null);
    };

    const children = resolved.type === "nl.list" || resolved.type === "nl.slider" ? [] : renderChildren();

    const renderer = rendererRegistry.get(resolved.type);
    const content = renderer
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
        : renderUnknownWidgetTypeContent(resolved, children);

    const styleOverrides = extractStyleOverrides(resolved);
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
            hostAdapter={hostAdapter}
            interactive={editorChrome}
        >
            {editorChrome && hostAdapter.blueprintRuntime ? (
                <BlueprintWidgetInitLifecycle
                    surfaceId={surface.id}
                    elementId={resolved.id}
                    elementType={resolved.type}
                    behavior={resolved.behavior}
                    initBinding={resolved.behavior?.events?.init}
                    hostAdapter={hostAdapter}
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
