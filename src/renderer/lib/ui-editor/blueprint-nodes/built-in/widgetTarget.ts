/**
 * The one way a node turns the element it targets into the widget address it reads or writes.
 *
 * Every element-targeting node used to spell this itself as `buildUIWidgetAddress(id, instanceKey)`:
 * the element, in the drawing the graph is running in. That was right when the element is drawn in
 * that drawing and wrong when it is not - a list's `Item Click` showing a panel beside the list wrote
 * to the panel's copy in the pressed row, which nothing draws. Which of the two it is depends on the
 * document, so the question goes to the runtime that holds it (`resolveWidgetAddress`, answered by
 * `resolveUIWidgetAddressFromDrawing`) and this is the only place a node asks it. Reads and writes
 * both come through here, so a getter and a setter on the same element always meet at the same
 * address.
 *
 * `widgetTargetIsTheOnlyAddressBuilder.test.ts` keeps it the only place.
 *
 * Comments in English per project convention.
 */

import { buildUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import type { UIHostAdapter } from "../../runtime/types";

/** What a node knows about where it is running: the execution context and the pure-pin runtime both carry this. */
export type WidgetTargetExecution = {
    hostAdapter?: UIHostAdapter;
    instanceKey?: string;
};

/**
 * The address of `elementId` as this execution means it.
 *
 * A runtime that cannot answer - a test double with no document - keeps the element in the running
 * drawing, which is what every address was before the question could be asked.
 */
export function addressWidgetFromExecution(execution: WidgetTargetExecution, elementId: string): string {
    const resolve = execution.hostAdapter?.blueprintRuntime?.resolveWidgetAddress;
    return resolve ? resolve(elementId, execution.instanceKey) : buildUIWidgetAddress(elementId, execution.instanceKey);
}
