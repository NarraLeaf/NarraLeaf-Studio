import type { UIDocument } from "@shared/types/ui-editor/document";
import type { ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { readUIComponentEditorSurfaceComponentId } from "@shared/types/ui-editor/componentInstanceKey";
import { translate } from "@/lib/i18n";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import {
    resolveComponentRootPromotionRefusal,
    type ComponentRootPromotionRefusal,
} from "@/lib/workspace/services/ui-editor/componentRootSwap";

/**
 * The menu row that changes a component's root, for the one element a menu was opened on.
 *
 * Set as Root Element on an element directly inside the root, greyed with the reason when it cannot
 * be the root; Wrap in Container on the root itself. Only in a component's own editor, and only for a
 * single element; null everywhere else, and the row is left out.
 */
export type ComponentRootSwapMenuEntry =
    | { kind: "promote"; blockedReason: string | null; run: () => void }
    | { kind: "wrap"; run: () => void };

function describeRefusal(refusal: ComponentRootPromotionRefusal | null): string | null {
    switch (refusal) {
        case "rootNotContainer":
            return translate("uiEditor.contextMenu.setAsRootNotContainer");
        case "notAlone":
            return translate("uiEditor.contextMenu.setAsRootNotAlone");
        case "rootNotFree":
            return translate("uiEditor.contextMenu.setAsRootNotFree");
        default:
            return null;
    }
}

export function resolveComponentRootSwapMenuEntry(input: {
    document: UIDocument;
    surfaceId: string;
    menuSelection: UIElementSelection | null;
    documentService: UIDocumentService;
    stateService: UIEditorStateService;
}): ComponentRootSwapMenuEntry | null {
    const { document, surfaceId, menuSelection, documentService, stateService } = input;
    const componentId = readUIComponentEditorSurfaceComponentId(surfaceId);
    if (!componentId || menuSelection?.elementIds.length !== 1) {
        return null;
    }
    const element = document.elements[menuSelection.elementIds[0]];
    if (!element) {
        return null;
    }
    if (isComponentEditorRootElement(element)) {
        return {
            kind: "wrap",
            run: () => {
                const wrapperId = documentService.wrapComponentRoot(componentId);
                if (wrapperId) {
                    stateService.setUIElementSelection({ editor: "ui", surfaceId, elementIds: [wrapperId], primaryId: wrapperId });
                }
            },
        };
    }
    const root = element.parentId ? document.elements[element.parentId] : undefined;
    if (!root || !isComponentEditorRootElement(root)) {
        return null;
    }
    return {
        kind: "promote",
        blockedReason: describeRefusal(resolveComponentRootPromotionRefusal(document.elements, root.id, element.id)),
        run: () => {
            documentService.promoteComponentElementToRoot(componentId, element.id);
        },
    };
}

/** The row for {@link ComponentRootSwapMenuEntry}, or none. */
export function componentRootSwapMenuItem(
    entry: ComponentRootSwapMenuEntry | null | undefined,
    hideMenu: () => void,
): ContextMenuItemDef[] {
    if (!entry) {
        return [];
    }
    if (entry.kind === "wrap") {
        return [{
            id: "wrap-root",
            label: translate("uiEditor.contextMenu.wrapRootInContainer"),
            onClick: () => {
                hideMenu();
                entry.run();
            },
        }];
    }
    return [{
        id: "set-as-root",
        label: translate("uiEditor.contextMenu.setAsRoot"),
        disabled: entry.blockedReason != null,
        tooltip: entry.blockedReason ?? undefined,
        onClick: () => {
            hideMenu();
            entry.run();
        },
    }];
}
