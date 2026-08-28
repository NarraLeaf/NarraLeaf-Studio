import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronDown, MoreVertical, Plus, Pointer } from "lucide-react";
import {
    UI_INPUT_ACTION_PRESETS,
    type UIInputActionDef,
    type UIInputBinding,
} from "@shared/types/ui-editor/inputAction";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "../../../components/ui/freezeGuard";
import { InputBindingList } from "./InputBindingList";
import { interfaceDocumentFreezeScope } from "../uiLiveSession";

type InputActionLibraryPanelProps = {
    documentService: UIDocumentService | null;
    uiService: UIService | null;
};

/** How many interfaces answer each action, in one pass over the document. */
function countAnsweringSurfaces(documentService: UIDocumentService | null): Record<string, number> {
    if (!documentService) {
        return {};
    }
    const counts: Record<string, number> = {};
    for (const surface of documentService.getDocument().surfaces) {
        for (const enablement of surface.actions ?? []) {
            counts[enablement.actionId] = (counts[enablement.actionId] ?? 0) + 1;
        }
    }
    return counts;
}

/**
 * The project's input vocabulary, beside the interfaces that answer it.
 *
 * Here rather than in a panel of its own because it is the same kind of thing as the Component
 * Library directly below it: a project-level table with no canvas, read by every interface, edited
 * in one place. An author who has just written "click here means advance" on a page finds the word
 * "advance" defined one section down the same rail.
 *
 * Only the *defaults* live here. Which interface answers which action, and with what extra
 * bindings, is the interface's own business and is set in its Input section.
 */
