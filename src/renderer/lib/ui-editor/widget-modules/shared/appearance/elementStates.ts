import type { AppearanceModel, AppearanceVariant } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { addVariant, newVariantId } from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";

type StateWriter = {
    getDocument(): { elements: Record<string, UIElement> };
    updateElementProps(elementId: string, props: Record<string, unknown>): void;
};

export function elementAppearanceModel(element: UIElement): AppearanceModel | null {
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
 * Adds a state to an element and enters it, so the author lands in the thing they just made.
 *
 * Shared by the state bar's own button and the context menu, which is the only way in for an element
 * that still has a single state: one state is not a choice, so the bar stays out of the panel until
 * there is something to choose between.
 */
export function addElementState(
    writer: StateWriter,
    surfaceId: string,
    elementId: string,
    basedOnVariantId?: string | null,
): string | null {
    const element = writer.getDocument().elements[elementId];
    const model = element ? elementAppearanceModel(element) : null;
    if (!element || !model) {
        return null;
    }
    const base = model.variants.find(variant => variant.id === basedOnVariantId)
        ?? model.variants.find(variant => variant.id === model.defaultVariantId)
        ?? model.variants[0];
    if (!base) {
        return null;
    }
    const id = newVariantId();
    // English on purpose - the name is written to the document, so translating it would ship one
    // author's UI language to every other author.
    const next = addVariant(model, cloneVariant(base, id, `State ${model.variants.length + 1}`));
    writer.updateElementProps(elementId, { ...(element.props ?? {}), appearance: next });
    UIEditorStateService.getInstance().setEnteredState({ surfaceId, elementId, variantId: id });
    return id;
}

/** Whether this element has a state to add one to; a widget declaring its own states does not. */
export function canAddElementState(element: UIElement | undefined): boolean {
    return Boolean(element && elementAppearanceModel(element));
}
