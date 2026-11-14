import { memo, useEffect, useLayoutEffect, useRef } from "react";
import type { UIComponentId } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { holdBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { useSurfaceTreeLifecycleSignals } from "@/lib/ui-editor/runtime/surface/surfaceTreeContext";

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
 *
 * Memoised on its props: it draws nothing, and every effect below is keyed on values those props
 * carry, so a render with the same props does nothing at all. The tree hands it a new element each
 * time an element's wrapper is rebuilt, which on a page switch is several times per element - a
 * render apiece that could not change anything. The surface's lifecycle signals come from context
 * (see `surfaceTreeContext`), so they still reach it when its props are unchanged.
 */
export const BlueprintWidgetInitLifecycle = memo(function BlueprintWidgetInitLifecycle({
    surfaceId,
    elementId,
    elementType,
    ownedBlueprintId,
    hostAdapter,
    componentId,
    componentParams,
    listItemScope,
    instanceKey,
}: Props) {
    const surfaceLifecycleSignals = useSurfaceTreeLifecycleSignals();
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
    // The element tree rebuilds the resolved params on every render, so the object identity moves
    // even when nothing about the instance did. Effects below key off this signature instead: two
    // renders that resolve to the same values must not re-run an init dispatch or re-subscribe.
    const componentParamsSig = componentParams ? JSON.stringify(componentParams) : "";
    const beforeSurfaceExitVersion = surfaceLifecycleSignals?.beforeSurfaceExit ?? 0;
    const afterSurfaceEnterVersion = surfaceLifecycleSignals?.afterSurfaceEnter ?? 0;
    const seenBeforeSurfaceExitVersionRef = useRef(beforeSurfaceExitVersion);
    const seenAfterSurfaceEnterVersionRef = useRef(afterSurfaceEnterVersion);
    const dispatchedInitKeyRef = useRef<string | null>(null);
    const heldLocalsRef = useRef<ReturnType<typeof holdBlueprintWidgetLocals> | null>(null);
    const retiringLocalsRef = useRef<ReturnType<typeof holdBlueprintWidgetLocals> | null>(null);
    const retiringDispatchRef = useRef<typeof latestDispatchRef.current | null>(null);
    const unmountDispatchRef = useRef<Promise<void> | undefined>(undefined);
    const pendingReplayRef = useRef<{ key: string; cancel: () => void } | null>(null);
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

    useLayoutEffect(() => {
        if (!hasBlueprintRuntime || !ownedBlueprintId) {
            return undefined;
        }
        const held = holdBlueprintWidgetLocals({
            surfaceId, elementId, blueprintId: ownedBlueprintId, runtimeScopeId, componentId, instanceKey,
        });
        heldLocalsRef.current = held;
        return () => {
            if (heldLocalsRef.current === held) {
                heldLocalsRef.current = null;
            }
            // A new drawing can mount in this commit before passive Unmount cleanup runs. Its old
            // record must already be retired, while the old handler can still acquire it.
            held.retire();
            retiringLocalsRef.current = held;
            retiringDispatchRef.current = latestDispatchRef.current;
        };
    }, [surfaceId, runtimeScopeId, elementId, componentId, instanceKey, hasBlueprintRuntime, ownedBlueprintId]);

    useEffect(() => {
        if (!getWidgetLogicApi(elementType)?.events.some(e => e.id === "unmount")) {
            return undefined;
        }
        const key = JSON.stringify([runtimeScopeId, componentId, elementId, elementType, instanceKey]);
        if (pendingReplayRef.current?.key === key) {
            pendingReplayRef.current.cancel();
            pendingReplayRef.current = null;
        }
        let committed = false;
        enqueuePrepaintTask(() => { committed = true; });
        return () => {
            const latest = retiringDispatchRef.current ?? latestDispatchRef.current;
            const held = retiringLocalsRef.current;
            const dispatch = () => latest.rt?.dispatchElementBlueprintEvent(latest.elementId, "unmount", undefined, {
                componentId: latest.componentId,
                componentParams: latest.componentParams ?? undefined,
                instanceKey: latest.instanceKey,
                listItemScope: latest.listItemScope,
                allowClosedScopeExecution: true,
            });
            const run = () => held ? held.runUnmount(dispatch) : dispatch();
            if (committed) {
                unmountDispatchRef.current = run();
                return;
            }
            // StrictMode immediately reinstalls this effect; a real short-lived mount does not.
            let cancelled = false;
            const pending = { key, cancel: () => { cancelled = true; } };
            pendingReplayRef.current = pending;
            const result = Promise.resolve().then(() => {
                if (pendingReplayRef.current === pending) {
                    pendingReplayRef.current = null;
                }
                return cancelled ? undefined : run();
            });
            void result.catch(() => undefined);
            unmountDispatchRef.current = result;
        };
    }, [componentId, elementId, elementType, instanceKey, runtimeScopeId]);

    useEffect(() => {
        const held = heldLocalsRef.current;
        return () => {
            held?.release(unmountDispatchRef.current);
            unmountDispatchRef.current = undefined;
            if (retiringLocalsRef.current === held) {
                // If wiring disappeared, a later Unmount can still reach the previous runtime
                // snapshot. Dispatch it against the retired record rather than creating a live one.
                if (heldLocalsRef.current) {
                    retiringLocalsRef.current = null;
                }
                retiringDispatchRef.current = null;
            }
        };
    }, [surfaceId, runtimeScopeId, elementId, componentId, instanceKey, hasBlueprintRuntime, ownedBlueprintId]);

    useLayoutEffect(() => {
        if (!rt || !initSig) {
            return;
        }
        // Changing a component parameter can make a placement represent a different subject.
        const initDispatchKey = [
            runtimeScopeId,
            elementId,
            componentId ?? "",
            instanceKey ?? "",
            componentParamsSig,
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
    }, [componentId, componentParamsSig, elementId, initSig, instanceKey, listItemScope, rt, runtimeScopeId]);

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

    return null;
});
