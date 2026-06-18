import type { ReactNode } from "react";
import { ExternalLink, GitBranch, Pencil } from "lucide-react";
import type { UIElement, UIElementValueBindingValueType } from "@shared/types/ui-editor/document";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useWorkspace } from "@/apps/workspace/context";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";

export type BlueprintValueFieldConfig = {
    propPath: string;
    valueType: UIElementValueBindingValueType;
    valueLabel: string;
    title: string;
    createLabel?: string;
    clearLabel?: string;
    getDisplayName: (input: { liveElement: UIElement; data: UIInspectorData }) => string;
    getLiteralValue: (input: { liveElement: UIElement; data: UIInspectorData }) => unknown;
    renderLiteralEditor?: (input: {
        data: UIInspectorData;
        liveElement: UIElement;
    }) => ReactNode;
};

export function createBlueprintValueField(config: BlueprintValueFieldConfig) {
    function BlueprintValueField(props: CustomFieldProps<UIInspectorData>) {
        const { context, isInitialized } = useWorkspace();
        const openBlueprint = useOpenBlueprintTarget();
        const blueprintRevision = useBlueprintDocumentRevision();
        const surfaceId = props.data.surfaceId;
        const live =
            props.data.documentService.getDocument().elements[props.data.element.id] ??
            props.data.element;
        const binding = live.valueBindings?.[config.propPath];
        const localBp =
            isInitialized && context
                ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint)
                : null;
        const blueprint =
            binding && localBp
                ? localBp.getBlueprintDocument().blueprints[binding.blueprintId]
                : undefined;
        void blueprintRevision;

        const openValueBlueprint = (blueprintId: string) => {
            if (!surfaceId) {
                return;
            }
            openBlueprint({
                blueprintId,
                ownerKind: "widgetValue",
                surfaceId,
                elementId: live.id,
                propPath: config.propPath,
                focusEventId: "init",
                title: config.title,
            });
        };

        const createBinding = () => {
            if (!surfaceId) {
                return;
            }
            const { blueprintId } = props.data.documentService.ensureElementBlueprintValueBinding(
                live.id,
                config.propPath,
                {
                    valueType: config.valueType,
                    displayName: config.getDisplayName({ liveElement: live, data: props.data }),
                    literalValue: config.getLiteralValue({ liveElement: live, data: props.data }),
                },
            );
            openValueBlueprint(blueprintId);
        };

        if (binding) {
            return (
                <div className="space-y-2">
                    <div className="rounded-md border border-white/10 bg-[#111315] px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <GitBranch className="h-4 w-4 shrink-0 text-cyan-300" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-gray-100">
                                    {blueprint?.name ?? "Blueprint Value"}
                                </div>
                                <div className="truncate font-mono text-[10px] text-gray-500">
                                    {config.valueLabel}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40"
                                disabled={!surfaceId}
                                onClick={() => openValueBlueprint(binding.blueprintId)}
                                aria-label="Open Blueprint Value"
                                title="Open"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-200 hover:bg-white/10"
                        onClick={() => props.data.documentService.clearElementBlueprintValueBinding(live.id, config.propPath)}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                        {config.clearLabel ?? "Literal"}
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-2">
                {config.renderLiteralEditor?.({ data: props.data, liveElement: live }) ?? (
                    <div className="rounded-md border border-white/10 bg-[#111315] px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <GitBranch className="h-4 w-4 shrink-0 text-gray-500" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-gray-200">
                                    {config.title}
                                </div>
                                <div className="truncate font-mono text-[10px] text-gray-500">
                                    {config.valueLabel}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-default disabled:opacity-40"
                    disabled={!surfaceId}
                    onClick={createBinding}
                >
                    <GitBranch className="h-3.5 w-3.5" />
                    {config.createLabel ?? "Blueprint Value"}
                </button>
            </div>
        );
    }

    return BlueprintValueField;
}
