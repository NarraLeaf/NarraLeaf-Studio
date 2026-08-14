/**
 * The save schema that is currently live, and the one place pin resolution reads it from.
 *
 * Module-level state rather than a threaded parameter, for the same reason the brand palette is
 * (see `@shared/brand/brandRegistry`): the readers are pin resolution and node execution, called
 * from the flow canvas, the validator, the linter and the graph runtime alike, and a schema handed
 * down through all of them would be a parameter on every one of those signatures.
 *
 * Two hosts push into it and neither knows about the other: the editor (from `SaveSchemaService`,
 * on every schema change) and the game runtime (from the bundle it booted with). A host that has
 * pushed nothing reads an empty list, which is the right answer for a project being opened, for a
 * runtime built before the feature existed, and for every project that has declared no fields.
 *
 * Comments in English per project convention.
 */

import type { SaveSchemaField, SaveSchemaRuntimeTable } from "../types/saveSchema";

let activeFields: SaveSchemaRuntimeTable = [];
let activeRevision = 0;
const listeners = new Set<() => void>();

function sameFields(a: SaveSchemaRuntimeTable, b: SaveSchemaRuntimeTable): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    return a.every((field, index) => {
        const other = b[index];
        return (
            field.id === other.id &&
            field.name === other.name &&
            field.valueType === other.valueType &&
            field.storageKey === other.storageKey &&
            field.order === other.order &&
            JSON.stringify(field.defaultValue) === JSON.stringify(other.defaultValue)
        );
    });
}

/**
 * Publish a schema, in pin order.
 *
 * **A push whose content matches the current one changes nothing** - no revision, no notification.
 * The editor pushes from a document-changed subscription that fires for every edit anywhere in the
 * project, and a bumped revision re-renders every save node on the canvas; comparing here keeps
 * that cost at "when the author actually changed a field".
 */
export function setActiveSaveSchemaFields(fields: SaveSchemaRuntimeTable): void {
    if (sameFields(activeFields, fields)) {
        return;
    }
    activeFields = [...fields];
    activeRevision += 1;
    // Iterated over a copy: a listener may unsubscribe from inside its own callback, and deleting
    // from the live set mid-iteration skips whichever listener came next.
    for (const listener of [...listeners]) {
        listener();
    }
}

/** The live fields, in pin order. Empty when no host has published - a working state. */
export function getActiveSaveSchemaFields(): SaveSchemaRuntimeTable {
    return activeFields;
}

export function getActiveSaveSchemaField(id: string): SaveSchemaField | undefined {
    return activeFields.find(field => field.id === id);
}

// Module-level function declarations so the references stay stable across renders, which is what
// `useSyncExternalStore` needs to avoid re-subscribing on every one.
export function subscribeActiveSaveSchema(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getActiveSaveSchemaRevision(): number {
    return activeRevision;
}
