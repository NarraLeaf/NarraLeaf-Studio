import { useEffect, useMemo } from "react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { BLUEPRINT_GAME_NOTIFICATIONS_STATE_KEY } from "@shared/types/blueprint/hostApi";
import type { BlueprintGameNotification } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import {
    collectSurfaceElementIdsByType,
    StageSlotSurfaceBody,
    stageSlotWidgetRuntimeKey,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

const NOTIFICATION_LIST_WIDGET_TYPE = "nl.notification.list";

type NlrNotification = {
    message: string;
    id: string;
};

/**
 * Renders the Game UI notification slot surface as the NarraLeaf notification component.
 * NarraLeaf wraps it in a full-size, ratio-scaled, pointer-events-none layer and re-renders it
 * with the live `notifications` array; the bridge mirrors those into the widget runtime list
 * store, the blueprint global scope, and slot flush dispatch.
 */
export function NotificationSlotSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    notifications: readonly NlrNotification[];
}) {
    const { options, surface, notifications } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "notification" });
    const { core, bundle, widgetRuntimeStore } = options;
    const { runtimeScopeId, flushSlotElements } = runtime;

    const listElementIds = useMemo(
        () => collectSurfaceElementIdsByType(bundle.ui.uidoc, surface, NOTIFICATION_LIST_WIDGET_TYPE),
        [bundle.ui.uidoc, surface],
    );

    const items = useMemo<BlueprintGameNotification[]>(
        () => notifications.map(notification => ({
            id: String(notification.id ?? ""),
            message: String(notification.message ?? ""),
        })),
        [notifications],
    );

    useEffect(() => {
        if (!core) {
            return;
        }
        for (const elementId of listElementIds) {
            widgetRuntimeStore.setListItems(stageSlotWidgetRuntimeKey(runtimeScopeId, elementId), items);
        }
        core.scopeBridge.globalSet(BLUEPRINT_GAME_NOTIFICATIONS_STATE_KEY, items);
        flushSlotElements();
    }, [core, flushSlotElements, items, listElementIds, runtimeScopeId, widgetRuntimeStore]);

    return <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} />;
}

export function createNotificationSlotComponent(options: GameUiSlotHostOptions, surface: UIStageSurface) {
    return function NotificationSlotGameUI({ notifications }: { notifications: NlrNotification[] }) {
        return (
            <NotificationSlotSurface
                options={options}
                surface={surface}
                notifications={notifications ?? []}
            />
        );
    };
}
