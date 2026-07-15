import { useEffect, useMemo, useRef, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { useWorkspace } from "../context";
import { useRegistry } from "../registry";
import { getActionGroupItems, getVisibleActionMenuItems, isActionMenuAction, isActionMenuSeparator } from "../components/ui/actionMenuModel";
import type { ActionMenuItem } from "../registry/types";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import type { FocusContext } from "@/lib/workspace/services/ui";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { PreviewService } from "@/lib/workspace/services/core/PreviewService";
import { isDevModeRuntimeActive, isPreviewRuntimeActive } from "../modules/actions/runtimeActionStatus";
import type { DevModeStatus } from "@shared/types/devMode";
import type { PreviewStatus } from "@shared/types/gameRuntime";
import { useTranslation } from "@/lib/i18n";
import type { NativeMenuGroup, NativeMenuItem, NativeMenuModel, NativeMenuSlot } from "@shared/types/menu";

/**
 * Mirrors the workspace's action-registry menus onto the macOS menu bar.
 *
 * The main process cannot build these itself: which groups exist depends on what is registered
 * (an image tab's Preview group is keyed by tab id) and what is visible depends on the current
 * focus. So the renderer computes the model — reusing the same visibility rules the in-app
 * dropdowns use — and pushes it up whenever it changes.
 *
 * Only the shape is sent. Clicks come back as action ids and are dispatched by
 * `useMenuActionHandler`, so behaviour stays in one place. Each group carries the `menuSlot` it
 * declared, so the main process places it without recognising any particular group.
 */
export function useNativeMenuSync(): void {
    const { t } = useTranslation();
    const { actionGroups } = useRegistry();
    const { context } = useWorkspace();
    const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
    const [devModeStatus, setDevModeStatus] = useState<DevModeStatus>("idle");
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
    const lastSentRef = useRef<string | null>(null);

    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        setFocusContext(uiService.focus.getFocus());

        return uiService.focus.onFocusChange((newContext) => {
            setFocusContext(newContext);
        });
    }, [context]);

    // The Develop menu's checkmarks (Dev Mode / Preview running) come from renderer services,
    // so their status rides along with the menu sync.
    useEffect(() => {
        if (!context) return;

        const devModeService = context.services.get<DevModeService>(Services.DevMode);
        setDevModeStatus(devModeService.getStatus());
        const unsub = devModeService.onStatusChanged(setDevModeStatus);
        return () => {
            unsub();
        };
    }, [context]);

    useEffect(() => {
        if (!context) return;

        const previewService = context.services.get<PreviewService>(Services.Preview);
        setPreviewStatus(previewService.getStatus());
        const unsub = previewService.onStatusChanged(setPreviewStatus);
        return () => {
            unsub();
        };
    }, [context]);

    const model = useMemo<NativeMenuModel>(() => {
        const groups: NativeMenuGroup[] = actionGroups
            // `none` is for groups the main process builds natively itself (File, Help);
            // mirroring them too would leave the menu bar with two of each.
            .filter(group => (group.menuSlot ?? "top-level") !== "none")
            .map(group => ({
                id: group.id,
                label: group.labelKey ? t(group.labelKey) : group.label,
                slot: (group.menuSlot ?? "top-level") as Exclude<NativeMenuSlot, "none">,
                items: serializeItems(getVisibleActionMenuItems(getActionGroupItems(group), focusContext), focusContext, t),
            }))
            .filter(group => group.items.some(item => item.kind !== "separator"));

        return {
            groups,
            runtime: {
                devModeActive: isDevModeRuntimeActive(devModeStatus),
                previewActive: isPreviewRuntimeActive(previewStatus),
            },
        };
    }, [actionGroups, focusContext, devModeStatus, previewStatus, t]);

    useEffect(() => {
        if (!isMacPlatform()) return;

        // Focus changes fire often; only cross the IPC boundary when the menu actually differs.
        const serialized = JSON.stringify(model);
        if (lastSentRef.current === serialized) {
            return;
        }
        lastSentRef.current = serialized;

        getInterface().workspace.syncNativeMenu(model);
    }, [model]);
}

function serializeItems(
    items: ActionMenuItem[],
    focusContext: FocusContext | null,
    t: ReturnType<typeof useTranslation>["t"],
): NativeMenuItem[] {
    return items.map<NativeMenuItem>(item => {
        if (isActionMenuSeparator(item)) {
            return { kind: "separator" };
        }

        if (isActionMenuAction(item)) {
            return {
                kind: "action",
                id: item.id,
                label: item.labelKey ? t(item.labelKey) : (item.label ?? ""),
                enabled: !item.disabled,
                ...(item.checked === undefined ? {} : { checked: item.checked }),
                ...(item.menuRole === undefined ? {} : { role: item.menuRole }),
            };
        }

        // getVisibleActionMenuItems only filters one level; submenu children need the same
        // visibility rules or focus-gated items would leak onto the native menu.
        return {
            kind: "submenu",
            label: item.labelKey ? t(item.labelKey) : item.label,
            items: serializeItems(getVisibleActionMenuItems(item.items, focusContext), focusContext, t),
        };
    });
}
