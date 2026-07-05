import { useEffect, useMemo, useRef } from "react";
import { NvlContainer } from "narraleaf-react";
import type { UIStageSurface } from "@shared/types/ui-editor/document";
import { BLUEPRINT_GAME_NVL_MODE_STATE_KEY } from "@shared/types/blueprint/hostApi";
import {
    NvlSlotItemsContext,
    type NvlSlotDialogProxy,
} from "@/lib/ui-editor/runtime/game/nvlSlotItemsContext";
import { readNlrCharacterName } from "./nlrDialogReaders";
import {
    collectSurfaceElementIdsByType,
    StageSlotSurfaceBody,
    stageSlotWidgetRuntimeKey,
    useStageSlotSurfaceRuntime,
    type GameUiSlotHostOptions,
} from "./StageSlotSurfaceShell";

const NVL_LIST_WIDGET_TYPE = "nl.nvl.list";

type NvlEntryLike = {
    character?: unknown;
};

type NvlSlotItem = {
    index: number;
    nametag: string;
    isActive: boolean;
};

/**
 * Renders the Game UI NVL slot surface as the NarraLeaf `nvlDialog` component. `<NvlContainer>`
 * owns visibility, the fade transition, and design-pixel aspect scaling. JSON-safe item data
 * ({ index, nametag, isActive }) is mirrored into the widget runtime list store while the raw
 * `NvlDialogProxy` entries flow only through `NvlSlotItemsContext` for the `nl.nvl.texts` leaf.
 */
export function NvlSlotSurface(props: {
    options: GameUiSlotHostOptions;
    surface: UIStageSurface;
    dialogs: readonly NvlSlotDialogProxy[];
}) {
    const { options, surface, dialogs } = props;
    const runtime = useStageSlotSurfaceRuntime({ options, surface, slotId: "nvl" });
    const { core, bundle, widgetRuntimeStore, isNvlModeInGame } = options;
    const { runtimeScopeId, flushSlotElements } = runtime;
    const previousCountRef = useRef(0);

    const listElementIds = useMemo(
        () => collectSurfaceElementIdsByType(bundle.ui.uidoc, surface, NVL_LIST_WIDGET_TYPE),
        [bundle.ui.uidoc, surface],
    );

    const items = useMemo<NvlSlotItem[]>(
        () => dialogs.map((proxy, index) => ({
            index,
            nametag: readNlrCharacterName((proxy.entry as NvlEntryLike | null | undefined)?.character) ?? "",
            isActive: proxy.isActive === true,
        })),
        [dialogs],
    );

    useEffect(() => {
        if (!core) {
            return;
        }
        for (const elementId of listElementIds) {
            widgetRuntimeStore.setListItems(stageSlotWidgetRuntimeKey(runtimeScopeId, elementId), items);
        }
        core.scopeBridge.globalSet(BLUEPRINT_GAME_NVL_MODE_STATE_KEY, isNvlModeInGame());
        flushSlotElements();
        if (items.length > previousCountRef.current) {
            for (const elementId of listElementIds) {
                widgetRuntimeStore.requestListScroll(
                    stageSlotWidgetRuntimeKey(runtimeScopeId, elementId),
                    { kind: "bottom" },
                );
            }
        }
        previousCountRef.current = items.length;
    }, [core, flushSlotElements, isNvlModeInGame, items, listElementIds, runtimeScopeId, widgetRuntimeStore]);

    useEffect(() => {
        if (!core) {
            return;
        }
        return () => {
            core.scopeBridge.globalSet(BLUEPRINT_GAME_NVL_MODE_STATE_KEY, false);
        };
    }, [core]);

    return (
        <NvlContainer>
            <NvlSlotItemsContext.Provider value={dialogs}>
                <StageSlotSurfaceBody options={options} surface={surface} runtime={runtime} />
            </NvlSlotItemsContext.Provider>
        </NvlContainer>
    );
}

export function createNvlSlotComponent(options: GameUiSlotHostOptions, surface: UIStageSurface) {
    return function NvlSlotGameUI({ dialogs }: { dialogs?: NvlSlotDialogProxy[] }) {
        return (
            <NvlSlotSurface
                options={options}
                surface={surface}
                dialogs={dialogs ?? []}
            />
        );
    };
}
