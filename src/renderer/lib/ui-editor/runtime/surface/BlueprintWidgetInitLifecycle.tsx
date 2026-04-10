import { useEffect, useMemo } from "react";
import type { UIBehaviorBinding } from "@shared/types/ui-editor/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { releaseBlueprintWidgetLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";

type Props = {
    surfaceId: string;
    elementId: string;
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
 */
export function BlueprintWidgetInitLifecycle({ surfaceId, elementId, behavior, initBinding, hostAdapter }: Props) {
    const rt = hostAdapter.blueprintRuntime;
    const initSig =
        initBinding?.kind === "blueprintEvent"
            ? `${initBinding.blueprintId}:${initBinding.eventId}`
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
                releaseBlueprintWidgetLocals(surfaceId, elementId, blueprintId);
            }
        };
    }, [surfaceId, elementId, rt, localsWiringKey]);

    useEffect(() => {
        if (!rt || !initSig) {
            return;
        }
        void rt.dispatchElementBlueprintEvent(elementId, "init");
    }, [elementId, initSig, rt]);

    return null;
}
