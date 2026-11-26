import {
    composeUIParts,
    uiPartsBefore,
    type LiveUIParts,
} from "@shared/live/uiParts";
import type { UIDocument } from "@shared/types/ui-editor/document";

/**
 * Undo for the interface editor in a team project.
 *
 * In a team project an edit does not land on this machine when it is made. `mutateDocument` runs the
 * gesture against a copy, hands the records it changed to the server, and the document changes when
 * the server's effect comes back - and that arrival is deliberately kept out of the undo stack,
 * because an arrival may be somebody else's edit. So the page snapshot the editor records everywhere
 * else describes nothing here: before and after are the same document, and Ctrl+Z had no step to take.
 *
 * What a team step holds instead is the two sides of one of this window's own deltas: the records it
 * wrote, and the same records as they stood just before. Undo sends the earlier side as an ordinary
 * edit - through the same door, applied by the server in order, changing exactly what the original
 * changed - and redo sends the later side back. It never restores a page snapshot, which in a shared
 * page would delete whatever another author wrote since.
 *
 * Two rules come with that:
 *
 *  - **A step is taken only while the document still holds what it wrote.** If another author (or
 *    another window) has changed one of those records since, sending the old record would overwrite
 *    their change without anybody being told. The step is refused and stays on the stack.
 *  - **The page and component lists are not compared, they are rebuilt.** A delta carries a list
 *    whole whenever it touches one of its entries, and the server drops every entry a list leaves out
 *    - so the list as it stood before a rename, sent back after somebody added a page, would delete
 *    their page. The list sent is the current one with only this step's own entries put back or
 *    taken out.
 */

/** The two sides of one team step: the records it wrote, and the same records as they stood before. */
export type UITeamStepParts = {
    before: LiveUIParts;
    after: LiveUIParts;
};

/**
 * One team step on an undo stack, as it moves.
 *
 * `holds` is the side the document is meant to hold now - "after" once the edit is made, "before"
 * once it has been undone - and `sentAt` is when that side was last sent and not yet seen landing,
 * or null once it has. A class rather than a plain record so a stack entry can recognise another
 * step of this kind when it is asked to fold one in.
 */
export class UITeamStep {
    public constructor(
        public parts: UITeamStepParts,
        public holds: "before" | "after",
        public sentAt: number | null,
    ) {}
}

/** The parts of a delta that are records rather than lists, for comparing two states of them. */
function comparableRecords(parts: LiveUIParts): string {
    const { surfaceOrder: _surfaceOrder, componentOrder: _componentOrder, ...records } = parts;
    return canonical(records);
}

function canonical(value: unknown): string {
    return JSON.stringify(sortKeys(value));
}

/** Keys sorted and `undefined` dropped, so that two equal records compare equal whatever their key order. */
function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const entry = (value as Record<string, unknown>)[key];
        if (entry !== undefined) {
            out[key] = sortKeys(entry);
        }
    }
    return out;
}

/**
 * Whether `document` holds every record `parts` names exactly as `parts` states it.
 *
 * Read through {@link uiPartsBefore}, which reads the same records off a document that a delta names:
 * the document holds a delta exactly when reading the delta's records off it gives the delta back.
 * The page and component lists are left out (see the module note).
 */
export function uiDocumentHoldsParts(document: UIDocument, parts: LiveUIParts): boolean {
    return comparableRecords(uiPartsBefore(document, parts)) === comparableRecords(parts);
}

/**
 * The delta that takes `document` to `target`'s records, with the two lists rebuilt from the
 * document's own.
 *
 * `target` is one side of a step and `document` holds the other side (checked by the caller), so the
 * records are `target`'s as they are. Only the lists need work: each is the document's current list,
 * minus the entries `target` removes, plus the entries `target` brings back in the place `target`'s
 * list had them.
 */
export function uiPartsToward(document: UIDocument, target: LiveUIParts): LiveUIParts {
    const parts: LiveUIParts = { ...target };
    if (target.surfaces) {
        parts.surfaceOrder = rebuildOrder(
            document.surfaces.map(surface => surface.id),
            target.surfaceOrder ?? [],
            target.surfaces,
        );
    }
    if (target.components) {
        parts.componentOrder = rebuildOrder(
            (document.components ?? []).map(component => component.id),
            target.componentOrder ?? [],
            target.components,
        );
    }
    return parts;
}

/**
 * The current list with one step's own changes made to it.
 *
 * An id `records` maps to null leaves the list. An id it maps to a record and the list lacks comes
 * back, after the nearest id that precedes it in `targetOrder` and is still in the list - or first,
 * when none is. Everything else stays where the current list has it, which is what keeps another
 * author's new page, or their reordering, out of this step's reach.
 */
function rebuildOrder(
    current: readonly string[],
    targetOrder: readonly string[],
    records: Readonly<Record<string, unknown>>,
): string[] {
    const removed = new Set(Object.keys(records).filter(id => records[id] === null));
    const next = current.filter(id => !removed.has(id));
    const present = new Set(next);
    targetOrder.forEach((id, index) => {
        if (present.has(id) || records[id] === undefined || records[id] === null) {
            return;
        }
        let at = 0;
        for (let back = index - 1; back >= 0; back -= 1) {
            const anchor = next.indexOf(targetOrder[back]);
            if (anchor >= 0) {
                at = anchor + 1;
                break;
            }
        }
        next.splice(at, 0, id);
        present.add(id);
    });
    return next;
}

/**
 * Two consecutive steps of this window's own, as one: the earlier step's "before" for every record it
 * named, the later step's for the records only it named, and the later step's "after" over the
 * earlier one's.
 *
 * What folds a run of keystrokes into the field into one Ctrl+Z, as the snapshot entries fold
 * outside a team project.
 */
export function composeUITeamSteps(earlier: UITeamStepParts, later: UITeamStepParts): UITeamStepParts {
    return {
        before: composeUIParts(later.before, earlier.before),
        after: composeUIParts(earlier.after, later.after),
    };
}
