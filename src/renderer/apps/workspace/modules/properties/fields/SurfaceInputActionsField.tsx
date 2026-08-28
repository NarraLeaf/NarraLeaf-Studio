import { Select, Switch } from "@/lib/components/elements";
import {
    getInputBindingDeviceActs,
    getInputBindingLabel,
} from "@/apps/workspace/modules/ui-editor/input/inputBindingLabels";
import { useTranslation } from "@/lib/i18n";
import {
    UI_SURFACE_ACTION_DEFAULT_CONSUME,
    type UIInputActionDef,
} from "@shared/types/ui-editor/inputAction";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";

/**
 * Which of the project's input actions this interface answers.
 *
 * One row per vocabulary entry, switched off by default: an interface answers nothing until an
 * author says so, which is what keeps "the project names an action" from meaning "every page now
 * reacts to it".
 *
 * **Bindings are not editable here, and there is nothing to edit.** An action carries its own
 * gestures and every interface that answers it answers the same ones. The row shows them so the
 * author knows what the switch is turning on, and the one thing this interface decides about the
 * action is the row below: whether firing it ends the input or lets it carry on behind.
 */
export function SurfaceInputActionsField({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t } = useTranslation();
    const actions: UIInputActionDef[] = Object.values(data.documentService.getInputActions());
    const enablements = data.surface.actions ?? [];
    const surfaceId = data.surface.id;

    if (actions.length === 0) {
        return (
            <div className="rounded-md border border-dashed border-edge px-3 py-3 text-center text-xs text-fg-subtle">
                {t("properties.scene.input.actionsEmpty")}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {actions.map(action => {
                const enablement = enablements.find(entry => entry.actionId === action.id);
                return (
                    <div key={action.id} className="rounded-md border border-edge bg-surface px-2 py-2">
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg" data-tip={action.name}>
                                {action.name}
                            </div>
                            <div className="shrink-0 truncate text-2xs text-fg-subtle">
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
                            </div>
                            <Switch
                                size="sm"
                                checked={Boolean(enablement)}
                                onCheckedChange={checked =>
                                    data.documentService.setSurfaceActionEnabled(surfaceId, action.id, checked)
                                }
                                aria-label={t("properties.scene.input.answer", { name: action.name })}
                            />
                        </div>
                        {enablement ? (
                            <div className="mt-2 flex items-center gap-2 border-t border-edge-subtle pt-2">
                                <span className="w-20 shrink-0 text-2xs text-fg-muted">
                                    {t("properties.scene.input.bubble")}
                                </span>
                                <Select
                                    size="sm"
                                    fullWidth
                                    value={
                                        (enablement.consume ?? UI_SURFACE_ACTION_DEFAULT_CONSUME) ? "stop" : "continue"
                                    }
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
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
