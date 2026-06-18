import { useEffect, useMemo } from "react";
import type { UIBehaviorBinding } from "@shared/types/ui-editor/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { releaseBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";

type Props = {
    surfaceId: string;
    elementId: string;
    elementType: string;
    behavior: UIElement["behavior"] | undefined;
    initBinding: UIBehaviorBinding | undefined;
    hostAdapter: UIHostAdapter;
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
export function BlueprintWidgetInitLifecycle({ surfaceId, elementId, elementType, behavior, initBinding, hostAdapter }: Props) {
    const rt = hostAdapter.blueprintRuntime;
    const runtimeScopeId = rt?.runtimeScopeId ?? surfaceId;

    const logicApi = getWidgetLogicApi(elementType);
    const hasLogicApiInit = Boolean(logicApi?.supportsPrivateBlueprint && logicApi.events.some(e => e.id === "init"));

    const initSig =
        initBinding?.kind === "blueprintEvent"
            ? `${initBinding.blueprintId}:${initBinding.eventId}`
            : hasLogicApiInit
              ? `logicApi:${elementType}:init`
              : "";

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
        if (!rt || !localsWiringKey) {
            return;
        }
        const blueprintIds = blueprintIdsFromWiringKey(localsWiringKey);
        return () => {
            for (const blueprintId of blueprintIds) {
                releaseBlueprintWidgetLocals(surfaceId, elementId, blueprintId, runtimeScopeId);
            }
        };
    }, [surfaceId, runtimeScopeId, elementId, rt, localsWiringKey]);

    useEffect(() => {
        if (!rt || !initSig) {
            return;
        }
        void rt.dispatchElementBlueprintEvent(elementId, "init");
    }, [elementId, initSig, rt]);

    return null;
}
