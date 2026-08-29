import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Select } from "@/lib/components/elements";
import {
    getInputBindingDeviceActs,
    getInputBindingLabel,
} from "@/apps/workspace/modules/ui-editor/input/inputBindingLabels";
import {
    UI_SURFACES_PANEL_ID,
    requestInputActionPanelFocus,
} from "@/apps/workspace/modules/ui-editor/input/inputActionPanelFocus";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import {
    UI_SURFACE_ACTION_DEFAULT_CONSUME,
    type UIInputActionDef,
} from "@shared/types/ui-editor/inputAction";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";
import { AddSurfaceActionsDialog } from "./AddSurfaceActionsDialog";

/**
 * Which of the project's input actions this interface answers.
 *
 * **Only the ones it answers.** The section used to list every action the project names with a
 * switch on each, which read as a settings page for the project rather than a statement about this
 * interface, and grew every time anybody added an action anywhere. What an interface answers is
 * usually one or two things; that is what is worth a row.
 *
 * **Bindings are not editable here, and there is nothing to edit.** An action carries its own
 * gestures and every interface that answers it answers the same ones. The row shows them so the
 * author can see what the interface is reacting to, and the one thing this interface decides is
 * whether firing the action ends the input or lets it carry on behind.
 */
export function SurfaceInputActionsField({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const [adding, setAdding] = useState(false);
    const uiService = useMemo<UIService | null>(
        () => (context ? context.services.get<UIService>(Services.UI) : null),
        [context],
    );

    const actions: UIInputActionDef[] = Object.values(data.documentService.getInputActions());
    const enablements = data.surface.actions ?? [];
    const surfaceId = data.surface.id;

    const byId = new Map(actions.map(action => [action.id, action]));
    const answered = enablements
        .map(enablement => ({ enablement, action: byId.get(enablement.actionId) }))
        .filter((entry): entry is { enablement: typeof entry.enablement; action: UIInputActionDef } =>
            Boolean(entry.action));
    const answeredIds = new Set(answered.map(entry => entry.action.id));
    const available = actions.filter(action => !answeredIds.has(action.id));

    const bindingsOf = (action: UIInputActionDef) => (
        action.bindings.length === 0
            ? t("uiEditor.inputActions.noBindings")
            : action.bindings.map(binding => (
                <span
                    key={getInputBindingLabel(binding, t)}
                    className="ml-1"
                    data-tip={getInputBindingDeviceActs(binding, t)}
                >
                    {getInputBindingLabel(binding, t)}
                </span>
            ))
    );

    return (
        <div className="space-y-2">
            {answered.length === 0 ? (
                <div className="rounded-md border border-dashed border-edge px-3 py-3 text-center text-xs text-fg-subtle">
                    {t("properties.scene.input.answersNone")}
                </div>
            ) : (
                answered.map(({ action, enablement }) => (
                    <div key={action.id} className="rounded-md border border-edge bg-surface px-2 py-2">
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg" data-tip={action.name}>
                                {action.name}
                            </div>
                            <div className="shrink-0 truncate text-2xs text-fg-subtle">{bindingsOf(action)}</div>
                            <button
                                type="button"
                                className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-edge-subtle hover:text-fg"
                                onClick={() =>
                                    data.documentService.setSurfaceActionEnabled(surfaceId, action.id, false)
                                }
                                aria-label={t("properties.scene.input.removeAction", { name: action.name })}
                                data-tip={t("properties.scene.input.removeAction", { name: action.name })}
                            >
                                <X className="h-3 w-3" aria-hidden />
                            </button>
                        </div>
                        <div className="mt-2 flex items-center gap-2 border-t border-edge-subtle pt-2">
                            <span className="w-20 shrink-0 text-2xs text-fg-muted">
                                {t("properties.scene.input.bubble")}
                            </span>
                            <Select
                                size="sm"
                                fullWidth
                                value={(enablement.consume ?? UI_SURFACE_ACTION_DEFAULT_CONSUME) ? "stop" : "continue"}
                                options={[
                                    { value: "stop", label: t("properties.scene.input.bubbleStop") },
                                    { value: "continue", label: t("properties.scene.input.bubbleContinue") },
                                ]}
                                ariaLabel={t("properties.scene.input.bubble")}
                                onChange={value =>
                                    data.documentService.updateSurfaceActionEnablement(surfaceId, action.id, {
                                        consume: value === "stop",
                                    })
                                }
                            />
                        </div>
                    </div>
                ))
            )}
            <button
                type="button"
                className="flex min-h-7 w-full items-center justify-center gap-1 rounded-md border border-edge text-xs text-fg-muted hover:bg-fill hover:text-fg"
                onClick={() => setAdding(true)}
            >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("properties.scene.input.addActions")}
            </button>
            <AddSurfaceActionsDialog
                isOpen={adding}
                available={available}
                onClose={() => setAdding(false)}
                onAdd={actionIds => {
                    for (const actionId of actionIds) {
                        data.documentService.setSurfaceActionEnabled(surfaceId, actionId, true);
                    }
                }}
                onCreate={() => {
                    setAdding(false);
                    // The rail may be closed, and a panel that is not mounted cannot answer a
                    // request to open itself - so the rail is shown first and the section asked
                    // second.
                    uiService?.panels.show(UI_SURFACES_PANEL_ID);
                    requestInputActionPanelFocus();
                }}
            />
        </div>
    );
}
