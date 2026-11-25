import type { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { TranslationKey } from "@shared/i18n";
import { uiEditorHistoryScope, type UIEditorHistoryService } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import type { PageOverviewExit } from "./pageOverviewModel";

/**
 * The two writes the Page Overview makes that are not a property field's own: moving a control by
 * dragging it in the preview, and changing which page a step goes to.
 *
 * Both are recorded on the PAGE's undo stack, the one the overview claims while it is on screen,
 * so Ctrl+Z in the overview takes back what was just done there, rather than leaving a change to a
 * `Go Page` node on the stack of a blueprint tab nobody has open.
 */

export type OverviewEditServices = {
    documentService: UIDocumentService;
    localBlueprint: LocalBlueprintService;
    uiHistory: UIEditorHistoryService;
    history: HistoryService;
};

/** A drag in progress: where the control started and what the page looked like before it. */
export type OverviewDrag = {
    surfaceId: string;
    elementId: string;
    startX: number;
    startY: number;
    before: ReturnType<UIEditorHistoryService["captureSnapshot"]>;
    moved: boolean;
};

export function beginOverviewDrag(services: OverviewEditServices, surfaceId: string, elementId: string): OverviewDrag | null {
    const element = services.documentService.getDocument().elements[elementId];
    if (!element) {
        return null;
    }
    return {
        surfaceId,
        elementId,
        startX: element.layout.x,
        startY: element.layout.y,
        before: services.uiHistory.captureSnapshot(surfaceId),
        moved: false,
    };
}

/** Move the control by `dx`, `dy` design pixels from where the drag began. Recorded on release. */
export function moveOverviewDrag(services: OverviewEditServices, drag: OverviewDrag, dx: number, dy: number): void {
    const x = Math.round(drag.startX + dx);
    const y = Math.round(drag.startY + dy);
    const element = services.documentService.getDocument().elements[drag.elementId];
    if (!element || (element.layout.x === x && element.layout.y === y)) {
        return;
    }
    drag.moved = true;
    services.documentService.updateElementLayout(drag.elementId, { x, y }, { skipHistory: true });
}

/** Release: the whole drag becomes one step, or none when the control never moved. */
export function endOverviewDrag(services: OverviewEditServices, drag: OverviewDrag): void {
    if (!drag.moved) {
        return;
    }
    services.uiHistory.record({
        surfaceId: drag.surfaceId,
        before: drag.before,
        after: services.uiHistory.captureSnapshot(drag.surfaceId),
    });
}

/**
 * Point the node behind `exit` at another page, or at none.
 *
 * Only for an exit `canRetargetExit` allowed: the node keeps every other param and every wire, and
 * the page it named simply changes, exactly as picking a different page on its card would.
 *
 * Recorded as a step that carries its own inverse rather than as a page snapshot. A page snapshot
 * puts back which blueprints the page has but deliberately not what is inside them - a blueprint's
 * contents have their own history, and overwriting them from a page step would take back blueprint
 * edits made since - so a snapshot of this change would undo nothing. The inverse writes back the
 * page the node named before, and nothing else.
 */
export function retargetOverviewExit(
    services: OverviewEditServices,
    surfaceId: string,
    blueprintId: string,
    exit: PageOverviewExit,
    nextSurfaceId: string,
): void {
    const node = services.localBlueprint.getBlueprintDocument().blueprints[blueprintId]?.graphs.events[exit.layerId]?.graph?.nodes?.[exit.nodeId];
    if (!node) {
        return;
    }
    const had = Boolean(node.params && Object.prototype.hasOwnProperty.call(node.params, "surfaceId"));
    const previous = node.params?.surfaceId;
    const write = (value: unknown, present: boolean) => {
        services.localBlueprint.updateEventGraphIr(blueprintId, exit.layerId, ir => {
            const target = ir.nodes?.[exit.nodeId];
            if (!target) {
                return;
            }
            const { surfaceId: _old, ...rest } = target.params ?? {};
            target.params = present ? { ...rest, surfaceId: value } : rest;
        });
    };
    services.history.withoutRecording(() => write(nextSurfaceId, true));
    services.history.pushCommand(uiEditorHistoryScope(surfaceId), {
        label: { key: "workspace.history.entry.surfaceEdit" as TranslationKey },
        undo: () => write(previous, had),
        redo: () => write(nextSurfaceId, true),
    });
}
