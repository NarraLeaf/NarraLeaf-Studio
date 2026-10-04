import { CircleAlert } from "lucide-react";
import type { UIElement } from "@shared/types/ui-editor/document";
import { readUITextSite, type UITextSite } from "@shared/types/ui-editor/textSource";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { Button } from "@/lib/components/elements/Button";
import { useTranslation } from "@/lib/i18n";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { getStageSlotLabel } from "@/lib/ui-editor/stageSlotLabel";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import {
    BlueprintValueBoundCard,
    useBlueprintValueBinding,
    type BlueprintValueFieldConfig,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import type { MarkedLabelProps } from "./markedLabel";
import { TextRunMarksEditor } from "./TextRunMarks";

/** What a sample site's field needs to know about the widget. */
export type SampleTextFieldConfig = {
    /** A `sample` site (`textSites.ts`), which names the slot whose game draws the story's words. */
    site: UITextSite;
    /** How the sample words and their marks are read and written. */
    label: MarkedLabelProps;
    /**
     * The widget's Blueprint Value description, used only to show and open a binding the element
     * already carries. Nothing here creates one.
     */
    blueprint: BlueprintValueFieldConfig;
};

function liveElementOf(data: UIInspectorData): UIElement {
    return data.documentService.getDocument().elements[data.element.id] ?? data.element;
}

/** Whether the page being edited is the slot whose game draws the story's words in this site's place. */
function isInStorySlot(data: UIInspectorData, site: UITextSite): boolean {
    if (!site.storySlot || !data.surfaceId) {
        return false;
    }
    const surface = data.documentService.getDocument().surfaces.find(candidate => candidate.id === data.surfaceId);
    return surface?.kind === "stageSurface" && surface.mount.slotId === site.storySlot;
}

/**
 * The words of a dialogue line or an NVL line: sample words, and nothing else.
 *
 * In their slot the game draws the story's current line in the element's place, so neither its own
 * words nor a binding reach a player there; the words are what the canvas shows while the page is
 * laid out. There is no source to choose, so none is offered.
 *
 * A binding the element already carries - made before this field offered none, or written by a tool -
 * is shown rather than hidden: in the story slot it is stated to have no effect and can be removed;
 * on any other page it does draw the words there, so it is shown as bound and can still be opened.
 * Removing a value blueprint is one step of the page's undo history, as clearing one always was.
 */
export function createSampleTextField(config: SampleTextFieldConfig) {
    const { site } = config;
    const propPath = site.textProp;

    return function SampleTextField(props: CustomFieldProps<UIInspectorData>) {
        const { t } = useTranslation();
        const { data } = props;
        const readOnly = props.readOnly === true || props.disabled === true;
        useUIDocumentRevision(data.documentService);
        const blueprintState = useBlueprintValueBinding(config.blueprint, data);
        const live = liveElementOf(data);
        const binding = readUITextSite(live, site).binding;
        const inSlot = isInStorySlot(data, site);

        const remove = () => {
            if (binding?.kind === "blueprintValue") {
                data.documentService.clearElementBlueprintValueBinding(live.id, propPath);
            } else if (binding?.kind === "listItemField") {
                data.documentService.setElementListItemFieldBinding(live.id, propPath, null);
            } else if (binding?.kind === "componentParam") {
                data.documentService.setElementComponentParamBinding(live.id, propPath, null);
            }
        };

        return (
            <div className="space-y-2">
                <TextRunMarksEditor
                    documentService={data.documentService}
                    element={live}
                    label={config.label}
                    readOnly={readOnly}
                />
                <p className="text-xs text-fg-subtle">{t("widgets.sampleText.hint")}</p>
                {binding && inSlot ? (
                    <div className="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2">
                        <CircleAlert className="h-4 w-4 shrink-0 text-warning" />
                        <span className="min-w-0 flex-1 text-xs text-fg-muted">
                            {t("widgets.sampleText.bindingNoEffect", {
                                slot: getStageSlotLabel(site.storySlot ?? "", t),
                            })}
                        </span>
                        <Button size="sm" disabled={readOnly} onClick={remove}>
                            {t("widgets.sampleText.removeBinding")}
                        </Button>
                    </div>
                ) : null}
                {binding && !inSlot ? (
                    <div className="space-y-2">
                        {binding.kind === "blueprintValue" ? (
                            <BlueprintValueBoundCard state={blueprintState} valueLabel={config.blueprint.valueLabel} />
                        ) : null}
                        <Button size="sm" disabled={readOnly} onClick={remove}>
                            {t("widgets.sampleText.removeBinding")}
                        </Button>
                    </div>
                ) : null}
            </div>
        );
    };
}
