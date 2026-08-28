import { useEffect, useLayoutEffect, useRef } from "react";
import type { UIComponentId } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { releaseBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { SurfaceLifecycleSignals } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";

type Props = {
    surfaceId: string;
    elementId: string;
    elementType: string;
    /**
     * The blueprint this element owns the lifecycle of, so its locals can be dropped on unmount.
     *
     * Resolved by the caller rather than here, because it is an owner record in the blueprint
     * document and this component has no access to that. Reading it off the element instead - which
     * is where handlers used to live - is what left every widget the editor wires holding its locals
     * for the life of the process; see `widgetPrivateBlueprintHeads`.
     */
    ownedBlueprintId: string | undefined;
    hostAdapter: UIHostAdapter;
    componentId?: UIComponentId;
    /** Resolved params of the component instance this element belongs to; null outside one. */
    componentParams?: Record<string, string> | null;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    surfaceLifecycleSignals?: SurfaceLifecycleSignals;
};

function enqueuePrepaintTask(task: () => void): void {
    if (typeof queueMicrotask === "function") {
        queueMicrotask(task);
        return;
    }
    void Promise.resolve().then(task);
}

/**
 * Dispatches the widget `init` blueprint UI event once when the element mounts (Dev Mode when blueprintRuntime is present).
 * Releases per-widget blueprint execution locals when the element unmounts or blueprint wiring changes.
 */
export function BlueprintWidgetInitLifecycle({
    surfaceId,
    elementId,
    elementType,
    ownedBlueprintId,
    hostAdapter,
    componentId,
    componentParams,
    listItemScope,
    instanceKey,
    surfaceLifecycleSignals,
}: Props) {
    const rt = hostAdapter.blueprintRuntime;
    const runtimeScopeId = rt?.runtimeScopeId ?? surfaceId;
    const latestDispatchRef = useRef<{
        rt: typeof rt;
        elementId: string;
        componentId?: UIComponentId;
        componentParams?: Record<string, string> | null;
        listItemScope?: UIListItemScope | null;
        instanceKey?: string;
    }>({
        rt,
        elementId,
        componentId,
        componentParams,
        listItemScope,
        instanceKey,
    });

    const logicApi = getWidgetLogicApi(elementType);
    const hasLogicApiInit = Boolean(logicApi?.supportsPrivateBlueprint && logicApi.events.some(e => e.id === "init"));

    const initSig = hasLogicApiInit ? `logicApi:${elementType}:init` : "";
    const listItemScopeSig = listItemScope
        ? `${listItemScope.index}:${listItemScope.count}:${listItemScope.key}`
        : "";
    // The element tree rebuilds the resolved params on every render, so the object identity moves
    // even when nothing about the instance did. Effects below key off this signature instead: two
    // renders that resolve to the same values must not re-run an init dispatch or re-subscribe.
    const componentParamsSig = componentParams ? JSON.stringify(componentParams) : "";
    const beforeSurfaceExitVersion = surfaceLifecycleSignals?.beforeSurfaceExit ?? 0;
    const afterSurfaceEnterVersion = surfaceLifecycleSignals?.afterSurfaceEnter ?? 0;
    const seenBeforeSurfaceExitVersionRef = useRef(beforeSurfaceExitVersion);
    const seenAfterSurfaceEnterVersionRef = useRef(afterSurfaceEnterVersion);
    const dispatchedInitKeyRef = useRef<string | null>(null);
    const hasBlueprintRuntime = Boolean(rt);

    useLayoutEffect(() => {
        latestDispatchRef.current = {
            rt,
            elementId,
            componentId,
            componentParams,
            listItemScope,
            instanceKey,
        };
    });

    useEffect(() => {
        if (!hasBlueprintRuntime || !ownedBlueprintId) {
            return;
        }
        return () => {
            releaseBlueprintWidgetLocals(surfaceId, elementId, ownedBlueprintId, runtimeScopeId, { componentId });
        };
    }, [surfaceId, runtimeScopeId, elementId, componentId, hasBlueprintRuntime, ownedBlueprintId]);

    useLayoutEffect(() => {
        if (!rt || !initSig) {
            return;
        }
        // Params are part of the key for the same reason the list item scope is: an instance whose
        // save id changed is a different subject, and the widget has to run its init again to show
        // it. Editing a param in the inspector is what makes that visible while Dev Mode runs.
        const initDispatchKey = [
            runtimeScopeId,
            elementId,
            componentId ?? "",
            instanceKey ?? "",
            componentParamsSig,
            listItemScopeSig,
            initSig,
        ].join("|");
        if (dispatchedInitKeyRef.current === initDispatchKey) {
            return;
        }
        let cancelled = false;
        enqueuePrepaintTask(() => {
            if (cancelled || dispatchedInitKeyRef.current === initDispatchKey) {
                return;
            }
            dispatchedInitKeyRef.current = initDispatchKey;
            void rt.dispatchElementBlueprintEvent(elementId, "init", undefined, {
                componentId,
                componentParams: latestDispatchRef.current.componentParams ?? undefined,
                instanceKey,
                listItemScope,
            });
        });
        return () => {
            cancelled = true;
        };
    }, [componentId, componentParamsSig, elementId, initSig, instanceKey, listItemScope, listItemScopeSig, rt, runtimeScopeId]);

    useEffect(() => {
        if (!rt || beforeSurfaceExitVersion <= seenBeforeSurfaceExitVersionRef.current) {
            return;
        }
        seenBeforeSurfaceExitVersionRef.current = beforeSurfaceExitVersion;
        void rt.dispatchElementBlueprintEvent(elementId, "beforeSurfaceExit", undefined, {
            componentId,
            componentParams: latestDispatchRef.current.componentParams ?? undefined,
            instanceKey,
            listItemScope,
        });
    }, [beforeSurfaceExitVersion, componentId, elementId, instanceKey, listItemScope, rt]);

    useEffect(() => {
        if (!rt || afterSurfaceEnterVersion <= seenAfterSurfaceEnterVersionRef.current) {
            return;
        }
        seenAfterSurfaceEnterVersionRef.current = afterSurfaceEnterVersion;
        void rt.dispatchElementBlueprintEvent(elementId, "afterSurfaceEnter", undefined, {
            componentId,
            componentParams: latestDispatchRef.current.componentParams ?? undefined,
            instanceKey,
            listItemScope,
        });
    }, [afterSurfaceEnterVersion, componentId, elementId, instanceKey, listItemScope, rt]);

    useEffect(() => {
        if (!getWidgetLogicApi(elementType)?.events.some(e => e.id === "unmount")) {
            return undefined;
        }
        return () => {
            const latest = latestDispatchRef.current;
            void latest.rt?.dispatchElementBlueprintEvent(latest.elementId, "unmount", undefined, {
                componentId: latest.componentId,
                componentParams: latest.componentParams ?? undefined,
                instanceKey: latest.instanceKey,
                listItemScope: latest.listItemScope,
                allowClosedScopeExecution: true,
            });
        };
    }, [componentId, elementId, elementType, instanceKey, listItemScopeSig, runtimeScopeId]);

    return null;
}
