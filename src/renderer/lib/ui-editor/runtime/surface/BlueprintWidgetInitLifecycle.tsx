import { useEffect, useMemo, useRef } from "react";
import type { UIBehaviorBinding } from "@shared/types/ui-editor/document";
import type { UIElement } from "@shared/types/ui-editor/document";
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
    behavior: UIElement["behavior"] | undefined;
    initBinding: UIBehaviorBinding | undefined;
    hostAdapter: UIHostAdapter;
    componentId?: UIComponentId;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    surfaceLifecycleSignals?: SurfaceLifecycleSignals;
};

function blueprintIdsFromWiringKey(key: string): string[] {
    if (!key) {
        return [];
    }
    const ids = new Set<string>();
    for (const part of key.split("|")) {
        const idx = part.indexOf(":");
        if (idx === -1) {
            continue;
        }
        ids.add(part.slice(idx + 1));
    }
    return [...ids];
}

/**
 * Dispatches the widget `init` blueprint UI event once when the element mounts (Dev Mode when blueprintRuntime is present).
 * Releases per-widget blueprint execution locals when the element unmounts or blueprint wiring changes.
 *
 * Supports both legacy behavior.events.init binding and the new WidgetLogicApi owner-local blueprint.
 */
export function BlueprintWidgetInitLifecycle({
    surfaceId,
    elementId,
    elementType,
    behavior,
    initBinding,
    hostAdapter,
    componentId,
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
        listItemScope?: UIListItemScope | null;
        instanceKey?: string;
    }>({
        rt,
        elementId,
        componentId,
        listItemScope,
        instanceKey,
    });

    const logicApi = getWidgetLogicApi(elementType);
    const hasLogicApiInit = Boolean(logicApi?.supportsPrivateBlueprint && logicApi.events.some(e => e.id === "init"));

    const initSig =
        initBinding?.kind === "blueprintEvent"
            ? `${initBinding.blueprintId}:${initBinding.eventId}`
            : hasLogicApiInit
              ? `logicApi:${elementType}:init`
              : "";
    const listItemScopeSig = listItemScope
        ? `${listItemScope.index}:${listItemScope.count}:${listItemScope.key}`
        : "";
    const beforeSurfaceExitVersion = surfaceLifecycleSignals?.beforeSurfaceExit ?? 0;
    const afterSurfaceEnterVersion = surfaceLifecycleSignals?.afterSurfaceEnter ?? 0;
    const seenBeforeSurfaceExitVersionRef = useRef(beforeSurfaceExitVersion);
    const seenAfterSurfaceEnterVersionRef = useRef(afterSurfaceEnterVersion);
    const dispatchedInitKeyRef = useRef<string | null>(null);
    const hasBlueprintRuntime = Boolean(rt);

    const localsWiringKey = useMemo(() => {
        const ev = behavior?.events;
        if (!ev) {
            return "";
        }
        return Object.entries(ev)
            .filter(([, b]) => b?.kind === "blueprintEvent")
            .map(([slot, b]) => `${slot}:${(b as { blueprintId: string }).blueprintId}`)
            .sort()
            .join("|");
    }, [behavior?.events]);

    useEffect(() => {
        latestDispatchRef.current = {
            rt,
            elementId,
            componentId,
            listItemScope,
            instanceKey,
        };
    });

    useEffect(() => {
        if (!hasBlueprintRuntime || !localsWiringKey) {
            return;
        }
        const blueprintIds = blueprintIdsFromWiringKey(localsWiringKey);
        return () => {
            for (const blueprintId of blueprintIds) {
                releaseBlueprintWidgetLocals(surfaceId, elementId, blueprintId, runtimeScopeId);
            }
        };
    }, [surfaceId, runtimeScopeId, elementId, hasBlueprintRuntime, localsWiringKey]);

    useEffect(() => {
        if (!rt || !initSig) {
            return;
        }
        const initDispatchKey = [
            runtimeScopeId,
            elementId,
            componentId ?? "",
            instanceKey ?? "",
            listItemScopeSig,
            initSig,
        ].join("|");
        if (dispatchedInitKeyRef.current === initDispatchKey) {
            return;
        }
        const timeoutId = setTimeout(() => {
            dispatchedInitKeyRef.current = initDispatchKey;
            void rt.dispatchElementBlueprintEvent(elementId, "init", undefined, {
                componentId,
                instanceKey,
                listItemScope,
            });
        }, 0);
        return () => clearTimeout(timeoutId);
    }, [componentId, elementId, initSig, instanceKey, listItemScope, listItemScopeSig, rt, runtimeScopeId]);

    useEffect(() => {
        if (!rt || beforeSurfaceExitVersion <= seenBeforeSurfaceExitVersionRef.current) {
            return;
        }
        seenBeforeSurfaceExitVersionRef.current = beforeSurfaceExitVersion;
        void rt.dispatchElementBlueprintEvent(elementId, "beforeSurfaceExit", undefined, {
            componentId,
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
                instanceKey: latest.instanceKey,
                listItemScope: latest.listItemScope,
                allowClosedScopeExecution: true,
            });
        };
    }, [componentId, elementId, elementType, instanceKey, listItemScopeSig, runtimeScopeId]);

    return null;
}
