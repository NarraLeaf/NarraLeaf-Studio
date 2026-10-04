import { useEffect } from "react";
import type { TranslationKey } from "@shared/i18n";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UITextMigrationChange, UITextMigrationChangeKind } from "@shared/types/ui-editor/textSourceMigration";
import { translate, translateN } from "@/lib/i18n";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { useWorkspace } from "../context";
import { useRegistry } from "../registry";
import { createComponentEditorTab, createSurfaceEditorTab } from "../modules/ui-editor/UISurfacesPanel";

/**
 * Tell the author, once, what opening a project written before v13 changed that they can see.
 *
 * The step (`textSourceMigration.ts`) keeps every widget's words in every language; most of what it
 * does is invisible convergence and is not mentioned. What is listed are the widgets whose source of
 * words changed in a way the inspector shows - a key given up for the widget's own words, a binding
 * that never showed removed - each with the place it is and a button that opens it with the widget
 * selected. Sticky, and the buttons leave it open, so every place can be visited.
 */

/** Locate buttons on the notice; places past this many are still listed in its text. */
const LOCATE_BUTTONS_SHOWN = 12;

const CHANGE_KEYS: Readonly<Record<UITextMigrationChangeKind, TranslationKey>> = {
    marksKept: "workspace.textSourceMigration.marksKept",
    bindingDropped: "workspace.textSourceMigration.bindingDropped",
    missingKey: "workspace.textSourceMigration.missingKey",
    keyDiffered: "workspace.textSourceMigration.keyDiffered",
};

/** One listed change: where it is, in the author's words, and what happened there. */
export type TextSourceMigrationPlace = {
    change: UITextMigrationChange;
    line: string;
};

/** What a widget is called in the list: its name, or its kind when the author never named it. */
function widgetName(element: UIElement | undefined, change: UITextMigrationChange): string {
    const name = element?.name?.trim();
    if (name) {
        return name;
    }
    const type = element?.type;
    return (type && widgetModuleRegistry.get(type)?.displayName) || type || change.prop;
}

/** The changes as lines, numbered in the order they are listed. Never shows an id. */
export function describeTextSourceMigrationChanges(
    changes: readonly UITextMigrationChange[],
    document: UIDocument,
): TextSourceMigrationPlace[] {
    return changes.map((change, index) => {
        const component = change.componentId
            ? (document.components ?? []).find(candidate => candidate.id === change.componentId)
            : undefined;
        const surface = change.surfaceId ? document.surfaces.find(candidate => candidate.id === change.surfaceId) : undefined;
        const element = component ? component.elements[change.elementId] : document.elements[change.elementId];
        return {
            change,
            line: translate("workspace.textSourceMigration.place", {
                n: index + 1,
                owner: component?.name ?? surface?.name ?? "",
                element: widgetName(element, change),
                change: translate(CHANGE_KEYS[change.kind], { key: change.keyName }),
            }),
        };
    });
}

/**
 * Module-level, for the reason `useRecoveryOffer` gives: the notice is once per window, and a remount
 * must not raise it again. The service hands its changes over once anyway; this keeps a second mount
 * from asking.
 */
let told = false;

export function useTextSourceMigrationNotice(): void {
    const { context, recovery } = useWorkspace();
    const { openEditorTab } = useRegistry();

    useEffect(() => {
        if (!context || recovery || told) {
            return;
        }
        let documentService: UIDocumentService;
        let ui: UIService;
        try {
            documentService = context.services.get<UIDocumentService>(Services.UIDocument);
            ui = context.services.get<UIService>(Services.UI);
        } catch {
            return;
        }
        const changes = documentService.takeTextSourceMigrationChanges();
        if (changes.length === 0) {
            return;
        }
        told = true;
        const places = describeTextSourceMigrationChanges(changes, documentService.getDocument());

        const locate = (change: UITextMigrationChange): void => {
            const document = documentService.getDocument();
            const component = change.componentId ? documentService.getComponent(change.componentId) : undefined;
            const surface = change.surfaceId ? document.surfaces.find(candidate => candidate.id === change.surfaceId) : undefined;
            const selectionSurfaceId = component ? buildUIComponentEditorSurfaceId(component.id) : surface?.id;
            if (!selectionSurfaceId) {
                return;
            }
            // Selected before the tab opens, so the tab finds its own selection waiting rather than
            // claiming the page for itself.
            try {
                context.services.get<UIEditorStateService>(Services.UIEditorState).setUIElementSelection({
                    editor: "ui",
                    surfaceId: selectionSurfaceId,
                    elementIds: [change.elementId],
                    primaryId: change.elementId,
                });
            } catch {
                // Opening the page is still worth doing without the selection.
            }
            if (component) {
                openEditorTab(createComponentEditorTab(component));
            } else if (surface) {
                openEditorTab(createSurfaceEditorTab(surface));
            }
        };

        ui.notifications.showSticky({
            type: NotificationType.Info,
            message: translateN("workspace.textSourceMigration.message", changes.length),
            detail: places.map(place => place.line).join("\n"),
            actions: places.slice(0, LOCATE_BUTTONS_SHOWN).map((place, index) => ({
                label: translate("workspace.textSourceMigration.locate", { n: index + 1 }),
                keepOpen: true,
                onClick: () => locate(place.change),
            })),
        });
    }, [context, recovery, openEditorTab]);
}