export function InputActionLibraryPanel({ documentService, uiService }: InputActionLibraryPanelProps) {
    const { t, tn } = useTranslation();
    // Browsable while frozen, as the component library is: reading the vocabulary costs nothing,
    // and only creating, renaming, rebinding and deleting are off.
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const [open, setOpen] = useState(false);
    const [actions, setActions] = useState<UIInputActionDef[]>([]);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);

    useEffect(() => {
        if (!documentService) {
            setActions([]);
            return undefined;
        }
        const refresh = () => setActions(Object.values(documentService.getInputActions()));
        refresh();
        return documentService.onDocumentChanged(refresh);
    }, [documentService]);

    // `actions` is a fresh array on every document change, so this recounts exactly as often as the
    // numbers can move and no more.
    const answeredCounts = useMemo(() => countAnsweringSurfaces(documentService), [actions, documentService]);

    /**
     * Create one action, starting from a preset.
     *
     * The preset fills in the name and the bindings and is then spent: what it laid down is edited
     * from the row like anything else, and nothing records that it was used. Blank is on the same
     * list rather than being a different button, because picking a starting point is one decision.
     */
    const handleCreate = useCallback(
        async (presetId: string) => {
            if (!documentService) {
                return;
            }
            const preset = UI_INPUT_ACTION_PRESETS.find(entry => entry.id === presetId);
            const suggestedName = preset && preset.id !== "blank"
                ? t(`uiEditor.inputActions.presets.${preset.id}` as never)
                : t("uiEditor.naming.inputAction", { index: actions.length + 1 });
            const name = inputDialog
                ? await inputDialog.show({
                      title: t("uiEditor.inputActions.createTitle"),
                      initialValue: suggestedName,
                      required: true,
                      maxLength: 100,
                  })
                : suggestedName;
            if (!name) {
                return;
            }
            documentService.createInputAction(name, preset?.bindings ?? []);
        },
        [actions.length, documentService, inputDialog, t],
    );

    const openCreateMenu = useCallback(
        (event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            setMenuItems(
                UI_INPUT_ACTION_PRESETS.map(preset => ({
                    id: `preset:${preset.id}`,
                    label: t(`uiEditor.inputActions.presets.${preset.id}` as never),
                    onClick: () => {
                        hideMenu();
                        void handleCreate(preset.id);
                    },
                })),
            );
            showMenu(event);
        },
        [handleCreate, hideMenu, showMenu, t],
    );

    const handleRename = useCallback(
        async (action: UIInputActionDef) => {
            if (!documentService || !inputDialog) {
                return;
            }
            const name = await inputDialog.showRenameDialog(action.name, "inputAction");
            if (name) {
                documentService.renameInputAction(action.id, name);
            }
        },
        [documentService, inputDialog],
    );

    const handleDelete = useCallback(
        async (action: UIInputActionDef) => {
            if (!documentService) {
                return;
            }
            const answered = answeredCounts[action.id] ?? 0;
            if (answered > 0 && uiService) {
                const confirmed = await uiService.showConfirm(
                    t("uiEditor.inputActions.deleteConfirm", { name: action.name }),
                    tn("uiEditor.inputActions.deleteDetail", answered),
                );
                if (!confirmed) {
                    return;
                }
            }
            documentService.deleteInputAction(action.id);
        },
        [answeredCounts, documentService, t, tn, uiService],
    );

    const openActionMenu = useCallback(
        (event: MouseEvent<HTMLButtonElement | HTMLDivElement>, action: UIInputActionDef) => {
            event.preventDefault();
            event.stopPropagation();
            setMenuItems([
                {
                    id: "rename",
                    label: t("uiEditor.inputActions.rename"),
                    ...freeze.menuRow(),
                    onClick: () => {
                        hideMenu();
                        void handleRename(action);
                    },
                },
                { id: "sep", separator: true },
                {
                    id: "delete",
                    label: t("uiEditor.inputActions.delete"),
                    ...freeze.menuRow(),
                    onClick: () => {
                        hideMenu();
                        void handleDelete(action);
                    },
                },
            ]);
            showMenu(event);
        },
        [freeze, handleDelete, handleRename, hideMenu, showMenu, t],
    );

    const setBindings = useCallback(
        (action: UIInputActionDef, bindings: UIInputBinding[]) => {
            documentService?.setInputActionBindings(action.id, bindings);
        },
        [documentService],
    );

    return (
        <div className="shrink-0 border-t border-edge bg-surface-sunken" data-help-topic="inputActions">
            <button
                type="button"
                className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs font-semibold text-fg hover:bg-fill-subtle"
                onClick={() => setOpen(value => !value)}
            >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
                <Pointer className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">{t("uiEditor.inputActions.title")}</span>
                <span className="text-2xs font-normal text-fg-subtle">{actions.length}</span>
            </button>
            {open ? (
                <div className="space-y-2 border-t border-edge p-2">
                    <button
                        type="button"
                        className="flex min-h-7 w-full items-center justify-center gap-1 rounded-md border border-edge text-xs text-fg-muted hover:bg-fill hover:text-fg"
                        onClick={openCreateMenu}
                        {...freeze.writes(!documentService, t("uiEditor.inputActions.create"))}
                    >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        {t("uiEditor.inputActions.create")}
                    </button>
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                        {actions.length === 0 ? (
                            <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-subtle">
                                {t("uiEditor.inputActions.empty")}
                            </div>
                        ) : (
                            actions.map(action => (
                                <div
                                    key={action.id}
                                    className="group rounded-md border border-edge bg-fill-subtle px-2 py-2"
                                    onContextMenu={event => openActionMenu(event, action)}
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="min-w-0 flex-1 truncate text-left text-xs font-medium text-fg"
                                            data-tip={action.name}
                                        >
                                            {action.name}
                                        </div>
                                        <span className="shrink-0 text-2xs text-fg-subtle">
                                            {tn("uiEditor.inputActions.answered", answeredCounts[action.id] ?? 0)}
                                        </span>
                                        <button
                                            type="button"
                                            className="grid h-6 w-6 place-items-center rounded-md text-fg-muted hover:bg-fill hover:text-fg"
                                            onClick={event => openActionMenu(event, action)}
                                            data-tip={t("uiEditor.inputActions.actionOptions")}
                                            aria-label={t("uiEditor.inputActions.actionOptions")}
                                        >
                                            <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                                        </button>
                                    </div>
                                    <div className="mt-2">
                                        <InputBindingList
                                            bindings={action.bindings}
                                            onChange={bindings => setBindings(action, bindings)}
                                        />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            ) : null}
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
