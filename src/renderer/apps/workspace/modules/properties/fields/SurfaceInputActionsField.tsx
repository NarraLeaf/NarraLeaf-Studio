import { Select, Switch } from "@/lib/components/elements";
import { InputBindingList } from "@/apps/workspace/modules/ui-editor/input/InputBindingList";
import { useTranslation } from "@/lib/i18n";
import {
    resolveSurfaceActionBindings,
    type UIInputActionDef,
    type UIInputBinding,
    type UISurfaceActionEnablement,
} from "@shared/types/ui-editor/inputAction";
import type { CustomFieldProps } from "../framework/types";
import type { SceneEditorContext } from "../schemas/sceneSchema";

/** Which of the three answers about bindings this enablement is currently giving. */
type BindingMode = "default" | "add" | "replace";

function readBindingMode(enablement: UISurfaceActionEnablement): BindingMode {
    if (enablement.overrideBindings) {
        return "replace";
    }
    return enablement.addBindings?.length ? "add" : "default";
}

/**
 * Which of the project's input actions this interface answers, and how.
 *
 * One row per vocabulary entry, switched off by default: an interface answers nothing until an
 * author says so, which is what keeps "the project names an action" from meaning "every page now
 * reacts to it".
 *
 * The bindings question has three answers rather than a free-for-all, because that is exactly what
 * the record can hold - the project's, the project's plus some, or a set of its own - and a control
 * that let an author edit the project defaults from inside one page would be editing every other
 * page at the same time. The inherited chips are therefore drawn muted and cannot be removed here.
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

    const setBindingMode = (action: UIInputActionDef, enablement: UISurfaceActionEnablement, mode: BindingMode) => {
        if (mode === "default") {
            data.documentService.updateSurfaceActionEnablement(surfaceId, action.id, {
                addBindings: undefined,
                overrideBindings: undefined,
            });
            return;
        }
        if (mode === "add") {
            data.documentService.updateSurfaceActionEnablement(surfaceId, action.id, {
                overrideBindings: undefined,
                addBindings: enablement.addBindings ?? [],
            });
            return;
        }
        // Seeded with what the action currently answers to, so switching to "these instead" keeps
        // the gesture working while the author edits it - rather than blanking it and leaving a
        // page that stops responding for reasons the control never showed.
        data.documentService.updateSurfaceActionEnablement(surfaceId, action.id, {
            addBindings: undefined,
            overrideBindings: enablement.overrideBindings ?? resolveSurfaceActionBindings(action, enablement),
        });
    };

    const setBindings = (action: UIInputActionDef, mode: BindingMode, bindings: UIInputBinding[]) => {
        data.documentService.updateSurfaceActionEnablement(
            surfaceId,
            action.id,
            mode === "replace" ? { overrideBindings: bindings } : { addBindings: bindings },
        );
    };

    return (
        <div className="space-y-2">
            {actions.map(action => {
                const enablement = enablements.find(entry => entry.actionId === action.id);
                const mode = enablement ? readBindingMode(enablement) : "default";
                return (
                    <div key={action.id} className="rounded-md border border-edge bg-surface px-2 py-2">
                        <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1 truncate text-xs font-medium text-fg" data-tip={action.name}>
                                {action.name}
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
                            <div className="mt-2 space-y-2 border-t border-edge-subtle pt-2">
                                <div className="flex items-center gap-2">
                                    <span className="w-20 shrink-0 text-2xs text-fg-muted">
                                        {t("properties.scene.input.bindingMode")}
                                    </span>
                                    <Select
                                        size="sm"
                                        fullWidth
                                        value={mode}
                                        options={[
                                            {
                                                value: "default",
                                                label: t("properties.scene.input.bindingModeDefault"),
                                            },
                                            { value: "add", label: t("properties.scene.input.bindingModeAdd") },
                                            {
                                                value: "replace",
                                                label: t("properties.scene.input.bindingModeReplace"),
                                            },
                                        ]}
                                        ariaLabel={t("properties.scene.input.bindingMode")}
                                        onChange={value => setBindingMode(action, enablement, value as BindingMode)}
                                    />
                                </div>
                                <InputBindingList
                                    bindings={
                                        mode === "replace"
                                            ? enablement.overrideBindings ?? []
                                            : enablement.addBindings ?? []
                                    }
                                    inherited={mode === "replace" ? undefined : action.bindings}
                                    onChange={bindings => setBindings(action, mode, bindings)}
                                />
                                <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 text-2xs text-fg-muted">
                                        {t("properties.scene.input.consume")}
                                    </span>
                                    <Switch
                                        size="sm"
                                        checked={enablement.consume ?? true}
                                        onCheckedChange={checked =>
                                            data.documentService.updateSurfaceActionEnablement(surfaceId, action.id, {
                                                consume: checked,
                                            })
                                        }
                                        aria-label={t("properties.scene.input.consume")}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="w-20 shrink-0 text-2xs text-fg-muted">
                                        {t("properties.scene.input.overControls")}
                                    </span>
                                    <Select
                                        size="sm"
                                        fullWidth
                                        value={enablement.overControls ?? "skip"}
                                        options={[
                                            {
                                                value: "skip",
                                                label: t("properties.scene.input.overControlsSkip"),
                                            },
                                            {
                                                value: "fire",
                                                label: t("properties.scene.input.overControlsFire"),
                                            },
                                        ]}
                                        ariaLabel={t("properties.scene.input.overControls")}
                                        onChange={value =>
                                            data.documentService.updateSurfaceActionEnablement(surfaceId, action.id, {
                                                overControls: value === "fire" ? "fire" : "skip",
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
