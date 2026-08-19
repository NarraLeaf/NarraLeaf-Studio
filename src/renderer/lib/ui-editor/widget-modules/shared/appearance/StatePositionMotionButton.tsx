import type { AppearanceFieldTransition, AppearanceModel, AppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { translate } from "@/lib/i18n";
import { AppearanceFieldMotionButton } from "./compact/AppearanceMotionControls";
import { AppearanceReadOnlyProvider } from "./appearanceReadOnly";
import { setGroupTransitionOnAllVariants } from "./appearancePatch";
import { isUsableAppearanceModel } from "./initialAppearanceModel";

/**
 * How this element travels between the states it is shown in, next to the position it travels to.
 *
 * Same control the appearance panel puts beside every animatable field, moved to where the position
 * is actually edited. It writes both axes at once: X and Y are one thing to the author, and giving a
 * diagonal move two different durations is a setting nobody wants and everybody would hit by
 * accident.
 *
 * The transition is written to every variant, which is what makes the way back move too - on the
 * `on` variant alone the part would slide out and snap home.
 */
export function StatePositionMotionButton({
    element,
    documentService,
    shownVariantId,
    readOnly,
    draftResetKey,
}: {
    element: UIElement;
    documentService: UIDocumentService;
    shownVariantId: string;
    readOnly: boolean;
    draftResetKey: string;
}) {
    const model = (element.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
    if (!isUsableAppearanceModel(model)) {
        return null;
    }
    const variant = model.variants.find(item => item.id === shownVariantId) ?? model.variants[0];
    if (!variant) {
        return null;
    }
    const setFieldTransition = (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => {
        const live = documentService.getDocument().elements[element.id] ?? element;
        const liveModel = (live.props as { appearance?: AppearanceModel | null } | undefined)?.appearance;
        if (!isUsableAppearanceModel(liveModel)) {
            return;
        }
        documentService.updateElementProps(live.id, {
            ...(live.props ?? {}),
            appearance: setGroupTransitionOnAllVariants(liveModel, groupKey, transition),
        });
    };

    return (
        // The popover this opens is portalled out of the panel, so the clamp around the field cannot
        // reach it; this is the flag it reads instead.
        <AppearanceReadOnlyProvider value={readOnly}>
            <AppearanceFieldMotionButton
                variant={variant}
                setFieldTransition={setFieldTransition}
                groupKey="transformOffsetX"
                groupKeys={["transformOffsetX", "transformOffsetY"]}
                label={translate("properties.layout.position")}
                draftResetKey={draftResetKey}
            />
        </AppearanceReadOnlyProvider>
    );
}
