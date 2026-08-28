import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Button, Checkbox, Modal, ModalBody, ModalFooter } from "@/lib/components/elements";
import {
    getInputBindingDeviceActs,
    getInputBindingLabel,
} from "@/apps/workspace/modules/ui-editor/input/inputBindingLabels";
import { useTranslation } from "@/lib/i18n";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";

type AddSurfaceActionsDialogProps = {
    isOpen: boolean;
    /** Every action the project names that this interface does not answer yet. */
    available: readonly UIInputActionDef[];
    onClose: () => void;
    /** The actions the author picked. Never called with an empty list. */
    onAdd: (actionIds: string[]) => void;
    /** Take the author to where actions are made. */
    onCreate: () => void;
};

/**
 * Pick the actions an interface answers.
 *
 * A dialog rather than a list of switches in the panel, because the panel's job is to show what
 * this interface answers - a short list, usually one or two - and a switch per action in the
 * project turned that into a list that grew with the project and was mostly off. Adding is the rare
 * act; showing is the constant one.
 *
 * Multi-select, because an interface that answers one action usually answers the two or three that
 * go with it, and one dialog per action would charge for each.
 *
 * Comments in English per project convention.
 */
export function AddSurfaceActionsDialog({
    isOpen,
    available,
    onClose,
    onAdd,
    onCreate,
}: AddSurfaceActionsDialogProps) {
    const { t } = useTranslation();
    const [picked, setPicked] = useState<Set<string>>(new Set());

    // Cleared on every opening rather than on closing: a dialog dismissed with Escape leaves its
    // ticks behind otherwise, and they reappear the next time as though something had been chosen.
    useEffect(() => {
        if (isOpen) {
            setPicked(new Set());
        }
    }, [isOpen]);

    const toggle = (id: string) => {
        setPicked(current => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t("properties.scene.input.addTitle")} size="md">
            <ModalBody>
                {available.length === 0 ? (
                    <div className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-fg-subtle">
                        {t("properties.scene.input.addEmpty")}
                    </div>
                ) : (
                    <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
                        {available.map(action => (
                            <label
                                key={action.id}
                                className="flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-edge-subtle"
                            >
                                <Checkbox
                                    checked={picked.has(action.id)}
                                    onCheckedChange={() => toggle(action.id)}
                                    aria-label={action.name}
                                />
                                <span className="min-w-0 flex-1 truncate text-xs text-fg">{action.name}</span>
                                <span className="shrink-0 truncate text-2xs text-fg-subtle">
                                    {action.bindings.length === 0
                                        ? t("uiEditor.inputActions.noBindings")
                                        : action.bindings.map(binding => (
                                            <span
                                                key={getInputBindingLabel(binding, t)}
                                                className="ml-1"
                                                data-tip={getInputBindingDeviceActs(binding, t)}
                                            >
                                                {getInputBindingLabel(binding, t)}
                                            </span>
                                        ))}
                                </span>
                            </label>
                        ))}
                    </div>
                )}
            </ModalBody>
            <ModalFooter>
                <Button size="sm" variant="ghost" onClick={onCreate}>
                    <FilePlus2 className="h-3.5 w-3.5" aria-hidden />
                    {t("properties.scene.input.addCreate")}
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={onClose}>
                    {t("common.cancel")}
                </Button>
                <Button
                    size="sm"
                    variant="primary"
                    disabled={picked.size === 0}
                    onClick={() => {
                        onAdd(Array.from(picked));
                        onClose();
                    }}
                >
                    {t("properties.scene.input.addConfirm")}
                </Button>
            </ModalFooter>
        </Modal>
    );
}
