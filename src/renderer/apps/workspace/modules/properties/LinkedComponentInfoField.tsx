import { useMemo } from "react";
import { Component, LocateFixed, PanelsTopLeft } from "lucide-react";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { useTranslation } from "@/lib/i18n";
import { Button, FieldLabel } from "@/lib/components/elements";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { UIInspectorData } from "../ui-editor/inspector/registry";
import { createComponentEditorTab } from "../ui-editor/UISurfacesPanel";
import { requestComponentLibraryReveal } from "../ui-editor/panel/componentLibraryReveal";
import { UI_SURFACES_PANEL_ID } from "../ui-editor/input/inputActionPanelFocus";
import { useReadOnlyInspection } from "../../components/ui/readOnlyInspection";
import { useWorkspace } from "../../context";

/**
 * The card at the top of a linked instance's inspector: which component this is, and where it lives.
 *
 * An instance's own name ("Save slot 1") and its component's name ("Save slot") are usually one
 * word apart, so a bare name on this card read as the element's - and the only way from here to the
 * definition was a button on the canvas toolbar. The card now says what the name is, and offers the
 * two ways to the component, split by how far each one takes the author:
 *
 *  - **Show in Component Library** is the answer to "where is this linked to". It brings the rail
 *    forward and marks the component's card, changing nothing else - the canvas, the tab and the
 *    selection all stay where they are, so it is safe to press just to look.
 *  - **Open component** is the decision to edit the definition. It opens the component's own editor
 *    tab, the same one the library card and the canvas toolbar open, and moves the work there.
 *
 * Neither is offered while the inspector is reading a past version: both act on the live project,
 * whose component may not be the one that version linked to.
 */
export function LinkedComponentInfoField({ data }: { data: UIInspectorData }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const inspecting = useReadOnlyInspection();
    const uiService = useMemo<UIService | null>(
        () => (context ? context.services.get<UIService>(Services.UI) : null),
        [context],
    );
    const link = getUIComponentLink(data.element);
    if (!link) {
        return null;
    }
    const component = data.documentService.getComponent(link.componentId);

    const reveal = () => {
        if (!component) {
            return;
        }
        // The rail may be closed or showing another panel; the library takes a request made before
        // it has mounted (see `componentLibraryReveal`).
        uiService?.panels.show(UI_SURFACES_PANEL_ID);
        requestComponentLibraryReveal(component.id);
    };

    const open = () => {
        if (!component || !uiService) {
            return;
        }
        const tab = createComponentEditorTab(component);
        uiService.getStore().openEditorTabInGroup(tab);
        uiService.focus.setFocus(FocusArea.Editor, tab.id);
    };

    return (
        <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-fg">
            <FieldLabel as="div">{t("properties.layout.linkedComponent")}</FieldLabel>
            <div className="flex min-w-0 items-center gap-1.5 font-medium">
                <Component className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 truncate" data-tip={component?.name}>
                    {component?.name ?? t("properties.linkedComponent.missing")}
                </span>
            </div>
            <div className="mt-1 text-2xs leading-snug text-fg-muted">
                {t("properties.linkedComponent.info")}
            </div>
            {component && !inspecting ? (
                <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" onClick={reveal}>
                        <LocateFixed className="h-3.5 w-3.5" aria-hidden />
                        {t("properties.linkedComponent.reveal")}
                    </Button>
                    <Button size="sm" onClick={open}>
                        <PanelsTopLeft className="h-3.5 w-3.5" aria-hidden />
                        {t("uiEditor.editor.openComponent")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
