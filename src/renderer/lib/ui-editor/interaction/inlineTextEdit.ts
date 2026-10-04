import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { findOwningListItemTemplate } from "@shared/types/ui-editor/listItemContext";
import { findUIStructField, uiStructFieldLabel } from "@shared/types/ui-editor/struct";
import { readUITextSite, uiTextSiteOf } from "@shared/types/ui-editor/textSource";
import { translate } from "@/lib/i18n";
import { designTimeKeyOf } from "@/lib/ui-editor/runtime/localization/designTimeKeys";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { Services } from "@/lib/workspace/services/services";
import { debugUIDoubleClick } from "./doubleClickDebug";

export type InlineTextEditHost = {
    stateService: UIEditorStateService;
    documentService: UIDocumentService;
};

/** Whether a double-click on the canvas types this element's words in place (`textSites.ts`). */
export function isInlineTextEditableElement(element: UIElement | null | undefined): element is UIElement {
    return uiTextSiteOf(element?.type)?.typedOnCanvas === true;
}

/** Where the words of an element typed on the canvas come from, when it is not the element itself. */
export type BoundTextSource =
    | { kind: "listItemField"; fieldId: string }
    | { kind: "blueprintValue"; blueprintId: string };

/**
 * The binding that answers an element's words on the canvas, or null when typing over them would
 * change what they say.
 *
 * A key the canvas draws wins over everything the element carries, as it does in the game, and
 * typing over a keyed element writes the key - so a keyed element is typed on whatever else it
 * carries. Otherwise a list row's field or a value blueprint decides the words, and words typed onto
 * the element would land under the binding where nothing shows them.
 */
export function boundTextSourceOf(element: UIElement | null | undefined): BoundTextSource | null {
    const site = uiTextSiteOf(element?.type);
    if (!element || !site?.typedOnCanvas) {
        return null;
    }
    const reading = readUITextSite(element, site);
    if (designTimeKeyOf(reading.key)) {
        return null;
    }
    if (reading.binding?.kind === "listItemField") {
        return { kind: "listItemField", fieldId: reading.binding.fieldId };
    }
    if (reading.binding?.kind === "blueprintValue") {
        return { kind: "blueprintValue", blueprintId: reading.binding.blueprintId };
    }
    return null;
}

/** The row field's name as the field picker shows it, or its id when the list no longer declares it. */
function rowFieldLabel(document: UIDocument, element: UIElement, fieldId: string): string {
    const context = findOwningListItemTemplate(document, element);
    const field = context ? findUIStructField(resolveUIStruct(document, context.structId), fieldId) : undefined;
    return field ? uiStructFieldLabel(field) : fieldId;
}

/**
 * The last explanation shown, so one double-click answered by more than one listener says it once.
 *
 * A selected element's double-click reaches the widget's own handler, the canvas's and the transform
 * box's, and each of them asks to begin the edit. Beginning is idempotent; a notification is not.
 */
let lastExplanation: { elementId: string; at: number } | null = null;
const EXPLANATION_REPEAT_WINDOW_MS = 800;

/**
 * Begin typing an element's words on the canvas - or, when a binding decides them, say which one
 * instead. True either way, because the gesture was answered: the caller must not hand the same
 * double-click to anything else.
 *
 * The binding is left as it is. Typing used to clear a value blueprint to make room for the typed
 * words, which took the author's logic with it, and over a row field it wrote words the canvas went on
 * drawing the row's value over.
 */
export function beginOrExplainInlineTextEdit(host: InlineTextEditHost, surfaceId: string, elementId: string): boolean {
    const document = host.documentService.getDocument();
    const element = document.elements[elementId];
    const bound = boundTextSourceOf(element);
    if (!bound || !element) {
        beginInlineTextEdit(host.stateService, surfaceId, elementId);
        return true;
    }
    const now = Date.now();
    if (lastExplanation && lastExplanation.elementId === elementId && now - lastExplanation.at < EXPLANATION_REPEAT_WINDOW_MS) {
        return true;
    }
    lastExplanation = { elementId, at: now };
    const services = host.documentService.getContext().services;
    let message: string;
    if (bound.kind === "listItemField") {
        message = translate("uiEditor.canvas.wordsFromRowField", { field: rowFieldLabel(document, element, bound.fieldId) });
    } else {
        const name = services.get<LocalBlueprintService>(Services.LocalBlueprint)
            .getBlueprintDocument().blueprints[bound.blueprintId]?.name?.trim();
        message = translate("uiEditor.canvas.wordsFromBlueprintValue", {
            name: name || translate("widgetChrome.blueprint.blueprintValue"),
        });
    }
    services.get<UIService>(Services.UI).showNotification(message, "info");
    return true;
}

/**
 * Resolve the services an inline text edit may write through, or null when this renderer must stay
 * read-only.
 *
 * The `textEdit` override names only a surface and an element, but a surface is rendered in more
 * places than the editor canvas: the surfaces panel previews every surface, including the one open
 * in the editor tab. Those previews used to fall back to the singleton services, so they matched the
 * override too and mounted their own textarea for the edited element - then committed their own
 * stale draft when the override cleared, overwriting whatever the canvas had just saved. Only the
 * editor tab passes its services on the adapter, so requiring them here keeps exactly one editor per
 * element.
 *
 * **A read-only surface answers null too**, which is the one place a frozen workspace reaches the
 * text and button widgets. Their double-click is attached inside their own markup rather than by the
 * canvas, so `isSurfaceGestureEnabled("inlineTextEdit", ...)` - which the interaction layer and
 * `useSurfaceDoubleClick` both consult - never saw it: measured on a frozen workspace, a
 * double-click on a text element still opened its editor, still accepted typing, and threw the
 * result away on thaw. Refusing the services here switches off the whole path at once (the
 * double-click handler returns early without them, and no textarea can mount), and it makes a frozen
 * canvas behave exactly like the previews that have always resolved to null.
 */
export function resolveInlineTextEditHost(hostAdapter: UIHostAdapter): InlineTextEditHost | null {
    const { editorStateService, editorDocumentService, blueprintRuntime, editorReadOnly } = hostAdapter;
    if (blueprintRuntime || editorReadOnly?.active || !editorStateService || !editorDocumentService) {
        return null;
    }
    return { stateService: editorStateService, documentService: editorDocumentService };
}

export function beginInlineTextEdit(
    stateService: UIEditorStateService,
    surfaceId: string,
    elementId: string,
): void {
    const current = stateService.getInteractionOverride();
    debugUIDoubleClick("beginInlineTextEdit", {
        surfaceId,
        elementId,
        currentOverride: current,
    });
    if (
        current?.kind === "textEdit" &&
        current.surfaceId === surfaceId &&
        current.elementId === elementId
    ) {
        debugUIDoubleClick("clear stale textEdit override", {
            surfaceId,
            elementId,
        });
        stateService.setInteractionOverride(null);
    }
    stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: [elementId],
        primaryId: elementId,
    });
    stateService.setInteractionOverride({
        kind: "textEdit",
        surfaceId,
        elementId,
    });
    debugUIDoubleClick("textEdit override set", {
        surfaceId,
        elementId,
        nextOverride: stateService.getInteractionOverride(),
    });
}
