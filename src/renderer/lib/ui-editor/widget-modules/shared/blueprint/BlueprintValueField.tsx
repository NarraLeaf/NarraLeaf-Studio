import type { ReactNode } from "react";
import { ExternalLink, GitBranch, Pencil } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import type { UIElement, UIElementValueBindingValueType } from "@shared/types/ui-editor/document";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useWorkspace } from "@/apps/workspace/context";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { parseComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { useTranslation } from "@/lib/i18n";

export type BlueprintValueFieldConfig = {
    propPath: string;
    valueType: UIElementValueBindingValueType;
    /** Short technical value/path indicator shown in monospace (not localized). */
    valueLabel: string;
    /** i18n key for the field/editor title, resolved at render. */
    title: TranslationKey;
    /** i18n key for the "create binding" button label; falls back to the generic Blueprint Value label. */
    createLabel?: TranslationKey;
    /** i18n key for the "clear binding" button label; falls back to the generic Literal label. */
    clearLabel?: TranslationKey;
    getDisplayName: (input: { liveElement: UIElement; data: UIInspectorData }) => string;
    getLiteralValue: (input: { liveElement: UIElement; data: UIInspectorData }) => unknown;
    renderLiteralEditor?: (input: {
        data: UIInspectorData;
        liveElement: UIElement;
    }) => ReactNode;
};

export function createBlueprintValueField(config: BlueprintValueFieldConfig) {
    function BlueprintValueField(props: CustomFieldProps<UIInspectorData>) {
        const { t } = useTranslation();
        const { context, isInitialized } = useWorkspace();
        const openBlueprint = useOpenBlueprintTarget();
        const blueprintRevision = useBlueprintDocumentRevision();
        const surfaceId = props.data.surfaceId;
        const isComponentEditorSurface = Boolean(parseComponentEditorSurfaceId(surfaceId));
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
                title: t(config.title),
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
                    <div className="rounded-md border border-edge bg-surface px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <GitBranch className="h-4 w-4 shrink-0 text-binding" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-fg">
                                    {blueprint?.name ?? t("widgetChrome.blueprint.blueprintValue")}
                                </div>
                                <div className="truncate font-mono text-2xs text-fg-subtle">
                                    {config.valueLabel}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-edge bg-fill-subtle text-fg hover:bg-fill disabled:opacity-40"
                                disabled={!surfaceId}
                                onClick={() => openValueBlueprint(binding.blueprintId)}
                                aria-label={t("widgetChrome.blueprint.openBlueprintValue")}
                                title={t("common.open")}
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded border border-edge bg-fill-subtle px-2 py-1 text-xs text-fg hover:bg-fill"
                        onClick={() => props.data.documentService.clearElementBlueprintValueBinding(live.id, config.propPath)}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                        {config.clearLabel ? t(config.clearLabel) : t("widgetChrome.blueprint.literal")}
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-2">
                {config.renderLiteralEditor?.({ data: props.data, liveElement: live }) ?? (
                    <div className="rounded-md border border-edge bg-surface px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <GitBranch className="h-4 w-4 shrink-0 text-fg-subtle" />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-fg">
                                    {t(config.title)}
                                </div>
                                <div className="truncate font-mono text-2xs text-fg-subtle">
                                    {config.valueLabel}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded border border-binding/30 bg-binding/10 px-2 py-1 text-xs text-binding hover:bg-binding/20 disabled:cursor-default disabled:opacity-40"
                    disabled={!surfaceId || isComponentEditorSurface}
                    onClick={createBinding}
                    title={isComponentEditorSurface ? t("widgetChrome.blueprint.componentsUnavailable") : undefined}
                >
                    <GitBranch className="h-3.5 w-3.5" />
                    {config.createLabel ? t(config.createLabel) : t("widgetChrome.blueprint.blueprintValue")}
                </button>
            </div>
        );
    }

    return BlueprintValueField;
}
