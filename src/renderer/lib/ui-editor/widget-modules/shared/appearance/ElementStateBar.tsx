import { Plus, Star, Trash2 } from "lucide-react";
import type { AppearanceModel, AppearanceVariant } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements/Select";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { useEditorEnteredState } from "@/lib/ui-editor/hooks/useEnteredElementState";
import {
    addVariant,
    newVariantId,
    removeVariant,
    renameVariant,
    setDefaultVariantId,
} from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";

const ICON_BUTTON_CLASS =
    "grid h-9 w-9 shrink-0 cursor-default place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:bg-fill disabled:opacity-40";

function liveElement(data: UIInspectorData): UIElement {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function appearanceOf(element: UIElement): AppearanceModel | null {
    const model = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    return isUsableAppearanceModel(model) ? model : null;
}

function cloneVariant(source: AppearanceVariant, id: string, name: string): AppearanceVariant {
    return {
        id,
        name,
        propertyGroups: JSON.parse(JSON.stringify(source.propertyGroups)) as AppearanceVariant["propertyGroups"],
    };
}

/**
 * The states an element can be shown in, at the top of the panel rather than inside its appearance.
 *
 * Which state is being shown is not an appearance property - it decides what every other field in
 * the panel is editing, and what the canvas draws - so it sits above them all. Picking one enters it:
 * the canvas shows the element that way, and so does everything under it, which is what makes a
 * switch's parts move together when the switch turns on.
 */
export function ElementStateBar(props: CustomFieldProps<UIInspectorData>) {
    const { t } = useTranslation();
    const entered = useEditorEnteredState();
    const element = liveElement(props.data);
    const model = appearanceOf(element);
    if (!model) {
        return null;
    }

    const stateService = UIEditorStateService.getInstance();
    const selectedId =
        entered?.elementId === element.id ? entered.variantId ?? model.defaultVariantId : model.defaultVariantId;
    const selected = model.variants.find(variant => variant.id === selectedId) ?? model.variants[0] ?? null;
    const replace = (next: AppearanceModel) => {
        props.data.documentService.updateElementProps(element.id, { appearance: next });
    };
    const enter = (variantId: string) => {
        stateService.setEnteredState({
            elementId: element.id,
            variantId: variantId === model.defaultVariantId ? null : variantId,
        });
    };

    const handleAdd = () => {
        const base = selected ?? model.variants[0];
        if (!base) {
            return;
        }
        const id = newVariantId();
        // English on purpose - the name is written to the document, so translating it would ship one
        // author's UI language to every other author.
        replace(addVariant(model, cloneVariant(base, id, `State ${model.variants.length + 1}`)));
        enter(id);
    };

    const handleRemove = () => {
        if (!selected || model.variants.length <= 1) {
            return;
        }
        const next = removeVariant(model, selected.id);
        replace(next);
        stateService.setEnteredState({ elementId: element.id, variantId: null });
    };

    return (
        <div className="space-y-2 min-w-0">
            <FieldLabel>{t("widgetAppearance.state.label")}</FieldLabel>
            <div className="flex flex-wrap gap-2 items-center min-w-0">
                <div className="flex-1 min-w-[8rem]">
                    <Select
                        value={selected?.id ?? ""}
                        options={model.variants.map(variant => ({
                            value: variant.id,
                            label: variant.name || t("widgetAppearance.state.untitled"),
                        }))}
                        fullWidth
                        // Reading which state an element is in is reading, so a frozen workspace may
                        // still step through them; the buttons beside it are the ones that write.
                        inspectOnly
                        onChange={value => enter(String(value))}
                    />
                </div>
                <button
                    type="button"
                    data-tip={t("widgetAppearance.state.addTitle")}
                    aria-label={t("widgetAppearance.state.addTitle")}
                    onClick={handleAdd}
                    disabled={props.readOnly}
                    className={ICON_BUTTON_CLASS}
                >
                    <Plus className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    data-tip={t("widgetAppearance.state.setDefaultTitle")}
                    aria-label={t("widgetAppearance.state.setDefaultTitle")}
                    onClick={() => selected && replace(setDefaultVariantId(model, selected.id))}
                    disabled={props.readOnly || !selected || model.defaultVariantId === selected.id}
                    className={ICON_BUTTON_CLASS}
                >
                    <Star className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    data-tip={t("widgetAppearance.state.deleteTitle")}
                    aria-label={t("widgetAppearance.state.deleteTitle")}
                    onClick={handleRemove}
                    disabled={props.readOnly || model.variants.length <= 1}
                    className={`${ICON_BUTTON_CLASS} text-danger hover:bg-danger/10`}
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
            {model.variants.length > 1 && selected ? (
                <EnhancedInput
                    key={selected.id}
                    value={selected.name ?? ""}
                    onChange={raw => replace(renameVariant(model, selected.id, raw))}
                    className="text-xs"
                />
            ) : null}
        </div>
    );
}
