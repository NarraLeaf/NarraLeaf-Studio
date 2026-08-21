import type { ReactNode } from "react";
import { ExternalLink, GitBranch, Pencil } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import type { UIElement, UIElementValueBindingValueType } from "@shared/types/ui-editor/document";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useWorkspace } from "@/apps/workspace/context";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { blueprintEntryContextMenu } from "@/apps/workspace/modules/blueprint-lite/hooks/blueprintEntryGesture";
import { useOpenBlueprintTarget, type BlueprintOpenOptions } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { parseComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { InspectOnlyButton } from "@/lib/components/elements/InspectOnlyButton";
import { Select } from "@/lib/components/elements/Select";
import { findOwningListItemTemplate } from "@shared/types/ui-editor/listItemContext";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { uiStructFieldLabel, type UIStructFieldType } from "@shared/types/ui-editor/struct";
import { useTranslation } from "@/lib/i18n";

/**
 * The field types that can answer one bound prop.
 *
 * A binding writes the field's value into a prop of a declared type, so the pairing has to be
 * decidable: a picture cannot be a slider's position and a number is not a picture. Anything can be
 * read as text, which is why `string` accepts the lot - a number shown in a label is the ordinary
 * case, not a mistake.
 */
const FIELD_TYPES_FOR_VALUE_TYPE: Record<UIElementValueBindingValueType, readonly UIStructFieldType[]> = {
    string: ["string", "number", "boolean", "image", "color"],
    float: ["number", "string"],
    boolean: ["boolean", "number", "string"],
    json: ["json"],
};

/**
 * The row that binds a prop to the item field of the list drawing it.
 *
 * Sits above the blueprint control rather than beside it because the two write the same slot:
 * `valueBindings[propPath]` holds one binding, so picking a field is also what clears a blueprint
 * binding, and showing them as two independent controls would invite an author to set both.
 */
function ListItemFieldBindingRow(props: {
    data: UIInspectorData;
    liveElement: UIElement;
    propPath: string;
    valueType: UIElementValueBindingValueType;
    /** Names what the field decides. Defaults to the value the prop holds. */
    labelKey?: TranslationKey;
}): ReactNode {
    const { t } = useTranslation();
    const { data, liveElement, propPath, valueType } = props;
    const label = t(props.labelKey ?? "struct.field.picker");
    const document = data.documentService.getDocument();
    const context = findOwningListItemTemplate(document, liveElement);
    if (!context) {
        return null;
    }
    const struct = resolveUIStruct(document, context.structId);
    const accepted = FIELD_TYPES_FOR_VALUE_TYPE[valueType] ?? [];
    const options = [
        { value: "", label: t("struct.field.pickerEmpty") },
        ...(struct?.fields ?? [])
            .filter(field => accepted.includes(field.type))
            .map(field => ({ value: field.id, label: uiStructFieldLabel(field) })),
    ];
    const binding = liveElement.valueBindings?.[propPath];
    const current = binding?.kind === "listItemField" ? binding.fieldId : "";

    return (
        <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-fg-muted">{label}</span>
            <Select
                size="sm"
                className="min-w-0 flex-1"
                value={current}
                options={options}
                portalMenu
                fullWidth
                ariaLabel={label}
                onChange={value =>
                    data.documentService.setElementListItemFieldBinding(
                        liveElement.id,
                        propPath,
                        String(value) || null,
                    )
                }
            />
        </div>
    );
}

/**
 * The field picker on its own, for a prop with no blueprint-value control beside it.
 *
 * An image is the case that needs it: its picture is bound per row like any other prop, but its
 * literal editor is a picker, not a blueprint.
 */
export function createListItemFieldBindingField(config: {
    propPath: string;
    valueType: UIElementValueBindingValueType;
    labelKey?: TranslationKey;
}) {
    return function ListItemFieldBindingField(props: CustomFieldProps<UIInspectorData>): ReactNode {
        const live =
            props.data.documentService.getDocument().elements[props.data.element.id] ?? props.data.element;
        return (
            <ListItemFieldBindingRow
                data={props.data}
                liveElement={live}
                propPath={config.propPath}
                valueType={config.valueType}
                labelKey={config.labelKey}
            />
        );
    };
}

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
        const storedBinding = live.valueBindings?.[config.propPath];
        // This control speaks for the blueprint binding only. A prop bound to a list item field is
        // bound by a different control, and reading its field id as a blueprint id would have this
        // one report a blueprint that does not exist.
        const binding = storedBinding?.kind === "blueprintValue" ? storedBinding : undefined;
        const localBp =
            isInitialized && context
                ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint)
                : null;
        const blueprint =
            binding && localBp
                ? localBp.getBlueprintDocument().blueprints[binding.blueprintId]
                : undefined;
        void blueprintRevision;

        const openValueBlueprint = (blueprintId: string, options?: BlueprintOpenOptions) => {
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
            }, options);
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

        const fieldRow = (
            <ListItemFieldBindingRow
                data={props.data}
                liveElement={live}
                propPath={config.propPath}
                valueType={config.valueType}
            />
        );

        if (storedBinding?.kind === "listItemField") {
            // The prop is answered by the row's own data, so the literal editor below would be
            // showing a value nothing reads. The picker alone is the whole control here.
            return <div className="space-y-2">{fieldRow}</div>;
        }

        if (binding) {
            return (
                <div className="space-y-2">
                    {fieldRow}
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
                            {/* Opening the bound blueprint is reading: it leads into another editor,
                                which enforces the freeze on its own account, and writes nothing on
                                the way. An inspector field is clamped by a `disabled` `<fieldset>`
                                while the workspace is frozen, so as a `<button>` this was dead -
                                the author could see a value was bound to a blueprint and had no way
                                to go and look at it. An `InspectOnlyButton` is not a form control
                                and so survives the clamp. The clear and create buttons below stay
                                `<button>`s deliberately: those two do write. */}
                            <InspectOnlyButton
                                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge bg-fill-subtle text-fg hover:bg-fill cursor-default${surfaceId ? "" : " opacity-40"}`}
                                disabled={!surfaceId}
                                onClick={() => openValueBlueprint(binding.blueprintId)}
                                onContextMenu={blueprintEntryContextMenu(
                                    options => openValueBlueprint(binding.blueprintId, options),
                                )}
                                aria-label={t("widgetChrome.blueprint.openBlueprintValue")}
                                data-tip={t("blueprint.entry.openInWindow")}
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </InspectOnlyButton>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-fill-subtle px-2 py-1 text-xs text-fg hover:bg-fill"
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
                {fieldRow}
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
                    className="inline-flex items-center gap-1.5 rounded-md border border-binding/30 bg-binding/10 px-2 py-1 text-xs text-binding hover:bg-binding/20 disabled:cursor-default disabled:opacity-40"
                    disabled={!surfaceId || isComponentEditorSurface}
                    onClick={createBinding}
                    data-tip={isComponentEditorSurface ? t("widgetChrome.blueprint.componentsUnavailable") : undefined}
                >
                    <GitBranch className="h-3.5 w-3.5" />
                    {config.createLabel ? t(config.createLabel) : t("widgetChrome.blueprint.blueprintValue")}
                </button>
            </div>
        );
    }

    return BlueprintValueField;
}
