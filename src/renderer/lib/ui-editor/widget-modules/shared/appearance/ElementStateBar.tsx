import { Plus, Star, Trash2 } from "lucide-react";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements/Select";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { useEditorEnteredState } from "@/lib/ui-editor/hooks/useEnteredElementState";
import { removeVariant, renameVariant, setDefaultVariantId } from "./appearancePatch";
import { addElementState } from "./elementStates";
import { isUsableAppearanceModel } from "./initialAppearanceModel";
import { findStateHost, ownDeclaredStates } from "./stateHost";

const ICON_BUTTON_CLASS =
    "grid h-9 w-9 shrink-0 cursor-default place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted hover:bg-fill disabled:opacity-40";

function liveElement(data: UIInspectorData): UIElement {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

function appearanceOf(element: UIElement): AppearanceModel | null {
    const model = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    return isUsableAppearanceModel(model) ? model : null;
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
    const stateService = UIEditorStateService.getInstance();
    const surfaceId = props.data.surfaceId ?? "";

    /** One picker, whatever element the states belong to. */
    const statePicker = (ownerId: string, states: { id: string | null; name: string }[]) => (
        <div className="space-y-2 min-w-0">
            <FieldLabel>{t("widgetAppearance.state.label")}</FieldLabel>
            <Select
                value={(entered?.elementId === ownerId ? entered.variantId : null) ?? ""}
                options={states.map(state => ({ value: state.id ?? "", label: state.name }))}
                fullWidth
                inspectOnly
                onChange={value => {
                    const next = String(value);
                    stateService.setEnteredState({
                        surfaceId,
                        elementId: ownerId,
                        variantId: next === "" ? null : next,
                    });
                }}
            />
        </div>
    );

    // A widget's own states outrank an appearance model's variants: they are what the widget does,
    // and the variants are only how its parts look while it does it.
    const declared = ownDeclaredStates(element);
    if (declared && declared.length > 1) {
        return statePicker(element.id, declared);
    }
    // A part is shown in its host's states, not in states of its own. Listing the variants here would
    // offer the author a second, private set of states to keep in step with the widget's - which is
    // the matrix this model exists to avoid - and picking one would leave the rest of the widget
    // behind, because only the host knows how to draw itself in it.
    const host = findStateHost(props.data.documentService.getDocument(), element.id);
    if (host && host.states.length > 1) {
        return statePicker(host.element.id, host.states);
    }
    const model = appearanceOf(element);
    const enteredHere = entered?.elementId === element.id;
    // A single state is not a choice, and this bar sits at the top of every element's panel: it stays
    // out until there is something to pick between. `Add state` lives in the element's context menu,
    // which is where an element with one state gets its second.
    if (!model || (model.variants.length <= 1 && !enteredHere)) {
        return null;
    }

    const selectedId = enteredHere ? entered.variantId ?? model.defaultVariantId : model.defaultVariantId;
    const selected = model.variants.find(variant => variant.id === selectedId) ?? model.variants[0] ?? null;
    const replace = (next: AppearanceModel) => {
        props.data.documentService.updateElementProps(element.id, { appearance: next });
    };
    const enter = (variantId: string) => {
        stateService.setEnteredState({
            surfaceId,
            elementId: element.id,
            variantId: variantId === model.defaultVariantId ? null : variantId,
        });
    };

    const handleAdd = () => {
        addElementState(props.data.documentService, surfaceId, element.id, selected?.id ?? null);
    };

    const handleRemove = () => {
        if (!selected || model.variants.length <= 1) {
            return;
        }
        const next = removeVariant(model, selected.id);
        replace(next);
        stateService.setEnteredState({ surfaceId, elementId: element.id, variantId: null });
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
